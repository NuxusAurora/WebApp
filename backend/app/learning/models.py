from uuid import UUID

from sqlalchemy import ForeignKey, Index, UniqueConstraint
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
