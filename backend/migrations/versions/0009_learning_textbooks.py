"""Persist which courses appear as textbooks in the learning sidebar."""

import sqlalchemy as sa
from alembic import op

revision = "0009_learning_textbooks"
down_revision = "0008_learning_projects"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "learning_textbooks",
        sa.Column(
            "course_id",
            sa.Uuid(),
            sa.ForeignKey("courses.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("added_at", sa.DateTime(), nullable=False),
    )
    op.execute(
        """
        INSERT INTO learning_textbooks (course_id, added_at)
        SELECT courses.id, COALESCE(existing.last_opened, courses.created_at)
        FROM courses
        LEFT JOIN (
            SELECT chapters.course_id, learning_projects.user_id,
                MAX(learning_projects.updated_at) AS last_opened
            FROM learning_projects
            JOIN sections ON sections.id = learning_projects.section_id
            JOIN chapters ON chapters.id = sections.chapter_id
            GROUP BY chapters.course_id, learning_projects.user_id
        ) AS existing ON existing.course_id = courses.id AND existing.user_id = courses.user_id
        WHERE existing.last_opened IS NOT NULL OR (
            courses.status = 'active' AND EXISTS (
                SELECT 1 FROM chapters
                WHERE chapters.course_id = courses.id AND NOT chapters.archived
            )
        )
        """
    )


def downgrade():
    op.drop_table("learning_textbooks")
