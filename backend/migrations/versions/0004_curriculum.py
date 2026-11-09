"""Reviewed curriculum drafts, official nodes and private generation provenance."""

import sqlalchemy as sa
from alembic import op

revision = "0004_curriculum"
down_revision = "0003_ai_gateway"
branch_labels = None
depends_on = None


def record():
    return [
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    ]


def upgrade():
    op.add_column(
        "uploads",
        sa.Column("media_type", sa.String(80), nullable=False, server_default="text/plain"),
    )
    op.add_column(
        "uploads", sa.Column("purpose", sa.String(30), nullable=False, server_default="material")
    )
    op.create_table(
        "chapters",
        *record(),
        sa.Column(
            "course_id", sa.Uuid(), sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column("page_start", sa.Integer()),
        sa.Column("page_end", sa.Integer()),
        sa.Column("archived", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_chapters_course_id", "chapters", ["course_id"])
    op.create_table(
        "sections",
        *record(),
        sa.Column(
            "chapter_id",
            sa.Uuid(),
            sa.ForeignKey("chapters.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column("page_start", sa.Integer()),
        sa.Column("page_end", sa.Integer()),
        sa.Column("archived", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_sections_chapter_id", "sections", ["chapter_id"])
    op.create_table(
        "workflow_runs",
        *record(),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "course_id", sa.Uuid(), sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("workflow_type", sa.String(40), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("input_data", sa.JSON(), nullable=False),
        sa.Column("output_data", sa.JSON(), nullable=False),
        sa.Column("validation_result", sa.JSON(), nullable=False),
        sa.Column("error_message", sa.String(80), nullable=False),
        sa.CheckConstraint(
            "status IN ('RUNNING','SUCCEEDED','FAILED','CANCELLED')", name="ck_workflow_status"
        ),
    )
    op.create_index("ix_workflow_runs_course_id", "workflow_runs", ["course_id"])
    op.create_table(
        "structure_versions",
        *record(),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "course_id", sa.Uuid(), sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("structure_type", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("base_course_revision", sa.Integer(), nullable=False),
        sa.Column("applied_course_revision", sa.Integer()),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("id_mapping", sa.JSON(), nullable=False),
        sa.Column("source", sa.JSON(), nullable=False),
        sa.Column(
            "generation_run_id", sa.Uuid(), sa.ForeignKey("workflow_runs.id", ondelete="SET NULL")
        ),
        sa.Column("raw_output", sa.Text(), nullable=False),
        sa.Column("confirmed_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("confirmed_at", sa.DateTime()),
        sa.Column("change_summary", sa.JSON(), nullable=False),
        sa.CheckConstraint(
            "status IN ('DRAFT','CONFIRMED','SUPERSEDED')", name="ck_structure_status"
        ),
        sa.CheckConstraint("structure_type = 'CURRICULUM'", name="ck_structure_type"),
    )
    op.create_index("ix_structure_versions_course_id", "structure_versions", ["course_id"])
    op.create_index(
        "uq_curriculum_confirmed",
        "structure_versions",
        ["course_id"],
        unique=True,
        postgresql_where=sa.text("status = 'CONFIRMED'"),
        sqlite_where=sa.text("status = 'CONFIRMED'"),
    )
    op.create_table(
        "structure_events",
        *record(),
        sa.Column(
            "version_id",
            sa.Uuid(),
            sa.ForeignKey("structure_versions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "actor_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("action", sa.String(20), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
    )
    op.create_index("ix_structure_events_version_id", "structure_events", ["version_id"])


def downgrade():
    for table in [
        "structure_events",
        "structure_versions",
        "workflow_runs",
        "sections",
        "chapters",
    ]:
        op.drop_table(table)
    op.drop_column("uploads", "purpose")
    op.drop_column("uploads", "media_type")
