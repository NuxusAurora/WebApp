import re
import unicodedata
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID, uuid4

from pydantic import Field
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.auth import Input
from app.courses import owned_by_id
from app.errors import AppError
from app.learning.context import conversation_context, learning_material
from app.learning.contracts import LessonOperation
from app.learning.lesson_snapshots import snapshot
from app.learning.lesson_state import current_lesson, lesson_query
from app.learning.lesson_support import apply_support, require_input
from app.learning.models import LearningLessonPlan, LearningLessonRevision, LearningTurn
from app.learning.plans import PlanSourceChanged, insert_plan, read_plan
from app.learning.problem_parts import require_subquestion, selected_subquestion, split_problem


class LessonCommand(Input):
    action: Literal[
        "start",
        "next",
        "complete",
        "next-question",
        "hint",
        "rephrase",
        "check-question",
        "check-answer",
        "evaluate-check",
    ]
    request_id: UUID
    expected_revision: int = Field(ge=0, strict=True)
    expected_task_id: UUID | None = None
    expected_plan_id: UUID | None = None
    expected_step_index: int | None = Field(default=None, ge=1, strict=True)
    check_id: UUID | None = None
    subquestion: int | None = Field(default=None, ge=1, le=99, strict=True)
    answer: str = Field(default="", max_length=1000, pattern=r"^[^\x00]*$")

    def receipt(self):
        result = self.model_dump(mode="json", exclude={"check_id", "answer", "subquestion"})
        if self.check_id is not None:
            result["check_id"] = str(self.check_id)
        if self.answer:
            result["answer"] = self.answer
        if self.subquestion is not None:
            result["subquestion"] = self.subquestion
        return result


CORE_ACTIONS = {"start", "next", "complete", "next-question"}
SCOPED_ACTIONS = {"next", "hint", "rephrase", "check-question"}


class SubquestionRequest(Input):
    expected_revision: int = Field(ge=1, strict=True)
    subquestion: int = Field(ge=1, le=99, strict=True)


def conflict(conversation_id, latest):
    return AppError(
        "LESSON_CONFLICT",
        "学习状态已变化，请重新加载",
        409,
        details={"snapshot": snapshot(conversation_id, latest)},
    )


def require(conversation_id, latest, command):
    expected = (command.expected_task_id, command.expected_plan_id, command.expected_step_index)
    identity = (None, None, None)
    if latest is not None and latest.plan_id is not None:
        identity = (
            UUID(latest.state["task_id"]),
            latest.plan_id,
            latest.state["steps"][-1]["index"],
        )
    if expected != identity or command.expected_revision != (latest.revision if latest else 0):
        raise conflict(conversation_id, latest)
    if command.action not in snapshot(conversation_id, latest)["actions"]:
        raise AppError("INVALID_TRANSITION", "当前教学状态无法执行此操作")
    if command.subquestion is not None and command.action not in SCOPED_ACTIONS:
        raise AppError("INVALID_TRANSITION", "当前操作无需选择小题")
    require_input(command, latest.state if latest else {})


async def replay(db, conversation_id, latest, command):
    row = await db.scalar(
        lesson_query(conversation_id).where(LearningLessonRevision.request_id == command.request_id)
    )
    if row is not None and (row.plan_id is None or row.state.get("_command") != command.receipt()):
        raise conflict(conversation_id, latest)
    return row


def comparable_problem(value):
    return re.sub(r"[\W\d_]", "", unicodedata.normalize("NFKC", value).casefold())


async def render(generator, material, draft, index, history, subquestion=None):
    step = draft.steps[index - 1]
    context = {
        "material": material,
        "problem": draft.problem,
        "objective": draft.learning_objective,
        "step": step.model_dump(mode="json"),
        "history": [{**entry, "content": entry["content"][:280]} for entry in history[-6:]],
    }
    if subquestion is not None:
        context["active_subquestion"] = subquestion
    for retry in range(2):
        if retry:
            context["repair"] = "讲解要覆盖本步目标，避免重复与提前剧透。"
        output = await generator.generate(LessonOperation.NEXT, context)
        protected = list(step.forbidden)
        if index < len(draft.steps):
            protected.append(draft.reference_answer)
        text = comparable_problem(output.title + output.content)
        if any(len(value) >= 8 and value in text for value in map(comparable_problem, protected)):
            continue
        if any(output.content.strip() == entry["content"].strip() for entry in history):
            continue
        break
    else:
        raise AppError("MODEL_OUTPUT_INVALID", "讲解未通过步骤校验，请重试", 502)
    return {
        "step_id": str(uuid4()),
        "index": index,
        "title": output.title,
        "content": output.content,
        "objective": step.objective,
        "takeaway": step.expected_takeaway,
        "format": "markdown",
        "is_final_step": index == len(draft.steps),
    }


async def candidate(generator, action, material, previous, plan, subquestion=None):
    if action == "complete":
        return None, None
    if action == "next":
        steps = previous["steps"]
        return None, await render(
            generator, material, plan, steps[-1]["index"] + 1, steps, subquestion
        )
    old_problem = previous.get("problem")
    for _ in range(2):
        draft = await generator.generate(
            LessonOperation.PLAN, {"material": material, "previous_problem": old_problem}
        )
        if not old_problem or comparable_problem(draft.problem) != comparable_problem(old_problem):
            return draft, await render(generator, material, draft, 1, [])
    raise AppError("PLAN_VALIDATION_FAILED", "新题与上一题太相似，请重试", 502)


async def read_snapshot(db, conversation_id, actor_id):
    await conversation_context(db, conversation_id, actor_id)
    return snapshot(conversation_id, await current_lesson(db, conversation_id))


async def explain_subquestion(db, conversation_id, actor_id, body, generator):
    course, section, point = await conversation_context(db, conversation_id, actor_id)
    latest = await current_lesson(db, conversation_id)
    if latest is None or latest.revision != body.expected_revision:
        raise conflict(conversation_id, latest)
    parts = split_problem(latest.state.get("problem") or "")
    part = require_subquestion(parts, body.subquestion)
    point_version = point.content_version_id
    material = learning_material(course, section, point)
    await db.rollback()
    output = await generator.generate(
        LessonOperation.EXPLAIN_SUBQUESTION,
        {"material": material, "statement": parts["statement"], "active_subquestion": part},
    )
    _, _, point = await conversation_context(db, conversation_id, actor_id)
    current = await current_lesson(db, conversation_id)
    if (
        current is None
        or current.revision != body.expected_revision
        or point.content_version_id != point_version
    ):
        raise conflict(conversation_id, current)
    return {"number": part["number"], "title": output.title, "content": output.content}


async def execute(db, conversation_id, actor_id, command, generator):
    course, section, point = await conversation_context(db, conversation_id, actor_id)
    latest = await current_lesson(db, conversation_id)
    if saved := await replay(db, conversation_id, latest, command):
        return snapshot(conversation_id, saved)
    require(conversation_id, latest, command)

    course_id, point_id, version = course.id, point.id, point.content_version_id
    previous = latest.state if latest else {}
    subquestion = selected_subquestion(previous.get("problem") or "", command.subquestion)
    plan_id = latest.plan_id if latest else None
    plan = None
    if plan_id is not None:
        source = await db.get(LearningLessonPlan, plan_id)
        if source is None or source.conversation_id != conversation_id:
            raise AppError("TASK_NOT_FOUND", "教学计划不存在", 404)
        if command.action != "next-question" and source.content_version_id != version:
            raise conflict(conversation_id, latest)
        if command.action == "next" or command.action not in CORE_ACTIONS:
            plan = await read_plan(db, conversation_id=conversation_id, plan_id=plan_id)
            if plan is None or (
                command.action == "next" and len(plan.steps) <= previous["steps"][-1]["index"]
            ):
                raise AppError("INVALID_TRANSITION", "计划中没有下一步")
    material = learning_material(course, section, point)
    if command.action == "next":
        recent = await db.scalars(
            select(LearningTurn)
            .where(
                LearningTurn.conversation_id == conversation_id,
                LearningTurn.question_id == UUID(previous["question_id"]),
            )
            .order_by(LearningTurn.position.desc())
            .limit(6)
        )
        material["学生提问摘录"] = [
            {
                "text": entry.question[:300],
                "source": str(entry.id),
                "at": entry.created_at.isoformat(),
            }
            for entry in recent
        ]
    await db.rollback()

    support_changes = None
    draft = step = None
    if command.action in CORE_ACTIONS:
        draft, step = await candidate(
            generator, command.action, material, previous, plan, subquestion
        )
    else:
        support_changes = await apply_support(
            generator, command, previous, plan, material, subquestion
        )
    try:
        await owned_by_id(db, course_id, actor_id)
        _, _, point = await conversation_context(db, conversation_id, actor_id)
        latest = await current_lesson(db, conversation_id)
        if saved := await replay(db, conversation_id, latest, command):
            return snapshot(conversation_id, saved)
        require(conversation_id, latest, command)
        if point.content_version_id != version:
            raise conflict(conversation_id, latest)

        if draft is not None:
            plan = await insert_plan(
                db,
                conversation_id=conversation_id,
                knowledge_point_id=point_id,
                content_version_id=version,
                draft=draft,
            )
            plan_id = plan.plan_id
            state = {
                "task_id": str(uuid4()),
                "question_id": str(plan.question_id),
                "problem": plan.problem,
                "plan": {
                    "plan_version": plan.plan_version,
                    "learning_objective": plan.learning_objective,
                    "total_steps": len(plan.steps),
                },
                "steps": [step],
                "created_at": plan.created_at.isoformat(),
            }
        else:
            state = dict(previous)
            if support_changes is not None:
                state.update(support_changes)
            elif command.action == "complete":
                state["completion"] = {"completed_at": datetime.now(UTC).isoformat()}
            else:
                state["steps"] = [*state["steps"], step]
                state["support"] = state["check"] = None
        if command.action == "complete":
            state["status"] = "completed"
        elif step is not None:
            state["status"] = "final_step" if step["is_final_step"] else "teaching"
        state["updated_at"] = datetime.now(UTC).isoformat()
        state["_command"] = command.receipt()
        row = LearningLessonRevision(
            conversation_id=conversation_id,
            plan_id=plan_id,
            revision=command.expected_revision + 1,
            request_id=command.request_id,
            action=command.action,
            response="",
            state=state,
        )
        db.add(row)
        result = snapshot(conversation_id, row)
        await db.commit()
        return result
    except PlanSourceChanged:
        await db.rollback()
        raise conflict(conversation_id, await current_lesson(db, conversation_id)) from None
    except SQLAlchemyError:
        await db.rollback()
        raise AppError("PERSISTENCE_FAILED", "进度未能保存，请重新读取后重试", 503) from None
