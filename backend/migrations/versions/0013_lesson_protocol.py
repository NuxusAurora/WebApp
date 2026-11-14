"""Link authoritative lesson revisions to their frozen plan."""

import sqlalchemy as sa
from alembic import op

revision = "0013_lesson_protocol"
down_revision = "0012_learning_lesson_plans"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("learning_lesson_revisions", sa.Column("plan_id", sa.Uuid()))
    op.create_foreign_key(
        "fk_learning_revision_plan",
        "learning_lesson_revisions",
        "learning_lesson_plans",
        ["plan_id"],
        ["plan_id"],
        deferrable=True,
        initially="DEFERRED",
    )
    op.create_index("ix_learning_revision_plan", "learning_lesson_revisions", ["plan_id"])


def downgrade():
    op.execute("LOCK TABLE learning_lesson_revisions IN ACCESS EXCLUSIVE MODE")
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM learning_lesson_revisions WHERE plan_id IS NOT NULL) THEN
                RAISE EXCEPTION 'Keep the plan association for existing lessons';
            END IF;
        END $$;
        """)
    op.drop_index("ix_learning_revision_plan", table_name="learning_lesson_revisions")
    op.drop_constraint("fk_learning_revision_plan", "learning_lesson_revisions", type_="foreignkey")
    op.drop_column("learning_lesson_revisions", "plan_id")
