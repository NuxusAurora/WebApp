import asyncio
import base64
from pathlib import Path
from typing import Literal
from urllib.parse import unquote
from uuid import UUID, uuid4

from fastapi import APIRouter, Request
from pydantic import Field, ValidationError, model_validator
from sqlalchemy import select, update
from starlette.concurrency import run_in_threadpool

from app.ai.contracts import AIError, Call, ImageInput, Message
from app.ai.service import owned_model, prepare
from app.auth import DB, Actor, Input, limit
from app.courses import owned, owned_by_id, upload_data
from app.curriculum.contracts import CurriculumInput, output_schema
from app.curriculum.models import StructureEvent, StructureVersion, WorkflowRun
from app.curriculum.ocr import MAX_IMAGE, normalize_image
from app.curriculum.service import (
    changes,
    confirm,
    conflict,
    new_draft,
    owned_version,
    snapshot,
    version_data,
)
from app.errors import AppError, ok
from app.models import Upload

router = APIRouter(prefix="/api/v1/courses/{course_id}/curriculum")
PROMPT = (Path(__file__).resolve().parents[2] / "prompts/curriculum/parse-v1.md").read_text(
    encoding="utf-8"
)
VISION_PROMPT = (Path(__file__).resolve().parents[2] / "prompts/curriculum/vision-v1.md").read_text(
    encoding="utf-8"
)


class ImagesInput(Input):
    image_ids: list[UUID] = Field(min_length=1, max_length=5)


class ParseInput(Input):
    ocr_text: str = Field(default="", max_length=20000)
    input_mode: Literal["text", "images"] = "text"
    image_ids: list[UUID] = Field(default_factory=list, max_length=5)
    provider_id: UUID
    model_id: UUID

    @model_validator(mode="after")
    def source_required(self):
        if self.input_mode == "text" and not self.ocr_text.strip():
            raise ValueError("Directory text is required")
        if self.input_mode == "images" and not self.image_ids:
            raise ValueError("Directory images are required")
        return self


class DraftInput(Input):
    payload: CurriculumInput
    base_course_revision: int = Field(ge=0)


class PatchInput(DraftInput):
    version_id: UUID
    revision: int = Field(ge=1)


class ConfirmInput(Input):
    version_id: UUID
    revision: int = Field(ge=1)
    base_course_revision: int = Field(ge=0)
    accept_archives: bool = False


async def image_records(db, course_id, ids):
    if len(set(ids)) != len(ids):
        raise AppError("VALIDATION_ERROR", "图片不能重复")
    rows = (
        await db.scalars(
            select(Upload).where(
                Upload.course_id == course_id, Upload.purpose == "curriculum", Upload.id.in_(ids)
            )
        )
    ).all()
    by_id = {row.id: row for row in rows}
    if len(rows) != len(ids):
        raise AppError("NOT_FOUND", "目录图片不存在", 404)
    return [by_id[key] for key in ids]


@router.get("/images")
async def images(course_id: UUID, db: DB, actor: Actor):
    await owned(db, course_id, actor)
    rows = (
        await db.scalars(
            select(Upload)
            .where(Upload.course_id == course_id, Upload.purpose == "curriculum")
            .order_by(Upload.created_at.desc())
            .limit(100)
        )
    ).all()
    return ok([upload_data(row) for row in rows])


@router.post("/images", status_code=201)
async def upload_image(course_id: UUID, request: Request, db: DB, actor: Actor):
    await limit(request, "ocr", str(actor.id))
    await owned(db, course_id, actor)
    filename = unquote(request.headers.get("X-Filename", ""))
    if (
        not filename
        or len(filename) > 190
        or any(c in filename for c in "/\\")
        or any(ord(c) < 32 for c in filename)
    ):
        raise AppError("FILE_TYPE", "图片文件名无效")
    content = await request.body()
    if len(content) > MAX_IMAGE:
        raise AppError("FILE_SIZE", "图片不能超过 5 MiB", 413)
    normalized = await run_in_threadpool(normalize_image, content)
    key = f"{actor.id}/{course_id}/{uuid4()}.png"
    row = Upload(
        course_id=course_id,
        filename=filename,
        object_key=key,
        size=len(normalized),
        media_type="image/png",
        purpose="curriculum",
    )
    try:
        await run_in_threadpool(request.app.state.store.put, key, normalized)
        db.add(row)
        await db.commit()
    except BaseException:
        await run_in_threadpool(request.app.state.store.delete, key)
        raise
    return ok(upload_data(row))


@router.post("/ocr")
async def ocr(course_id: UUID, body: ImagesInput, request: Request, db: DB, actor: Actor):
    await limit(request, "ocr", str(actor.id))
    await owned(db, course_id, actor)
    actor_id = actor.id
    records = await image_records(db, course_id, body.image_ids)
    keys = [row.object_key for row in records]
    await db.rollback()  # Never hold a course lock across storage/OCR.
    parts = []
    try:
        async with asyncio.timeout(120):
            for key in keys:
                content = await run_in_threadpool(request.app.state.store.read, key, MAX_IMAGE)
                parts.append(await request.app.state.curriculum_ocr.recognize(content))
    except TimeoutError:
        raise AppError("OCR_TIMEOUT", "识别超时，请减少图片后重试", 504) from None
    text = "\n\n".join(parts)
    if len(text) > 20000:
        raise AppError("OCR_TOO_LONG", "识别文字超过 20000 字，请分批处理")
    await owned_by_id(db, course_id, actor_id)
    await image_records(db, course_id, body.image_ids)
    return ok({"ocr_text": text, "image_ids": body.image_ids, "engine": "tesseract-chi_sim-eng"})


@router.get("")
async def current(course_id: UUID, db: DB, actor: Actor):
    course = await owned(db, course_id, actor)
    versions = (
        await db.scalars(
            select(StructureVersion)
            .where(StructureVersion.course_id == course_id)
            .order_by(StructureVersion.created_at.desc(), StructureVersion.id)
            .limit(100)
        )
    ).all()
    return ok(
        {
            "confirmed_revision": course.confirmed_revision,
            "curriculum": await snapshot(db, course),
            "versions": [version_data(v) for v in versions],
        }
    )


@router.post("/parse", status_code=201)
async def parse(course_id: UUID, body: ParseInput, request: Request, db: DB, actor: Actor):
    await limit(request, "ai", str(actor.id))
    course = await owned(db, course_id, actor)
    actor_id = actor.id
    base = course.confirmed_revision
    context = {
        "textbook": course.textbook,
        "course_title": course.title,
        "image_count": len(body.image_ids),
        "input_mode": body.input_mode,
    }
    records = await image_records(db, course_id, body.image_ids)
    keys = [row.object_key for row in records]
    vision = body.input_mode == "images"
    if vision:
        model = await owned_model(db, actor_id, body.model_id)
        if not model.capabilities.get("vision"):
            raise AppError("VISION_MODEL_REQUIRED", "请选择已启用图片识别能力的模型")
    await db.rollback()
    inputs = []
    if vision:
        try:
            async with asyncio.timeout(30):
                for key in keys:
                    content = await run_in_threadpool(request.app.state.store.read, key, MAX_IMAGE)
                    inputs.append(
                        ImageInput(
                            data_url="data:image/png;base64," + base64.b64encode(content).decode()
                        )
                    )
        except TimeoutError:
            raise AppError("IMAGE_READ_TIMEOUT", "图片读取超时，请重试", 504) from None
    call = Call(
        task_type="curriculum_parse",
        prompt_version="curriculum-vision-v1" if vision else "curriculum-parse-v1",
        task_context=context,
        messages=[
            Message(role="system", content=VISION_PROMPT if vision else PROMPT),
            Message(
                role="user", content=body.ocr_text or "按图片顺序提取教材目录，只输出规定 JSON。"
            ),
        ],
        images=inputs,
        output_schema=output_schema(strict=vision),
        max_output_tokens=8192,
        timeout=90,
    )
    target, sink, log_id = await prepare(
        request, db, actor_id, body.provider_id, body.model_id, call
    )
    source = {
        "kind": "ai",
        "prompt_version": call.prompt_version,
        "model_name": target.model_name,
        "provider_id": str(body.provider_id),
        "model_id": str(body.model_id),
        "log_id": str(log_id),
        "ocr_text": body.ocr_text,
        "input_mode": body.input_mode,
        "image_ids": [str(key) for key in body.image_ids],
    }
    run_id = uuid4()
    run = WorkflowRun(id=run_id, user_id=actor_id, course_id=course_id, input_data=source)
    db.add(run)
    await db.commit()
    result = None
    try:
        result = await request.app.state.ai_gateway.execute(target, call, sink)
        payload = CurriculumInput.model_validate(result.structured).model_dump()
        course = await owned_by_id(db, course_id, actor_id)
        await image_records(db, course_id, body.image_ids)
        run.status = "SUCCEEDED"
        run.output_data = {"raw_output": result.text, "structured": result.structured}
        run.validation_result = {"valid": True}
        return ok(await new_draft(db, course, actor_id, payload, source, result.text, base, run_id))
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
                "CURRICULUM_PARSE_FAILED", "目录解析失败，请检查模型、图片或文字后重试", 502
            ) from None
        raise


@router.post("/drafts", status_code=201)
async def draft(course_id: UUID, body: DraftInput, db: DB, actor: Actor):
    course = await owned(db, course_id, actor)
    if course.confirmed_revision != body.base_course_revision:
        raise conflict()
    return ok(await new_draft(db, course, actor.id, body.payload.model_dump()))


@router.patch("")
async def edit(course_id: UUID, body: PatchInput, db: DB, actor: Actor):
    course = await owned(db, course_id, actor)
    version = await owned_version(db, course_id, body.version_id)
    if (
        version.status != "DRAFT"
        or version.revision != body.revision
        or version.base_course_revision != body.base_course_revision
        or course.confirmed_revision != body.base_course_revision
    ):
        raise conflict()
    payload = body.payload.model_dump()
    summary = await changes(db, course_id, payload)
    # Compare-and-swap also protects lightweight SQLite test/development databases.
    value = await db.execute(
        update(StructureVersion)
        .where(
            StructureVersion.id == version.id,
            StructureVersion.revision == body.revision,
            StructureVersion.status == "DRAFT",
        )
        .values(payload=payload, revision=body.revision + 1, change_summary=summary)
    )
    if value.rowcount != 1:
        raise conflict()
    db.add(
        StructureEvent(
            version_id=version.id,
            actor_id=actor.id,
            action="EDITED",
            details={"revision": body.revision + 1},
        )
    )
    await db.commit()
    await db.refresh(version)
    return ok(version_data(version))


@router.post("/confirm")
async def apply(course_id: UUID, body: ConfirmInput, db: DB, actor: Actor):
    course = await owned(db, course_id, actor)
    version = await owned_version(db, course_id, body.version_id)
    return ok(
        await confirm(
            db,
            course,
            version,
            actor.id,
            body.revision,
            body.base_course_revision,
            body.accept_archives,
        )
    )
