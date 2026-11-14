"""Persist main-window teaching revisions independently of side questions."""

import sqlalchemy as sa
from alembic import op

revision = "0011_learning_lessons"
down_revision = "0010_learning_turns"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "learning_lesson_revisions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column(
            "conversation_id",
            sa.Uuid(),
            sa.ForeignKey("learning_conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("response", sa.Text(), nullable=False),
        sa.Column("state", sa.JSON(), nullable=False),
        sa.UniqueConstraint("conversation_id", "revision", name="uq_learning_lesson_revision"),
        sa.UniqueConstraint("conversation_id", "request_id", name="uq_learning_lesson_request"),
    )


def downgrade():
    if (
        op.get_bind()
        .execute(sa.text("SELECT EXISTS (SELECT 1 FROM learning_lesson_revisions)"))
        .scalar()
    ):
        raise RuntimeError("Learning lessons exist; preserve them before downgrade")
    op.drop_table("learning_lesson_revisions")
