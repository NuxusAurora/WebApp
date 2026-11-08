from uuid import UUID, uuid4

from fastapi import APIRouter, Request
from pydantic import Field
from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from app.auth import DB, Actor, Input
from app.errors import AppError, ok
from app.models import Course, Upload
from app.storage import MAX_UPLOAD, inspect_text

router = APIRouter(prefix="/api/v1/courses")


class CourseInput(Input):
    title: str = Field(min_length=1, max_length=200, pattern=r"\S")
    subject: str = Field(default="", max_length=200)
    textbook: str = Field(default="", max_length=300)
    learning_goal: str = Field(default="", max_length=10000)


class CoursePatch(Input):
    title: str | None = Field(default=None, min_length=1, max_length=200, pattern=r"\S")
    subject: str | None = Field(default=None, max_length=200)
    textbook: str | None = Field(default=None, max_length=300)
    learning_goal: str | None = Field(default=None, max_length=10000)
    status: str | None = Field(default=None, pattern="^(active|archived)$")


def course_data(course):
    return {
        name: getattr(course, name)
        for name in (
            "id",
            "title",
            "subject",
            "textbook",
            "learning_goal",
            "status",
            "confirmed_revision",
            "created_at",
            "updated_at",
        )
    }


async def owned(db, course_id, user):
    course = await db.scalar(
        select(Course).where(Course.id == course_id, Course.user_id == user.id).with_for_update()
    )
    if not course:
        raise AppError("NOT_FOUND", "课程不存在", 404)
    return course


@router.get("")
async def listing(db: DB, user: Actor, offset: int = 0):
    if offset < 0 or offset > 100000:
        raise AppError("VALIDATION_ERROR", "分页参数无效")
    courses = (
        await db.scalars(
            select(Course)
            .where(Course.user_id == user.id)
            .order_by(Course.created_at.desc(), Course.id)
            .offset(offset)
            .limit(100)
        )
    ).all()
    return ok([course_data(course) for course in courses])


@router.post("", status_code=201)
async def create(body: CourseInput, db: DB, user: Actor):
    course = Course(user_id=user.id, **body.model_dump())
    db.add(course)
    await db.commit()
    return ok(course_data(course))


@router.get("/{course_id}")
async def get(course_id: UUID, db: DB, user: Actor):
    return ok(course_data(await owned(db, course_id, user)))


@router.patch("/{course_id}")
async def update(course_id: UUID, body: CoursePatch, db: DB, user: Actor):
    course = await owned(db, course_id, user)
    for key, value in body.model_dump(exclude_unset=True).items():
        if value is None:
            raise AppError("VALIDATION_ERROR", "字段不能为 null")
        setattr(course, key, value)
    await db.commit()
    return ok(course_data(course))


@router.delete("/{course_id}")
async def remove(course_id: UUID, request: Request, db: DB, user: Actor):
    course = await owned(db, course_id, user)
    uploads = (await db.scalars(select(Upload).where(Upload.course_id == course.id))).all()
    # Storage failures retain metadata so that a retry can finish deleting objects.
    for upload in uploads:
        await run_in_threadpool(request.app.state.store.delete, upload.object_key)
        await db.delete(upload)
    await db.flush()
    await db.delete(course)
    await db.commit()
    return ok()


def upload_data(upload):
    return {
        "id": upload.id,
        "filename": upload.filename,
        "size": upload.size,
        "created_at": upload.created_at,
    }


@router.get("/{course_id}/uploads")
async def uploads(course_id: UUID, db: DB, user: Actor):
    await owned(db, course_id, user)
    rows = (
        await db.scalars(
            select(Upload)
            .where(Upload.course_id == course_id)
            .order_by(Upload.created_at.desc())
            .limit(100)
        )
    ).all()
    return ok([upload_data(row) for row in rows])


@router.post("/{course_id}/uploads", status_code=201)
async def upload(course_id: UUID, request: Request, db: DB, user: Actor):
    await owned(db, course_id, user)
    # Stream raw body: do not parse an unbounded multipart request before enforcing size.
    content = bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content) > MAX_UPLOAD:
            raise AppError("FILE_SIZE", "文件不能超过 1 MiB", 413)
    filename = request.headers.get("X-Filename", "")
    from urllib.parse import unquote

    filename = unquote(filename)
    inspect_text(filename, bytes(content))
    key = f"{user.id}/{course_id}/{uuid4()}.txt"
    record = Upload(course_id=course_id, filename=filename, object_key=key, size=len(content))
    store = request.app.state.store
    try:
        await run_in_threadpool(store.put, key, bytes(content))
        db.add(record)
        await db.commit()
    except BaseException:
        # Keep the object key recoverable in server logs only as an opaque record id if needed.
        await run_in_threadpool(store.delete, key)
        raise
    return ok(upload_data(record))


@router.get("/{course_id}/uploads/{upload_id}/download")
async def download(course_id: UUID, upload_id: UUID, request: Request, db: DB, user: Actor):
    await owned(db, course_id, user)
    record = await db.scalar(
        select(Upload).where(Upload.id == upload_id, Upload.course_id == course_id)
    )
    if not record:
        raise AppError("NOT_FOUND", "文件不存在", 404)
    url = await run_in_threadpool(request.app.state.store.download, record.object_key)
    return ok({"url": url, "expires_in": 60})


@router.delete("/{course_id}/uploads/{upload_id}")
async def delete_upload(course_id: UUID, upload_id: UUID, request: Request, db: DB, user: Actor):
    await owned(db, course_id, user)
    record = await db.scalar(
        select(Upload).where(Upload.id == upload_id, Upload.course_id == course_id)
    )
    if not record:
        raise AppError("NOT_FOUND", "文件不存在", 404)
    await run_in_threadpool(request.app.state.store.delete, record.object_key)
    await db.delete(record)
    await db.commit()
    return ok()
