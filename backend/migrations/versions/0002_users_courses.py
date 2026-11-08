"""Users, revocable auth tokens, courses and private uploads."""

import sqlalchemy as sa
from alembic import op

revision = "0002_users_courses"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None

TABLES = ["users", "auth_tokens", "courses", "uploads"]


def record():
    return [
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    ]


def upgrade():
    op.create_table(
        "users",
        *record(),
        sa.Column("email", sa.String(254), nullable=False, unique=True),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("display_name", sa.String(80), nullable=False),
        sa.Column("email_verified", sa.Boolean(), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
    )
    op.create_table(
        "auth_tokens",
        *record(),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("digest", sa.String(64), nullable=False, unique=True),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_auth_tokens_user_id", "auth_tokens", ["user_id"])
    op.create_table(
        "courses",
        *record(),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("subject", sa.String(200), nullable=False),
        sa.Column("textbook", sa.String(300), nullable=False),
        sa.Column("learning_goal", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("confirmed_revision", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_courses_user_id", "courses", ["user_id"])
    op.create_table(
        "uploads",
        *record(),
        sa.Column(
            "course_id", sa.Uuid(), sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("filename", sa.String(200), nullable=False),
        sa.Column("object_key", sa.Text(), nullable=False, unique=True),
        sa.Column("size", sa.Integer(), nullable=False),
    )
    op.create_index("ix_uploads_course_id", "uploads", ["course_id"])


def downgrade():
    for name in reversed(TABLES):
        op.drop_table(name)
