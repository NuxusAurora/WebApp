from datetime import datetime
from uuid import UUID

from sqlalchemy import JSON, CheckConstraint, ForeignKey, Index, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base, Record


class LearningProject(Record, Base):
    __tablename__ = "learning_projects"
    __table_args__ = (
        UniqueConstraint("user_id", "section_id", name="uq_learning_project_user_section"),
        Index("ix_learning_project_recent", "user_id", "updated_at", "id"),
    )

    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    section_id: Mapped[UUID] = mapped_column(
        ForeignKey("sections.id", ondelete="CASCADE"), index=True
    )
    current_point_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("knowledge_points.id", ondelete="SET NULL")
    )


class LearningConversation(Record, Base):
    __tablename__ = "learning_conversations"
    __table_args__ = (
        UniqueConstraint("project_id", "knowledge_point_id", name="uq_learning_conversation_point"),
    )

    project_id: Mapped[UUID] = mapped_column(ForeignKey("learning_projects.id", ondelete="CASCADE"))
    knowledge_point_id: Mapped[UUID] = mapped_column(
        ForeignKey("knowledge_points.id", ondelete="CASCADE")
    )
    content_version_id: Mapped[UUID] = mapped_column(
        ForeignKey("structure_versions.id", deferrable=True, initially="DEFERRED")
    )


class LearningTurn(Record, Base):
    __tablename__ = "learning_turns"
    __table_args__ = (
        UniqueConstraint("conversation_id", "position", name="uq_learning_turn_position"),
        UniqueConstraint("conversation_id", "request_id", name="uq_learning_turn_request"),
    )

    conversation_id: Mapped[UUID] = mapped_column(
        ForeignKey("learning_conversations.id", ondelete="CASCADE")
    )
    position: Mapped[int]
    request_id: Mapped[UUID]
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text)
    question_id: Mapped[UUID | None] = mapped_column(index=True)


class LearningLessonRevision(Record, Base):
    __tablename__ = "learning_lesson_revisions"
    __table_args__ = (
        UniqueConstraint("conversation_id", "revision", name="uq_learning_lesson_revision"),
        UniqueConstraint("conversation_id", "request_id", name="uq_learning_lesson_request"),
        Index("ix_learning_revision_plan", "plan_id"),
    )

    conversation_id: Mapped[UUID] = mapped_column(
        ForeignKey("learning_conversations.id", ondelete="CASCADE")
    )
    revision: Mapped[int]
    request_id: Mapped[UUID]
    action: Mapped[str] = mapped_column(Text)
    response: Mapped[str] = mapped_column(Text)
    state: Mapped[dict] = mapped_column(JSON)
    plan_id: Mapped[UUID | None] = mapped_column(
        ForeignKey(
            "learning_lesson_plans.plan_id",
            name="fk_learning_revision_plan",
            deferrable=True,
            initially="DEFERRED",
        )
    )


class LearningLessonPlan(Base):
    """An immutable plan and its question; a conversation can contain many questions."""

    __tablename__ = "learning_lesson_plans"
    __table_args__ = (
        UniqueConstraint("question_id", name="uq_learning_lesson_plan_question"),
        CheckConstraint("plan_version >= 1", name="ck_learning_lesson_plan_version"),
        Index("ix_learning_lesson_plan_conversation", "conversation_id"),
    )

    plan_id: Mapped[UUID] = mapped_column(primary_key=True)
    question_id: Mapped[UUID]
    conversation_id: Mapped[UUID] = mapped_column(
        ForeignKey("learning_conversations.id", ondelete="CASCADE")
    )
    knowledge_point_id: Mapped[UUID] = mapped_column(
        ForeignKey("knowledge_points.id", ondelete="CASCADE")
    )
    content_version_id: Mapped[UUID] = mapped_column(
        ForeignKey("structure_versions.id", deferrable=True, initially="DEFERRED")
    )
    plan_version: Mapped[int]
    created_at: Mapped[datetime]
    payload: Mapped[dict] = mapped_column(JSON)
