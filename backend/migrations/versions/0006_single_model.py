"""One connection per account and one model per connection.

Existing duplicates must be resolved explicitly before applying this migration.
No configuration, credentials or call history are deleted here.
"""

import sqlalchemy as sa
from alembic import op

revision = "0006_single_model"
down_revision = "0005_knowledge"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    for table, column in [("ai_providers", "user_id"), ("ai_models", "provider_id")]:
        duplicates = connection.execute(
            sa.text(f"SELECT 1 FROM {table} GROUP BY {column} HAVING COUNT(*) > 1 LIMIT 1")
        ).first()
        if duplicates:
            raise RuntimeError("Resolve duplicate AI configurations before upgrading to 0006")
    op.create_unique_constraint("uq_ai_provider_user", "ai_providers", ["user_id"])
    op.create_unique_constraint("uq_ai_model_provider", "ai_models", ["provider_id"])


def downgrade():
    op.drop_constraint("uq_ai_model_provider", "ai_models", type_="unique")
    op.drop_constraint("uq_ai_provider_user", "ai_providers", type_="unique")
