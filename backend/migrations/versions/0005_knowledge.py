"""Section-scoped knowledge drafts and stable confirmed knowledge points."""

import sqlalchemy as sa
from alembic import op

revision = "0005_knowledge"
down_revision = "0004_curriculum"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "structure_versions",
        sa.Column("section_id", sa.Uuid(), sa.ForeignKey("sections.id", ondelete="CASCADE")),
    )
    op.create_index("ix_structure_versions_section_id", "structure_versions", ["section_id"])
    op.drop_constraint("ck_structure_type", "structure_versions", type_="check")
    op.create_check_constraint(
        "ck_structure_type",
        "structure_versions",
        "(structure_type = 'CURRICULUM' AND section_id IS NULL) OR "
        "(structure_type = 'KNOWLEDGE' AND section_id IS NOT NULL)",
    )
    op.drop_index("uq_curriculum_confirmed", "structure_versions")
    for name, columns, kind in [
        ("uq_curriculum_confirmed", ["course_id"], "CURRICULUM"),
        ("uq_knowledge_confirmed", ["section_id"], "KNOWLEDGE"),
    ]:
        op.create_index(
            name,
            "structure_versions",
            columns,
            unique=True,
            postgresql_where=sa.text(f"status = 'CONFIRMED' AND structure_type = '{kind}'"),
        )
    op.create_table(
        "knowledge_points",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column(
            "section_id",
            sa.Uuid(),
            sa.ForeignKey("sections.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("learning_objectives", sa.JSON(), nullable=False),
        sa.Column("importance", sa.String(10), nullable=False),
        sa.Column("mastery_criteria", sa.JSON(), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("archived_at", sa.DateTime()),
        sa.Column(
            "content_version_id",
            sa.Uuid(),
            sa.ForeignKey("structure_versions.id", deferrable=True, initially="DEFERRED"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('NOT_STARTED','LEARNING','PRACTICING','NEEDS_REVIEW','MASTERED')",
            name="ck_knowledge_status",
        ),
        sa.CheckConstraint("importance IN ('HIGH','MEDIUM','LOW')", name="ck_knowledge_importance"),
    )
    op.create_index("ix_knowledge_points_section_id", "knowledge_points", ["section_id"])


def downgrade():
    # Never silently erase knowledge/history on an operational downgrade.
    connection = op.get_bind()
    if connection.execute(
        sa.text("SELECT count(*) FROM structure_versions WHERE structure_type = 'KNOWLEDGE'")
    ).scalar():
        raise RuntimeError(
            "Knowledge history exists; export and explicitly resolve it before downgrade"
        )
    op.drop_table("knowledge_points")
    op.drop_index("uq_knowledge_confirmed", "structure_versions")
    op.drop_index("uq_curriculum_confirmed", "structure_versions")
    op.create_index(
        "uq_curriculum_confirmed",
        "structure_versions",
        ["course_id"],
        unique=True,
        postgresql_where=sa.text("status = 'CONFIRMED'"),
    )
    op.drop_constraint("ck_structure_type", "structure_versions", type_="check")
    op.create_check_constraint(
        "ck_structure_type", "structure_versions", "structure_type = 'CURRICULUM'"
    )
    op.drop_index("ix_structure_versions_section_id", "structure_versions")
    op.drop_column("structure_versions", "section_id")
