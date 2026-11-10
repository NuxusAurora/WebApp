import asyncio
import json
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, Request
from pydantic import Field, ValidationError
from sqlalchemy import select, update

from app.ai.contracts import AIError, Call, Message
from app.ai.service import prepare
from app.auth import DB, Actor, Input, limit
from app.curriculum.models import Section, StructureEvent, StructureVersion, WorkflowRun
from app.errors import AppError, ok
from app.knowledge.contracts import KnowledgeInput, output_schema
from app.knowledge.service import (
    changes,
    check_replacement,
    confirm,
    conflict,
    latest_draft,
    new_draft,
    owned_section,
    owned_version,
    point_data,
    points,
    version_data,
)

router = APIRouter(prefix="/api/v1/sections/{section_id}/knowledge-points")
PROMPT = (Path(__file__).resolve().parents[2] / "prompts/knowledge/extract-v2.md").read_text(
    encoding="utf-8"
)


class DraftInput(Input):
    payload: KnowledgeInput
    base_course_revision: int = Field(ge=0)
    replace_version_id: UUID | None = None
    replace_revision: int | None = Field(default=None, ge=1)


class PatchInput(Input):
    payload: KnowledgeInput
    version_id: UUID
    expected_revision: int = Field(ge=1)
    base_course_revision: int = Field(ge=0)


class ConfirmInput(Input):
    version_id: UUID
    expected_revision: int = Field(ge=1)
    base_course_revision: int = Field(ge=0)
    accept_archives: bool = False


class GenerateInput(Input):
    provider_id: UUID
    model_id: UUID
    base_course_revision: int = Field(ge=0)
    replace_version_id: UUID | None = None
    replace_revision: int | None = Field(default=None, ge=1)


@router.get("")
async def current(section_id: UUID, db: DB, actor: Actor):
    course, section, chapter = await owned_section(db, section_id, actor.id)
    draft = await latest_draft(db, section_id)
    current_points = await points(db, section_id)
    versions = (
        {
            v.id: v
            for v in await db.scalars(
                select(StructureVersion).where(
                    StructureVersion.id.in_({p.content_version_id for p in current_points}),
                    StructureVersion.course_id == course.id,
                    StructureVersion.section_id == section_id,
                    StructureVersion.user_id == actor.id,
                )
            )
        }
        if current_points
        else {}
    )
    return ok(
        {
            "confirmed_revision": course.confirmed_revision,
            "section": {"id": section.id, "title": section.title, "chapter_title": chapter.title},
            "knowledge_points": [
                {
                    **point_data(p),
                    "source": {
                        key: value
                        for key, value in versions[p.content_version_id].source.items()
                        if key in {"kind", "knowledge_basis", "model_name", "prompt_version"}
                    }
                    if p.content_version_id in versions
                    else {"kind": "manual"},
                }
                for p in current_points
            ],
            "draft": version_data(draft) if draft else None,
        }
    )


@router.post("/drafts", status_code=201)
async def draft(section_id: UUID, body: DraftInput, db: DB, actor: Actor):
    course, _, _ = await owned_section(db, section_id, actor.id)
    if course.confirmed_revision != body.base_course_revision:
        raise conflict()
    return ok(
        await new_draft(
            db,
            course,
            section_id,
            actor.id,
            body.payload.model_dump(mode="json"),
            replace_id=body.replace_version_id,
            replace_revision=body.replace_revision,
        )
    )


@router.patch("")
async def edit(section_id: UUID, body: PatchInput, db: DB, actor: Actor):
    course, _, _ = await owned_section(db, section_id, actor.id)
    version = await owned_version(db, course.id, section_id, body.version_id)
    if (
        version.status != "DRAFT"
        or version.revision != body.expected_revision
        or version.base_course_revision != body.base_course_revision
        or course.confirmed_revision != body.base_course_revision
    ):
        raise conflict()
    payload = body.payload.model_dump(mode="json")
    summary = await changes(db, section_id, payload)
    value = await db.execute(
        update(StructureVersion)
        .where(
            StructureVersion.id == version.id,
            StructureVersion.revision == body.expected_revision,
            StructureVersion.status == "DRAFT",
        )
        .values(payload=payload, revision=body.expected_revision + 1, change_summary=summary)
    )
    if value.rowcount != 1:
        raise conflict()
    db.add(
        StructureEvent(
            version_id=version.id,
            actor_id=actor.id,
            action="EDITED",
            details={"revision": body.expected_revision + 1},
        )
    )
    await db.commit()
    await db.refresh(version)
    return ok(version_data(version))


@router.post("/confirm")
async def apply(section_id: UUID, body: ConfirmInput, db: DB, actor: Actor):
    course, _, _ = await owned_section(db, section_id, actor.id)
    version = await owned_version(db, course.id, section_id, body.version_id)
    return ok(
        await confirm(
            db,
            course,
            section_id,
            version,
            actor.id,
            body.expected_revision,
            body.base_course_revision,
            body.accept_archives,
        )
    )


@router.post("/generate", status_code=201)
async def generate(section_id: UUID, body: GenerateInput, request: Request, db: DB, actor: Actor):
    await limit(request, "ai", str(actor.id))
    actor_id = actor.id
    course, section, chapter = await owned_section(db, section_id, actor_id)
    base, course_id = course.confirmed_revision, course.id
    if base != body.base_course_revision:
        raise conflict()
    check_replacement(
        await latest_draft(db, section_id), body.replace_version_id, body.replace_revision
    )
    context = {
        "course_title": course.title,
        "subject": course.subject,
        "textbook": course.textbook,
        "learning_goal": course.learning_goal,
        "knowledge_basis": "model_knowledge",
        "adjacent_sections": list(
            await db.scalars(
                select(Section.title)
                .where(
                    Section.chapter_id == chapter.id,
                    Section.archived.is_(False),
                    Section.order_index.between(section.order_index - 1, section.order_index + 1),
                    Section.id != section_id,
                )
                .order_by(Section.order_index)
            )
        ),
        "chapter_title": chapter.title,
        "section": {
            "id": str(section.id),
            "title": section.title,
            "page_start": section.page_start,
            "page_end": section.page_end,
        },
        "existing_knowledge_points": [
            {
                "id": str(p.id),
                **{
                    k: getattr(p, k)
                    for k in (
                        "title",
                        "description",
                        "learning_objectives",
                        "importance",
                        "mastery_criteria",
                    )
                },
            }
            for p in await points(db, section_id)
        ],
    }
    serialized = json.dumps(context, ensure_ascii=False)
    if len(serialized) > 22000:
        raise AppError("CONTEXT_TOO_LARGE", "当前小节内容过长，请手动编辑知识草稿")
    await db.rollback()
    call = Call(
        task_type="knowledge_extraction",
        prompt_version="knowledge-extract-v2",
        messages=[Message(role="system", content=PROMPT), Message(role="user", content=serialized)],
        task_context=context,
        output_schema=output_schema(),
        max_output_tokens=8192,
        timeout=90,
    )
    target, sink, log_id = await prepare(
        request, db, actor_id, body.provider_id, body.model_id, call
    )
    source = {
        "kind": "ai",
        "knowledge_basis": "model_knowledge",
        "prompt_version": call.prompt_version,
        "model_name": target.model_name,
        "provider_id": str(body.provider_id),
        "model_id": str(body.model_id),
        "log_id": str(log_id),
        "context": context,
        "base_course_revision": base,
    }
    run_id = uuid4()
    db.add(
        WorkflowRun(
            id=run_id,
            user_id=actor_id,
            course_id=course_id,
            workflow_type="KNOWLEDGE_EXTRACTION",
            input_data=source,
        )
    )
    await db.commit()
    result = None
    try:
        result = await request.app.state.ai_gateway.execute(target, call, sink)
        payload = KnowledgeInput.model_validate(result.structured).model_dump(mode="json")
        course, current_section, current_chapter = await owned_section(db, section_id, actor_id)
        if course.confirmed_revision != base or any(
            (
                course.title != context["course_title"],
                course.subject != context["subject"],
                course.textbook != context["textbook"],
                course.learning_goal != context["learning_goal"],
                current_section.title != context["section"]["title"],
                current_chapter.title != context["chapter_title"],
            )
        ):
            raise conflict()
        await db.execute(
            update(WorkflowRun)
            .where(WorkflowRun.id == run_id)
            .values(
                status="SUCCEEDED",
                output_data={"raw_output": result.text, "structured": payload},
                validation_result={"valid": True},
            )
        )
        return ok(
            await new_draft(
                db,
                course,
                section_id,
                actor_id,
                payload,
                source,
                result.text,
                run_id,
                body.replace_version_id,
                body.replace_revision,
            )
        )
    except BaseException as error:
        await db.rollback()
        code = error.code if isinstance(error, (AppError, AIError)) else "INVALID_STRUCTURE"
        failed_status = "CANCELLED" if isinstance(error, asyncio.CancelledError) else "FAILED"

        async def record_failure():
            async with request.app.state.resources.session() as audit_db:
                await audit_db.execute(
                    update(WorkflowRun)
                    .where(WorkflowRun.id == run_id)
                    .values(
                        status=failed_status,
                        output_data={"raw_output": result.text} if result else {},
                        validation_result={"valid": False},
                        error_message=code,
                    )
                )
                await audit_db.commit()

        await asyncio.shield(record_failure())
        if isinstance(error, (AIError, ValidationError)):
            raise AppError(
                "KNOWLEDGE_GENERATION_FAILED", "知识点生成失败，请检查模型后重试", 502
            ) from None
        raise
