"""Storage for new frozen plans; callers own authorization and the transaction."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.knowledge.models import KnowledgePoint
from app.learning.contracts import LessonPlan, LessonPlanDraft
from app.learning.models import LearningConversation, LearningLessonPlan


class PlanSourceChanged(ValueError):
    """The plan draft no longer matches its conversation's source knowledge version."""


async def insert_plan(
    db: AsyncSession,
    *,
    conversation_id: UUID,
    knowledge_point_id: UUID,
    content_version_id: UUID,
    draft: LessonPlanDraft,
) -> LessonPlan:
    """Append a plan for a new question. No progress is created or changed here."""
    source = await db.scalar(
        select(KnowledgePoint.id)
        .join(LearningConversation, LearningConversation.knowledge_point_id == KnowledgePoint.id)
        .where(
            LearningConversation.id == conversation_id,
            KnowledgePoint.id == knowledge_point_id,
            KnowledgePoint.content_version_id == content_version_id,
            KnowledgePoint.archived_at.is_(None),
        )
    )
    if source is None:
        raise PlanSourceChanged("Plan source does not match the conversation and knowledge version")

    payload = draft.model_dump(mode="json")
    plan = LessonPlan.model_validate(
        {
            **payload,
            "plan_id": uuid4(),
            "question_id": uuid4(),
            "knowledge_point_id": source,
            "plan_version": 1,
            "created_at": datetime.now(UTC),
        }
    )
    db.add(
        LearningLessonPlan(
            plan_id=plan.plan_id,
            question_id=plan.question_id,
            conversation_id=conversation_id,
            knowledge_point_id=plan.knowledge_point_id,
            content_version_id=content_version_id,
            plan_version=plan.plan_version,
            created_at=plan.created_at.replace(tzinfo=None),
            payload=payload,
        )
    )
    await db.flush()
    return plan


async def read_plan(db: AsyncSession, *, conversation_id: UUID, plan_id: UUID) -> LessonPlan | None:
    record = await db.scalar(
        select(LearningLessonPlan).where(
            LearningLessonPlan.conversation_id == conversation_id,
            LearningLessonPlan.plan_id == plan_id,
        )
    )
    if record is None:
        return None
    return LessonPlan.model_validate(
        {
            **record.payload,
            "plan_id": record.plan_id,
            "question_id": record.question_id,
            "knowledge_point_id": record.knowledge_point_id,
            "plan_version": record.plan_version,
            "created_at": record.created_at.replace(tzinfo=UTC),
        }
    )
