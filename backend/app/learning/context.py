from sqlalchemy import select

from app.ai.models import AIModel, AIProvider
from app.curriculum.models import Chapter, Section
from app.errors import AppError
from app.knowledge.models import KnowledgePoint
from app.learning.models import LearningConversation, LearningProject
from app.models import Course


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


async def teaching_model(db, actor_id):
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
    return config


def learning_material(course, section, point):
    return {
        "课程": course.title,
        "教材": course.textbook,
        "学习目标": course.learning_goal[:500],
        "小节": section.title,
        "知识点": point.title,
        "定义": point.description,
        "学习要求": point.learning_objectives,
    }
