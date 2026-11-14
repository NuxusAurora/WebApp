"""Associate future assistant turns with a question. Legacy turns retain no attribution."""

import sqlalchemy as sa
from alembic import op

revision = "0014_teaching_turn_question"
down_revision = "0013_lesson_protocol"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("learning_turns", sa.Column("question_id", sa.Uuid()))
    op.create_index("ix_learning_turns_question_id", "learning_turns", ["question_id"])


def downgrade():
    op.execute("LOCK TABLE learning_turns IN ACCESS EXCLUSIVE MODE")
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM learning_turns WHERE question_id IS NOT NULL) THEN
                RAISE EXCEPTION 'Keep question attribution on existing turns';
            END IF;
        END $$;
        """)
    op.drop_index("ix_learning_turns_question_id", table_name="learning_turns")
    op.drop_column("learning_turns", "question_id")
