import json
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Query, Request
from pydantic import Field
from sqlalchemy import select

from app.ai.contracts import AIError, Call, Message
from app.ai.service import prepare, public_error
from app.auth import DB, Actor, Input, limit
from app.courses import owned_by_id
from app.errors import AppError, ok
from app.learning.context import conversation_context, learning_material, teaching_model
from app.learning.contracts import LessonOperation, model_output_schema, validate_model_output
from app.learning.lesson_snapshots import legacy_view
from app.learning.lesson_state import current_lesson
from app.learning.models import LearningTurn
from app.learning.problem_parts import selected_subquestion

router = APIRouter(prefix="/api/v1/learning/conversations/{conversation_id}/turns")
PAGE_SIZE = 30
CONTEXT_TURNS = 12
PROMPT_VERSION = "teaching-v1"
PROMPT = (Path(__file__).resolve().parents[2] / "prompts/learning/teaching-v1.md").read_text(
    encoding="utf-8"
)
PROTOCOL_PROMPT = (
    Path(__file__).resolve().parents[2] / "prompts/learning/teaching-v2.md"
).read_text(encoding="utf-8")


class Question(Input):
    request_id: UUID
    after: int = Field(ge=0)
    question: str = Field(min_length=1, max_length=4000, pattern=r"\S")
    subquestion: int | None = Field(default=None, ge=1, le=99, strict=True)
    lesson_revision: int | None = Field(default=None, ge=1, strict=True)


def turn_data(turn):
    return {
        "id": turn.id,
        "position": turn.position,
        "question": turn.question,
        "answer": turn.answer,
    }


def lesson_question(lesson):
    return UUID(lesson.state["question_id"]) if lesson is not None and lesson.plan_id else None


def assistant_context(lesson):
    if lesson_question(lesson) is None:
        return None
    step = lesson.state["steps"][-1]
    return {"question_id": lesson.state["question_id"], "step_index": step["index"]}


def turn_query(conversation_id):
    return select(LearningTurn).where(LearningTurn.conversation_id == conversation_id)


async def find_retry(db, conversation_id, body):
    turn = await db.scalar(
        turn_query(conversation_id).where(LearningTurn.request_id == body.request_id)
    )
    if turn is not None and (
        turn.question != body.question.strip() or turn.position != body.after + 1
    ):
        raise AppError("TURN_CONFLICT", "这条提问已发送，请重新加载对话", 409)
    return turn


def require_current(after, latest):
    if after != (latest.position if latest else 0):
        raise AppError("TURN_CONFLICT", "对话已更新，请加载最新消息后再发送", 409)


def teaching_call(
    course, section, point, history, question, context_size, lesson=None, subquestion=None
):
    # Bound the supplied context without dropping the user's current question.
    output = min(2048, max(64, context_size // 4))
    budget = min(16000, max(512, context_size - output))
    facts = learning_material(course, section, point)
    material = json.dumps(facts, ensure_ascii=False)[: max(500, budget // 3)]
    protocol = lesson_question(lesson) is not None
    context = f"{PROTOCOL_PROMPT if protocol else PROMPT}\n当前学习材料：\n{material}"
    if lesson:
        state = legacy_view(lesson)
        step = state["step"]
        snapshot = {
            "题目": state["problem"][:900],
            "当前步骤": {**step, "content": step["content"][:1100]},
        }
        if protocol:
            steps = lesson.state["steps"]
            snapshot["本步目标"] = steps[-1]["objective"]
            snapshot["已讲解"] = [entry["objective"] for entry in steps[:-1][-6:]]
        if subquestion is not None:
            snapshot["当前小题"] = {**subquestion, "text": subquestion["text"][:900]}
            context += "\n优先围绕当前小题回答，继续遵守教学范围。"
        context += "\n主窗只读内容：\n" + json.dumps(snapshot, ensure_ascii=False)
    instruction = Message(role="system", content=context)
    remaining = budget - len(instruction.content) - len(question)
    previous = []
    for turn in history:
        available = min(24000, remaining - len(turn.question))
        if available <= 0:
            break
        answer = turn.answer[:available]
        if not answer:
            break
        previous[0:0] = [
            Message(role="user", content=turn.question),
            Message(role="assistant", content=answer),
        ]
        remaining -= len(turn.question) + len(answer)
    return Call(
        task_type="knowledge_teaching",
        prompt_version="teaching-v2" if protocol else PROMPT_VERSION,
        messages=[instruction, *previous, Message(role="user", content=question)],
        max_output_tokens=output,
        timeout=120,
        output_schema=model_output_schema(LessonOperation.ASSISTANT) if protocol else None,
    )


@router.get("")
async def history(
    conversation_id: UUID, db: DB, actor: Actor, before: int | None = Query(default=None, gt=0)
):
    await conversation_context(db, conversation_id, actor.id)
    query = turn_query(conversation_id)
    if before is not None:
        query = query.where(LearningTurn.position < before)
    query = query.order_by(LearningTurn.position.desc()).limit(PAGE_SIZE + 1)
    rows = (await db.scalars(query)).all()
    page = rows[:PAGE_SIZE]
    return ok(
        {
            "turns": [turn_data(turn) for turn in reversed(page)],
            "before": page[-1].position if len(rows) > PAGE_SIZE else None,
            **(
                {"context": assistant_context(lesson)}
                if (lesson := await current_lesson(db, conversation_id)) is not None
                and lesson.plan_id
                else {}
            ),
        }
    )


@router.post("")
async def ask(conversation_id: UUID, body: Question, request: Request, db: DB, actor: Actor):
    actor_id = actor.id
    course, section, point = await conversation_context(db, conversation_id, actor_id)
    if existing := await find_retry(db, conversation_id, body):
        return ok(turn_data(existing))
    latest = turn_query(conversation_id).order_by(LearningTurn.position.desc())
    require_current(body.after, await db.scalar(latest.limit(1)))
    lesson = await current_lesson(db, conversation_id)
    if body.subquestion is not None and (lesson is None or body.lesson_revision != lesson.revision):
        raise AppError("TURN_CONFLICT", "题目已更新，请重新选择小题", 409)
    subquestion = selected_subquestion(lesson.state["problem"] if lesson else "", body.subquestion)
    question_id = lesson_question(lesson)
    scoped = latest.where(LearningTurn.question_id == question_id).limit(CONTEXT_TURNS)
    recent = (await db.scalars(scoped)).all()
    provider_id, model_id, capabilities = await teaching_model(db, actor_id)
    course_id = course.id
    point_version = point.content_version_id
    question = body.question.strip()
    call = teaching_call(
        course,
        section,
        point,
        recent,
        question,
        capabilities.get("max_context_tokens", 4096),
        lesson,
        subquestion,
    )
    await limit(request, "ai", str(actor_id))
    target, sink, _ = await prepare(request, db, actor_id, provider_id, model_id, call)
    try:
        result = await request.app.state.ai_gateway.execute(target, call, sink)
        answer = (
            validate_model_output(LessonOperation.ASSISTANT, result.structured).text.strip()
            if question_id
            else result.text.strip()
        )
        if not answer:
            raise AIError("AI_INVALID_RESPONSE")
    except ValueError:
        raise AppError("MODEL_OUTPUT_INVALID", "辅窗输出未通过校验，请重试", 502) from None
    except AIError as error:
        raise public_error(error) from None

    # Preparing the model call commits before network I/O.
    # Serialize only the final append with other turns and course changes.
    await owned_by_id(db, course_id, actor_id)
    _, _, current_point = await conversation_context(db, conversation_id, actor_id)
    if existing := await find_retry(db, conversation_id, body):
        return ok(turn_data(existing))
    current = await current_lesson(db, conversation_id)
    if current_point.content_version_id != point_version or question_id != lesson_question(current):
        raise AppError("TURN_CONFLICT", "知识点已更新，请重新发送问题", 409)
    if subquestion is not None and (current is None or current.revision != body.lesson_revision):
        raise AppError("TURN_CONFLICT", "题目已更新，请重新选择小题", 409)
    require_current(body.after, await db.scalar(latest.limit(1)))
    turn = LearningTurn(
        conversation_id=conversation_id,
        position=body.after + 1,
        request_id=body.request_id,
        question=question,
        answer=answer,
        question_id=question_id,
    )
    db.add(turn)
    await db.commit()
    return ok(turn_data(turn))
