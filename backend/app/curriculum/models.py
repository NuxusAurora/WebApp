from datetime import datetime
from uuid import UUID

from sqlalchemy import JSON, CheckConstraint, ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base, Record


class Chapter(Record, Base):
    __tablename__ = "chapters"
    course_id: Mapped[UUID] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    order_index: Mapped[int]
    page_start: Mapped[int | None]
    page_end: Mapped[int | None]
    archived: Mapped[bool] = mapped_column(default=False)


class Section(Record, Base):
    __tablename__ = "sections"
    chapter_id: Mapped[UUID] = mapped_column(
        ForeignKey("chapters.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    order_index: Mapped[int]
    page_start: Mapped[int | None]
    page_end: Mapped[int | None]
    archived: Mapped[bool] = mapped_column(default=False)


class WorkflowRun(Record, Base):
    __tablename__ = "workflow_runs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('RUNNING','SUCCEEDED','FAILED','CANCELLED')", name="ck_workflow_status"
        ),
    )
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    course_id: Mapped[UUID] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), index=True
    )
    workflow_type: Mapped[str] = mapped_column(String(40), default="CURRICULUM_PARSE")
    status: Mapped[str] = mapped_column(String(20), default="RUNNING")
    input_data: Mapped[dict] = mapped_column(JSON)
    output_data: Mapped[dict] = mapped_column(JSON, default=dict)
    validation_result: Mapped[dict] = mapped_column(JSON, default=dict)
    error_message: Mapped[str] = mapped_column(String(80), default="")


class StructureVersion(Record, Base):
    __tablename__ = "structure_versions"
    __table_args__ = (
        CheckConstraint("status IN ('DRAFT','CONFIRMED','SUPERSEDED')", name="ck_structure_status"),
        CheckConstraint("structure_type = 'CURRICULUM'", name="ck_structure_type"),
        Index(
            "uq_curriculum_confirmed",
            "course_id",
            unique=True,
            postgresql_where=text("status = 'CONFIRMED'"),
            sqlite_where=text("status = 'CONFIRMED'"),
        ),
    )
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    course_id: Mapped[UUID] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), index=True
    )
    structure_type: Mapped[str] = mapped_column(String(20), default="CURRICULUM")
    status: Mapped[str] = mapped_column(String(20), default="DRAFT")
    revision: Mapped[int] = mapped_column(default=1)
    base_course_revision: Mapped[int]
    applied_course_revision: Mapped[int | None]
    payload: Mapped[dict] = mapped_column(JSON)
    id_mapping: Mapped[dict] = mapped_column(JSON, default=dict)
    source: Mapped[dict] = mapped_column(JSON, default=dict)
    generation_run_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("workflow_runs.id", ondelete="SET NULL")
    )
    raw_output: Mapped[str] = mapped_column(Text, default="")
    confirmed_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    confirmed_at: Mapped[datetime | None]
    change_summary: Mapped[dict] = mapped_column(JSON, default=dict)


class StructureEvent(Record, Base):
    __tablename__ = "structure_events"
    version_id: Mapped[UUID] = mapped_column(
        ForeignKey("structure_versions.id", ondelete="CASCADE"), index=True
    )
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    action: Mapped[str] = mapped_column(String(20))
    details: Mapped[dict] = mapped_column(JSON)
