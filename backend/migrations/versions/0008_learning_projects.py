"""Persist learning conversation projects and their per-point placeholders."""

import sqlalchemy as sa
from alembic import op

revision = "0008_learning_projects"
down_revision = "0007_connection_slots"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "learning_projects",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "section_id",
            sa.Uuid(),
            sa.ForeignKey("sections.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "current_point_id", sa.Uuid(), sa.ForeignKey("knowledge_points.id", ondelete="SET NULL")
        ),
        sa.UniqueConstraint("user_id", "section_id", name="uq_learning_project_user_section"),
    )
    op.create_index("ix_learning_projects_section_id", "learning_projects", ["section_id"])
    op.create_index(
        "ix_learning_project_recent", "learning_projects", ["user_id", "updated_at", "id"]
    )
    op.create_table(
        "learning_conversations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column(
            "project_id",
            sa.Uuid(),
            sa.ForeignKey("learning_projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "knowledge_point_id",
            sa.Uuid(),
            sa.ForeignKey("knowledge_points.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "content_version_id",
            sa.Uuid(),
            sa.ForeignKey("structure_versions.id", deferrable=True, initially="DEFERRED"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "project_id", "knowledge_point_id", name="uq_learning_conversation_point"
        ),
    )


def downgrade():
    if op.get_bind().execute(sa.text("SELECT EXISTS (SELECT 1 FROM learning_projects)")).scalar():
        raise RuntimeError("Learning projects exist; back up and resolve them before downgrade")
    op.drop_table("learning_conversations")
    op.drop_index("ix_learning_project_recent", table_name="learning_projects")
    op.drop_index("ix_learning_projects_section_id", table_name="learning_projects")
    op.drop_table("learning_projects")
