import asyncio
import json
from contextlib import suppress
from pathlib import Path
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Request
from pydantic import Field

from app.ai.contracts import AIError, Call, Message
from app.ai.service import prepare, public_error
from app.auth import DB, Actor, Input, limit
from app.courses import owned_by_id
from app.errors import AppError, ok
from app.learning.context import conversation_context, learning_material, teaching_model
from app.learning.lesson_generation import LessonGenerator
from app.learning.lesson_protocol import LessonCommand, execute, read_snapshot
from app.learning.lesson_snapshots import legacy_view
from app.learning.lesson_state import current_lesson, legacy_state_data, lesson_query
from app.learning.models import LearningLessonRevision

router = APIRouter(prefix="/api/v1/learning/conversations/{conversation_id}/lesson")
PROMPT = (Path(__file__).resolve().parents[2] / "prompts/learning/lesson-v2.md").read_text(
    encoding="utf-8"
)
TEXT = {"type": "string", "minLength": 1, "maxLength": 3000, "pattern": r"\S"}
STEP = {"title": {**TEXT, "maxLength": 120}, "content": TEXT, "final": {"type": "boolean"}}


class LessonAction(Input):
    request_id: UUID
    revision: int = Field(ge=0)
    action: Literal["start", "next", "explain", "hint", "check", "evaluate"]
    response: str = Field(default="", max_length=1000, pattern=r"^[^\x00]*$")


def require_action(body, lesson):
    if lesson is not None and lesson.plan_id is not None:
        raise AppError("LESSON_CONFLICT", "此题需要新版本学习工作台", 409)
    if body.revision != (lesson.revision if lesson else 0):
        raise AppError("LESSON_CONFLICT", "教学进度已更新，请重新加载", 409)
    state = lesson.state if lesson else {}
    can_start = not state or state["complete"]
    has_valid_response = (
        bool(body.response.strip() and state.get("check"))
        if body.action == "evaluate"
        else not body.response
    )
    if (body.action == "start") != can_start or not has_valid_response:
        raise AppError("LESSON_ACTION", "当前教学步骤无法执行此操作")


async def replay(db, conversation_id, body):
    saved = await db.scalar(
        lesson_query(conversation_id).where(LearningLessonRevision.request_id == body.request_id)
    )
    if saved and (saved.action, saved.response, saved.revision) != (
        body.action,
        body.response,
        body.revision + 1,
    ):
        raise AppError("LESSON_CONFLICT", "操作已提交，请重新加载教学进度", 409)
    return saved


def model_call(body, material, state):
    fields = {
        "start": {"problem": TEXT, **STEP},
        "next": STEP,
        "explain": {"text": TEXT},
        "hint": {"text": TEXT},
        "check": {"text": TEXT},
        "evaluate": {"text": TEXT},
    }[body.action]
    data = {
        "操作": body.action,
        "课程材料": {
            **material,
            "定义": material["定义"][:1500],
            "学习要求": [objective[:150] for objective in material["学习要求"][:8]],
        },
        "题目": state.get("problem"),
        "当前步骤": state.get("step"),
        "理解检测": state.get("check") if body.action == "evaluate" else None,
        "学生回答": body.response or None,
    }
    return Call(
        task_type="knowledge_lesson",
        prompt_version="lesson-v2",
        messages=[
            Message(role="system", content=PROMPT),
            Message(role="user", content=json.dumps(data, ensure_ascii=False)),
        ],
        timeout=120,
        max_output_tokens=1800,
        output_schema={
            "type": "object",
            "properties": fields,
            "required": list(fields),
            "additionalProperties": False,
        },
    )


def advance_state(body, state, result):
    if body.action in {"start", "next"}:
        index = 1 if body.action == "start" else state["step"]["index"] + 1
        return {
            "problem": result["problem"] if body.action == "start" else state["problem"],
            "step": {"index": index, **{name: result[name] for name in STEP}},
            "complete": False,
            "support": None,
            "check": None,
        }
    if body.action == "check":
        return {**state, "check": result["text"], "support": None}
    return {**state, "support": {"kind": body.action, "text": result["text"]}}


@router.get("")
async def lesson(conversation_id: UUID, db: DB, actor: Actor):
    await conversation_context(db, conversation_id, actor.id)
    return ok(legacy_view(await current_lesson(db, conversation_id)))


@router.get("/task")
async def get_task(conversation_id: UUID, db: DB, actor: Actor):
    return ok(await read_snapshot(db, conversation_id, actor.id))


@router.post("/task")
async def task_command(
    conversation_id: UUID, body: LessonCommand, request: Request, db: DB, actor: Actor
):
    async def wait_for_disconnect():
        while (await request.receive())["type"] != "http.disconnect":
            pass

    generator = LessonGenerator(db, request, actor.id)
    operation = asyncio.create_task(execute(db, conversation_id, actor.id, body, generator))
    disconnect = asyncio.create_task(wait_for_disconnect())
    try:
        await asyncio.wait({operation, disconnect}, return_when=asyncio.FIRST_COMPLETED)
        if operation.done():
            return ok(operation.result())
        raise AppError("REQUEST_CANCELLED", "请求已取消，请重新读取教学进度", 499)
    finally:
        for task in (operation, disconnect):
            if not task.done():
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task


@router.post("")
async def change_lesson(
    conversation_id: UUID, body: LessonAction, request: Request, db: DB, actor: Actor
):
    actor_id = actor.id
    course, section, point = await conversation_context(db, conversation_id, actor_id)
    if saved := await replay(db, conversation_id, body):
        return ok(legacy_state_data(saved))
    current = await current_lesson(db, conversation_id)
    require_action(body, current)
    state = current.state if current else {}
    course_id, point_version = course.id, point.content_version_id
    if body.action == "next" and state["step"]["final"]:
        updated = {**state, "complete": True, "support": None, "check": None}
    else:
        provider_id, model_id, _ = await teaching_model(db, actor_id)
        call = model_call(body, learning_material(course, section, point), state)
        await limit(request, "ai", str(actor_id))
        target, sink, _ = await prepare(request, db, actor_id, provider_id, model_id, call)
        try:
            result = await request.app.state.ai_gateway.execute(target, call, sink)
        except AIError as error:
            raise public_error(error) from None
        updated = advance_state(body, state, result.structured)
    await owned_by_id(db, course_id, actor_id)
    _, _, point = await conversation_context(db, conversation_id, actor_id)
    if saved := await replay(db, conversation_id, body):
        return ok(legacy_state_data(saved))
    if point.content_version_id != point_version:
        raise AppError("LESSON_CONFLICT", "知识点已更新，请重新加载", 409)
    require_action(body, await current_lesson(db, conversation_id))
    saved = LearningLessonRevision(
        conversation_id=conversation_id,
        revision=body.revision + 1,
        request_id=body.request_id,
        action=body.action,
        response=body.response,
        state=updated,
    )
    db.add(saved)
    await db.commit()
    return ok(legacy_state_data(saved))
