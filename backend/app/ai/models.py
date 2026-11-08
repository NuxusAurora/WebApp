from uuid import UUID

from sqlalchemy import JSON, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base, Record


class AIProvider(Record, Base):
    __tablename__ = "ai_providers"
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider_name: Mapped[str] = mapped_column(String(80))
    protocol: Mapped[str] = mapped_column(String(20))
    base_url: Mapped[str] = mapped_column(String(500))
    encrypted_api_key: Mapped[str] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(default=True)


class AIModel(Record, Base):
    __tablename__ = "ai_models"
    provider_id: Mapped[UUID] = mapped_column(
        ForeignKey("ai_providers.id", ondelete="CASCADE"), index=True
    )
    model_name: Mapped[str] = mapped_column(String(160))
    capabilities: Mapped[dict] = mapped_column(JSON)
    capability_source: Mapped[str] = mapped_column(String(20), default="unknown")
    tested_capabilities: Mapped[dict] = mapped_column(JSON, default=dict)
    enabled: Mapped[bool] = mapped_column(default=True)


class AICallLog(Record, Base):
    __tablename__ = "ai_call_logs"
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # Historical IDs survive configuration deletion; never hold credentials or content.
    provider_id: Mapped[UUID] = mapped_column()
    model_id: Mapped[UUID] = mapped_column()
    protocol: Mapped[str] = mapped_column(String(20))
    provider_name: Mapped[str] = mapped_column(String(80))
    model_name: Mapped[str] = mapped_column(String(160))
    gateway_prompt_version: Mapped[str] = mapped_column(String(40), default="gateway-v1")
    task_type: Mapped[str] = mapped_column(String(64))
    prompt_version: Mapped[str] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(20))
    duration_ms: Mapped[int]
    attempts: Mapped[int]
    input_tokens: Mapped[int | None]
    output_tokens: Mapped[int | None]
    error_code: Mapped[str | None] = mapped_column(String(64))
