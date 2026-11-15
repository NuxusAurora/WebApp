from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Query
from sqlalchemy import select, tuple_

from app.auth import DB, Actor
from app.courses import owned_by_id
from app.errors import AppError, ok
from app.learning.models import LearningTextbook
from app.models import Course, now

router = APIRouter(prefix="/api/v1/learning/projects/textbooks")
PAGE_SIZE = 6


def textbook_title(course):
    return course.textbook.strip() or course.title


def parse_cursor(before):
    try:
        timestamp, item_id = before.split("/", 1)
        when = datetime.fromisoformat(timestamp)
        if when.tzinfo is not None:
            raise ValueError
        return when, UUID(item_id)
    except ValueError:
        raise AppError("VALIDATION_ERROR", "列表位置无效，请重新加载", 422) from None


def visible_textbooks(user_id):
    return (
        select(Course, LearningTextbook.added_at)
        .join(LearningTextbook, LearningTextbook.course_id == Course.id)
        .where(Course.user_id == user_id, Course.status == "active")
    )


@router.get("")
async def textbooks(db: DB, actor: Actor, before: str | None = Query(default=None, max_length=80)):
    query = visible_textbooks(actor.id)
    if before is not None:
        query = query.where(tuple_(LearningTextbook.added_at, Course.id) < parse_cursor(before))
    rows = (
        await db.execute(
            query.order_by(LearningTextbook.added_at.desc(), Course.id.desc()).limit(PAGE_SIZE + 1)
        )
    ).all()
    page = rows[:PAGE_SIZE]
    next_cursor = None
    if len(rows) > PAGE_SIZE:
        course, when = page[-1]
        next_cursor = f"{when.isoformat()}/{course.id}"
    return ok(
        {
            "items": [{"id": course.id, "title": textbook_title(course)} for course, _ in page],
            "next_cursor": next_cursor,
        }
    )


@router.put("/{course_id}")
async def show_textbook(course_id: UUID, db: DB, actor: Actor):
    course = await owned_by_id(db, course_id, actor.id)
    if course.status != "active":
        raise AppError("NOT_FOUND", "课程已归档", 404)
    entry = await db.get(LearningTextbook, course.id)
    if entry is None:
        db.add(LearningTextbook(course_id=course.id))
    else:
        entry.added_at = now()
    await db.commit()
    return ok()


@router.delete("/{course_id}")
async def hide_textbook(course_id: UUID, db: DB, actor: Actor):
    course = await owned_by_id(db, course_id, actor.id)
    entry = await db.get(LearningTextbook, course.id)
    if entry is not None:
        await db.delete(entry)
    await db.commit()
    return ok()
