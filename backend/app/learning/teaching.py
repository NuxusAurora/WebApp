import json
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Query, Request
from pydantic import Field
from sqlalchemy import select

from app.ai.contracts import AIError, Call, Message
from app.ai.models import AIModel, AIProvider
from app.ai.service import prepare, public_error
from app.auth import DB, Actor, Input, limit
from app.courses import owned_by_id
from app.curriculum.models import Chapter, Section
from app.errors import AppError, ok
from app.knowledge.models import KnowledgePoint
from app.learning.models import LearningConversation, LearningProject, LearningTurn
from app.models import Course

router = APIRouter(prefix="/api/v1/learning/conversations/{conversation_id}/turns")
PAGE_SIZE = 30
CONTEXT_TURNS = 12
PROMPT_VERSION = "teaching-v1"
PROMPT = (Path(__file__).resolve().parents[2] / "prompts/learning/teaching-v1.md").read_text(
    encoding="utf-8"
)


class Question(Input):
    request_id: UUID
    after: int = Field(ge=0)
    question: str = Field(min_length=1, max_length=4000, pattern=r"\S")


def turn_data(turn):
    return {
        "id": turn.id,
        "position": turn.position,
        "question": turn.question,
        "answer": turn.answer,
    }


async def conversation_context(db, conversation_id, actor_id):
    query = (
        select(Course, Section, KnowledgePoint)
        .select_from(LearningConversation)
        .join(LearningProject, LearningProject.id == LearningConversation.project_id)
        .join(Section, Section.id == LearningProject.section_id)
        .join(Chapter, Chapter.id == Section.chapter_id)
        .join(Course, Course.id == Chapter.course_id)
        .join(KnowledgePoint, KnowledgePoint.id == LearningConversation.knowledge_point_id)
        .where(
            LearningConversation.id == conversation_id,
            LearningProject.user_id == actor_id,
            Course.user_id == actor_id,
            Course.status == "active",
            Chapter.archived.is_(False),
            Section.archived.is_(False),
            KnowledgePoint.section_id == Section.id,
            KnowledgePoint.archived_at.is_(None),
        )
    )
    row = (await db.execute(query.execution_options(populate_existing=True))).one_or_none()
    if row is None:
        raise AppError("NOT_FOUND", "此知识点对话不存在或已归档", 404)
    return row


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


def teaching_call(course, section, point, history, question, context_size):
    # Bound the supplied context without dropping the user's current question.
    output = min(2048, max(64, context_size // 4))
    budget = min(16000, max(512, context_size - output))
    facts = {
        "课程": course.title,
        "教材": course.textbook,
        "学习目标": course.learning_goal[:500],
        "小节": section.title,
        "知识点": point.title,
        "定义": point.description,
        "学习要求": point.learning_objectives,
    }
    material = json.dumps(facts, ensure_ascii=False)[: max(500, budget // 3)]
    instruction = Message(role="system", content=f"{PROMPT}\n当前学习材料：\n{material}")
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
        prompt_version=PROMPT_VERSION,
        messages=[instruction, *previous, Message(role="user", content=question)],
        max_output_tokens=output,
        timeout=120,
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
        }
    )


@router.post("")
async def ask(conversation_id: UUID, body: Question, request: Request, db: DB, actor: Actor):
    actor_id = actor.id
    course, section, point = await conversation_context(db, conversation_id, actor_id)
    if existing := await find_retry(db, conversation_id, body):
        return ok(turn_data(existing))
    latest = turn_query(conversation_id).order_by(LearningTurn.position.desc())
    recent = (await db.scalars(latest.limit(CONTEXT_TURNS))).all()
    require_current(body.after, recent[0] if recent else None)
    config = (
        await db.execute(
            select(AIProvider.id, AIModel.id, AIModel.capabilities)
            .join(AIModel, AIModel.provider_id == AIProvider.id)
            .where(
                AIProvider.user_id == actor_id,
                AIProvider.enabled.is_(True),
                AIModel.enabled.is_(True),
            )
        )
    ).first()
    if config is None:
        raise AppError("AI_CONFIG_INCOMPLETE", "请在「模型设置」中启用并保存一个模型")
    provider_id, model_id, capabilities = config
    course_id = course.id
    point_version = point.content_version_id
    question = body.question.strip()
    call = teaching_call(
        course, section, point, recent, question, capabilities.get("max_context_tokens", 4096)
    )
    await limit(request, "ai", str(actor_id))
    target, sink, _ = await prepare(request, db, actor_id, provider_id, model_id, call)
    try:
        result = await request.app.state.ai_gateway.execute(target, call, sink)
        answer = result.text.strip()
        if not answer:
            raise AIError("AI_INVALID_RESPONSE")
    except AIError as error:
        raise public_error(error) from None

    # Preparing the model call commits before network I/O.
    # Serialize only the final append with other turns and course changes.
    await owned_by_id(db, course_id, actor_id)
    _, _, current_point = await conversation_context(db, conversation_id, actor_id)
    if existing := await find_retry(db, conversation_id, body):
        return ok(turn_data(existing))
    if current_point.content_version_id != point_version:
        raise AppError("TURN_CONFLICT", "知识点已更新，请重新发送问题", 409)
    require_current(body.after, await db.scalar(latest.limit(1)))
    turn = LearningTurn(
        conversation_id=conversation_id,
        position=body.after + 1,
        request_id=body.request_id,
        question=question,
        answer=answer,
    )
    db.add(turn)
    await db.commit()
    return ok(turn_data(turn))
