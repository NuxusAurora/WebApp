from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import func, select, tuple_

from app.auth import DB, Actor
from app.curriculum.models import Chapter, Section
from app.errors import AppError, ok
from app.knowledge.models import KnowledgePoint
from app.knowledge.service import owned_section, points
from app.learning.models import LearningConversation, LearningProject
from app.models import Course, now

router = APIRouter(prefix="/api/v1/learning/projects")
PAGE_SIZE = 6


class OpenProject(BaseModel):
    knowledge_point_id: UUID | None = None


class AddProject(OpenProject):
    section_id: UUID


def textbook_title(course):
    return course.textbook.strip() or course.title


def summary(project, section, course):
    return {
        "id": project.id,
        "section_id": section.id,
        "section_title": section.title,
        "chapter_id": section.chapter_id,
        "course_id": course.id,
        "course_title": course.title,
        "textbook_title": textbook_title(course),
    }


async def learning_section(db, section_id, user_id):
    # The existing course lock serializes opens with changes to the confirmed outline.
    course, section, _ = await owned_section(db, section_id, user_id)
    if course.status != "active":
        raise AppError("NOT_FOUND", "小节不存在或已归档", 404)
    return course, section


async def open_project(db, project, section, course, point_id=None):
    ordered = await points(db, section.id)
    by_id = {point.id: point for point in ordered}
    if point_id is not None and point_id not in by_id:
        raise AppError("NOT_FOUND", "知识点不存在或已归档", 404)
    selected = by_id.get(point_id or project.current_point_id) or (ordered[0] if ordered else None)
    conversation = None
    if selected is not None:
        conversation = await db.scalar(
            select(LearningConversation).where(
                LearningConversation.project_id == project.id,
                LearningConversation.knowledge_point_id == selected.id,
            )
        )
        if conversation is None:
            conversation = LearningConversation(
                project_id=project.id,
                knowledge_point_id=selected.id,
                content_version_id=selected.content_version_id,
            )
            db.add(conversation)
    project.current_point_id = selected.id if selected else None
    project.updated_at = now()
    await db.commit()
    return ok(
        {
            **summary(project, section, course),
            "knowledge_points": [{"id": point.id, "title": point.title} for point in ordered],
            "conversation": {"id": conversation.id, "knowledge_point_id": selected.id}
            if conversation
            else None,
        }
    )


def parse_cursor(before):
    try:
        timestamp, item_id = before.split("/", 1)
        when = datetime.fromisoformat(timestamp)
        if when.tzinfo is not None:
            raise ValueError
        return when, UUID(item_id)
    except ValueError:
        raise AppError("VALIDATION_ERROR", "列表位置无效，请重新加载", 422) from None


def recent_textbooks(user_id):
    # Keep recency without materializing a project for each section in a textbook.
    return (
        select(Chapter.course_id, func.max(LearningProject.updated_at).label("last_opened"))
        .select_from(LearningProject)
        .join(Section, Section.id == LearningProject.section_id)
        .join(Chapter, Chapter.id == Section.chapter_id)
        .where(LearningProject.user_id == user_id)
        .group_by(Chapter.course_id)
        .subquery()
    )


def active_textbooks(user_id):
    has_outline = (
        select(Chapter.id)
        .where(Chapter.course_id == Course.id, Chapter.archived.is_(False))
        .exists()
    )
    return Course.user_id == user_id, Course.status == "active", has_outline


@router.get("/textbooks")
async def textbooks(db: DB, actor: Actor, before: str | None = Query(default=None, max_length=80)):
    recent = recent_textbooks(actor.id)
    opened = func.coalesce(recent.c.last_opened, Course.created_at)
    query = (
        select(Course, opened)
        .outerjoin(recent, recent.c.course_id == Course.id)
        .where(*active_textbooks(actor.id))
    )
    if before is not None:
        query = query.where(tuple_(opened, Course.id) < parse_cursor(before))
    rows = (
        await db.execute(query.order_by(opened.desc(), Course.id.desc()).limit(PAGE_SIZE + 1))
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


@router.get("/textbooks/{course_id}")
async def textbook_outline(course_id: UUID, db: DB, actor: Actor):
    course = await db.scalar(
        select(Course).where(Course.id == course_id, *active_textbooks(actor.id))
    )
    if course is None:
        raise AppError("NOT_FOUND", "教材不存在或已归档", 404)
    rows = (
        await db.execute(
            select(
                Chapter.id,
                Chapter.title,
                Section.id,
                Section.title,
                KnowledgePoint.id,
                KnowledgePoint.title,
                KnowledgePoint.status,
            )
            .outerjoin(Section, (Section.chapter_id == Chapter.id) & Section.archived.is_(False))
            .outerjoin(
                KnowledgePoint,
                (KnowledgePoint.section_id == Section.id) & KnowledgePoint.archived_at.is_(None),
            )
            .where(Chapter.course_id == course.id, Chapter.archived.is_(False))
            .order_by(
                Chapter.order_index,
                Chapter.id,
                Section.order_index,
                Section.id,
                KnowledgePoint.order_index,
                KnowledgePoint.id,
            )
        )
    ).all()
    chapters = {}
    sections = {}
    for chapter_id, title, section_id, section_title, point_id, point_title, status in rows:
        chapter = chapters.setdefault(
            chapter_id, {"id": chapter_id, "title": title, "sections": []}
        )
        if section_id is None:
            continue
        if section_id not in sections:
            sections[section_id] = {
                "id": section_id,
                "title": section_title,
                "knowledge_points": [],
            }
            chapter["sections"].append(sections[section_id])
        if point_id is not None:
            sections[section_id]["knowledge_points"].append(
                {"id": point_id, "title": point_title, "studied": status != "NOT_STARTED"}
            )
    return ok({"chapters": list(chapters.values())})


@router.get("")
async def recent(db: DB, actor: Actor, before: str | None = Query(default=None, max_length=80)):
    query = (
        select(LearningProject, Section, Course)
        .join(Section, Section.id == LearningProject.section_id)
        .join(Chapter, Chapter.id == Section.chapter_id)
        .join(Course, Course.id == Chapter.course_id)
        .where(
            LearningProject.user_id == actor.id,
            Course.user_id == actor.id,
            Course.status == "active",
            Chapter.archived.is_(False),
            Section.archived.is_(False),
        )
    )
    if before is not None:
        query = query.where(
            tuple_(LearningProject.updated_at, LearningProject.id) < parse_cursor(before)
        )
    rows = (
        await db.execute(
            query.order_by(LearningProject.updated_at.desc(), LearningProject.id.desc()).limit(
                PAGE_SIZE + 1
            )
        )
    ).all()
    next_cursor = None
    if len(rows) > PAGE_SIZE:
        rows = rows[:PAGE_SIZE]
        last = rows[-1].LearningProject
        next_cursor = f"{last.updated_at.isoformat()}/{last.id}"
    return ok(
        {
            "items": [summary(project, section, course) for project, section, course in rows],
            "next_cursor": next_cursor,
        }
    )


@router.post("")
async def add(body: AddProject, db: DB, actor: Actor):
    course, section = await learning_section(db, body.section_id, actor.id)
    project = await db.scalar(
        select(LearningProject).where(
            LearningProject.user_id == actor.id, LearningProject.section_id == section.id
        )
    )
    if project is None:
        project = LearningProject(user_id=actor.id, section_id=section.id)
        db.add(project)
        await db.flush()
    return await open_project(db, project, section, course, body.knowledge_point_id)


@router.post("/{project_id}/open")
async def reopen(project_id: UUID, body: OpenProject, db: DB, actor: Actor):
    section_id = await db.scalar(
        select(LearningProject.section_id).where(
            LearningProject.id == project_id, LearningProject.user_id == actor.id
        )
    )
    if section_id is None:
        raise AppError("NOT_FOUND", "对话项目不存在", 404)
    course, section = await learning_section(db, section_id, actor.id)
    project = await db.get(LearningProject, project_id)
    if project is None:
        raise AppError("NOT_FOUND", "对话项目不存在", 404)
    return await open_project(db, project, section, course, body.knowledge_point_id)
