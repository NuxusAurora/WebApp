from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import select, tuple_

from app.auth import DB, Actor
from app.curriculum.models import Chapter, Section
from app.errors import AppError, ok
from app.knowledge.service import owned_section, points
from app.learning.models import LearningConversation, LearningProject
from app.models import Course, now

router = APIRouter(prefix="/api/v1/learning/projects")
PAGE_SIZE = 6


class AddProject(BaseModel):
    section_id: UUID


class OpenProject(BaseModel):
    knowledge_point_id: UUID | None = None


def summary(project, section, course):
    return {
        "id": project.id,
        "section_id": section.id,
        "section_title": section.title,
        "course_id": course.id,
        "course_title": course.title,
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
        try:
            timestamp, item_id = before.split("/", 1)
            when = datetime.fromisoformat(timestamp)
            if when.tzinfo is not None:
                raise ValueError
            cursor_id = UUID(item_id)
        except ValueError:
            raise AppError("VALIDATION_ERROR", "列表位置无效，请重新加载", 422) from None
        query = query.where(
            tuple_(LearningProject.updated_at, LearningProject.id) < (when, cursor_id)
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
    return await open_project(db, project, section, course)


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
