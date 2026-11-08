"""Encrypted local model configuration and content-free call audit."""

import sqlalchemy as sa
from alembic import op

revision = "0003_ai_gateway"
down_revision = "0002_users_courses"
branch_labels = None
depends_on = None


def record():
    return [
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    ]


def upgrade():
    op.create_table(
        "ai_providers",
        *record(),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("provider_name", sa.String(80), nullable=False),
        sa.Column("protocol", sa.String(20), nullable=False),
        sa.Column("base_url", sa.String(500), nullable=False),
        sa.Column("encrypted_api_key", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_ai_providers_user_id", "ai_providers", ["user_id"])
    op.create_table(
        "ai_models",
        *record(),
        sa.Column(
            "provider_id",
            sa.Uuid(),
            sa.ForeignKey("ai_providers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("model_name", sa.String(160), nullable=False),
        sa.Column("capabilities", sa.JSON(), nullable=False),
        sa.Column("capability_source", sa.String(20), nullable=False),
        sa.Column("tested_capabilities", sa.JSON(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_ai_models_provider_id", "ai_models", ["provider_id"])
    op.create_table(
        "ai_call_logs",
        *record(),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("provider_id", sa.Uuid(), nullable=False),
        sa.Column("model_id", sa.Uuid(), nullable=False),
        sa.Column("protocol", sa.String(20), nullable=False),
        sa.Column("provider_name", sa.String(80), nullable=False),
        sa.Column("model_name", sa.String(160), nullable=False),
        sa.Column("gateway_prompt_version", sa.String(40), nullable=False),
        sa.Column("task_type", sa.String(64), nullable=False),
        sa.Column("prompt_version", sa.String(80), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("error_code", sa.String(64), nullable=True),
    )
    op.create_index("ix_ai_call_logs_user_id", "ai_call_logs", ["user_id"])


def downgrade():
    op.drop_table("ai_call_logs")
    op.drop_table("ai_models")
    op.drop_table("ai_providers")
