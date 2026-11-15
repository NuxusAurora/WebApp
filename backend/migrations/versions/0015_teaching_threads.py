"""Keep parallel teaching chats in independent message sequences."""

import sqlalchemy as sa
from alembic import op

revision = "0015_teaching_threads"
down_revision = "0014_teaching_turn_question"
branch_labels = None
depends_on = None

DEFAULT_THREAD = "00000000-0000-0000-0000-000000000000"
POSITION_KEY = "uq_learning_turn_position"


def upgrade():
    op.add_column(
        "learning_turns",
        sa.Column("thread_id", sa.Uuid(), nullable=False, server_default=DEFAULT_THREAD),
    )
    op.drop_constraint(POSITION_KEY, "learning_turns", type_="unique")
    op.create_unique_constraint(
        POSITION_KEY, "learning_turns", ["conversation_id", "thread_id", "position"]
    )


def downgrade():
    op.execute("LOCK TABLE learning_turns IN ACCESS EXCLUSIVE MODE")
    op.execute(f"""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM learning_turns WHERE thread_id <> '{DEFAULT_THREAD}') THEN
                RAISE EXCEPTION 'Keep independent teaching conversation history';
            END IF;
        END $$;
        """)
    op.drop_constraint(POSITION_KEY, "learning_turns", type_="unique")
    op.create_unique_constraint(POSITION_KEY, "learning_turns", ["conversation_id", "position"])
    op.drop_column("learning_turns", "thread_id")
