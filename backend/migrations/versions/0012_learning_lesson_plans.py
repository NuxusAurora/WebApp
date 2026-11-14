"""Store frozen Learning Protocol 1.0 plans without rewriting older learning records."""

import sqlalchemy as sa
from alembic import op

revision = "0012_learning_lesson_plans"
down_revision = "0011_learning_lessons"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "learning_lesson_plans",
        sa.Column("plan_id", sa.Uuid(), primary_key=True),
        sa.Column("question_id", sa.Uuid(), nullable=False),
        sa.Column(
            "conversation_id",
            sa.Uuid(),
            sa.ForeignKey("learning_conversations.id", ondelete="CASCADE"),
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
        sa.Column("plan_version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.UniqueConstraint("question_id", name="uq_learning_lesson_plan_question"),
        sa.CheckConstraint("plan_version >= 1", name="ck_learning_lesson_plan_version"),
    )
    op.create_index(
        "ix_learning_lesson_plan_conversation", "learning_lesson_plans", ["conversation_id"]
    )
    op.execute("""
        CREATE FUNCTION reject_learning_lesson_plan_update() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'Learning lesson plans are frozen; create a new question and plan'
                USING ERRCODE = '55000';
        END;
        $$
        """)
    op.execute("""
        CREATE TRIGGER freeze_learning_lesson_plan
        BEFORE UPDATE ON learning_lesson_plans
        FOR EACH ROW EXECUTE FUNCTION reject_learning_lesson_plan_update()
        """)


def downgrade():
    # Lock before checking so that a concurrent insert cannot be lost after the check.
    op.execute("LOCK TABLE learning_lesson_plans IN ACCESS EXCLUSIVE MODE")
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM learning_lesson_plans) THEN
                RAISE EXCEPTION 'Learning lesson plans exist; preserve them before downgrade'
                    USING ERRCODE = '55000';
            END IF;
        END
        $$
        """)
    op.drop_table("learning_lesson_plans")
    op.execute("DROP FUNCTION reject_learning_lesson_plan_update()")
