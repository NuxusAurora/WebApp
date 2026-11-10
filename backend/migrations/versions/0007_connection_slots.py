"""Keep one default and one custom configuration, with one active connection."""

import sqlalchemy as sa
from alembic import op

revision = "0007_connection_slots"
down_revision = "0006_single_model"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "ai_providers",
        sa.Column("provider_kind", sa.String(20), nullable=False, server_default="custom"),
    )
    op.execute(
        "UPDATE ai_providers SET provider_kind = 'default' WHERE base_url ~* '^https://api[.]nuxusaurora[.]com([:]443)?/v1/*$'"
    )
    op.drop_constraint("uq_ai_provider_user", "ai_providers", type_="unique")
    op.create_unique_constraint(
        "uq_ai_provider_user_kind", "ai_providers", ["user_id", "provider_kind"]
    )
    op.create_check_constraint(
        "ck_ai_provider_kind", "ai_providers", "provider_kind IN ('default', 'custom')"
    )
    op.create_index(
        "uq_ai_provider_active",
        "ai_providers",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("enabled"),
    )


def downgrade():
    duplicates = (
        op.get_bind()
        .execute(sa.text("SELECT 1 FROM ai_providers GROUP BY user_id HAVING COUNT(*) > 1 LIMIT 1"))
        .first()
    )
    if duplicates:
        raise RuntimeError("Resolve dual AI connections before downgrading; no data was deleted")
    op.drop_index("uq_ai_provider_active", table_name="ai_providers")
    op.drop_constraint("ck_ai_provider_kind", "ai_providers", type_="check")
    op.drop_constraint("uq_ai_provider_user_kind", "ai_providers", type_="unique")
    op.create_unique_constraint("uq_ai_provider_user", "ai_providers", ["user_id"])
    op.drop_column("ai_providers", "provider_kind")
