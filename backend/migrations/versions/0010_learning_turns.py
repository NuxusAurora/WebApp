"""Store completed teaching turns in knowledge-point conversations."""

import sqlalchemy as sa
from alembic import op

revision = "0010_learning_turns"
down_revision = "0009_learning_textbooks"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "learning_turns",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column(
            "conversation_id",
            sa.Uuid(),
            sa.ForeignKey("learning_conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.UniqueConstraint("conversation_id", "position", name="uq_learning_turn_position"),
        sa.UniqueConstraint("conversation_id", "request_id", name="uq_learning_turn_request"),
    )


def downgrade():
    if op.get_bind().execute(sa.text("SELECT EXISTS (SELECT 1 FROM learning_turns)")).scalar():
        raise RuntimeError("Teaching conversations exist; preserve their history before downgrade")
    op.drop_table("learning_turns")
