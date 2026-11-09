from datetime import datetime
from uuid import UUID

from sqlalchemy import JSON, CheckConstraint, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base, Record


class KnowledgePoint(Record, Base):
    __tablename__ = "knowledge_points"
    __table_args__ = (
        CheckConstraint(
            "status IN ('NOT_STARTED','LEARNING','PRACTICING','NEEDS_REVIEW','MASTERED')",
            name="ck_knowledge_status",
        ),
        CheckConstraint("importance IN ('HIGH','MEDIUM','LOW')", name="ck_knowledge_importance"),
    )
    section_id: Mapped[UUID] = mapped_column(
        ForeignKey("sections.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    learning_objectives: Mapped[list] = mapped_column(JSON)
    importance: Mapped[str] = mapped_column(String(10))
    mastery_criteria: Mapped[list] = mapped_column(JSON)
    order_index: Mapped[int]
    status: Mapped[str] = mapped_column(String(20), default="NOT_STARTED")
    archived_at: Mapped[datetime | None]
    content_version_id: Mapped[UUID] = mapped_column(
        ForeignKey("structure_versions.id", deferrable=True, initially="DEFERRED")
    )
