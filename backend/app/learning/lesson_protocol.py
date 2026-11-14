import re
import unicodedata
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID, uuid4

from pydantic import Field
from sqlalchemy.exc import SQLAlchemyError

from app.auth import Input
from app.courses import owned_by_id
from app.errors import AppError
from app.learning.context import conversation_context, learning_material
from app.learning.contracts import LessonOperation
from app.learning.lesson_snapshots import snapshot
from app.learning.lesson_state import current_lesson, lesson_query
from app.learning.models import LearningLessonPlan, LearningLessonRevision
from app.learning.plans import PlanSourceChanged, insert_plan, read_plan


class LessonCommand(Input):
    action: Literal["start", "next", "complete", "next-question"]
    request_id: UUID
    expected_revision: int = Field(ge=0, strict=True)
    expected_task_id: UUID | None = None
    expected_plan_id: UUID | None = None
    expected_step_index: int | None = Field(default=None, ge=1, strict=True)


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


async def replay(db, conversation_id, latest, command):
    row = await db.scalar(
        lesson_query(conversation_id).where(LearningLessonRevision.request_id == command.request_id)
    )
    if row is not None and (
        row.plan_id is None or row.state.get("_command") != command.model_dump(mode="json")
    ):
        raise conflict(conversation_id, latest)
    return row


def comparable_problem(value):
    return re.sub(r"[\W\d_]", "", unicodedata.normalize("NFKC", value).casefold())


async def render(generator, material, draft, index, history):
    step = draft.steps[index - 1]
    output = await generator.generate(
        LessonOperation.NEXT,
        {
            "material": material,
            "problem": draft.problem,
            "objective": draft.learning_objective,
            "step": step.model_dump(mode="json"),
            "history": history,
        },
    )
    return {
        "step_id": str(uuid4()),
        "index": index,
        "title": output.title,
        "content": output.content,
        "objective": step.objective,
        "is_final_step": index == len(draft.steps),
    }


async def candidate(generator, action, material, previous, plan):
    if action == "complete":
        return None, None
    if action == "next":
        steps = previous["steps"]
        return None, await render(generator, material, plan, steps[-1]["index"] + 1, steps)
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


async def execute(db, conversation_id, actor_id, command, generator):
    course, section, point = await conversation_context(db, conversation_id, actor_id)
    latest = await current_lesson(db, conversation_id)
    if saved := await replay(db, conversation_id, latest, command):
        return snapshot(conversation_id, saved)
    require(conversation_id, latest, command)

    course_id, point_id, version = course.id, point.id, point.content_version_id
    previous = latest.state if latest else {}
    plan_id = latest.plan_id if latest else None
    plan = None
    if plan_id is not None:
        source = await db.get(LearningLessonPlan, plan_id)
        if source is None or source.conversation_id != conversation_id:
            raise AppError("TASK_NOT_FOUND", "教学计划不存在", 404)
        if command.action != "next-question" and source.content_version_id != version:
            raise conflict(conversation_id, latest)
        if command.action == "next":
            plan = await read_plan(db, conversation_id=conversation_id, plan_id=plan_id)
            if plan is None or len(plan.steps) <= previous["steps"][-1]["index"]:
                raise AppError("INVALID_TRANSITION", "计划中没有下一步")
    material = learning_material(course, section, point)
    await db.rollback()

    draft, step = await candidate(generator, command.action, material, previous, plan)
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
            if command.action == "complete":
                state["completion"] = {"completed_at": datetime.now(UTC).isoformat()}
            else:
                state["steps"] = [*state["steps"], step]
                state["support"] = state["check"] = None
        state["status"] = (
            "completed"
            if command.action == "complete"
            else "final_step"
            if step["is_final_step"]
            else "teaching"
        )
        state["updated_at"] = datetime.now(UTC).isoformat()
        state["_command"] = command.model_dump(mode="json")
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
