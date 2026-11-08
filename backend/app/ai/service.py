from uuid import UUID

from sqlalchemy import select, update

from app.ai.contracts import Call, Capabilities, Target
from app.ai.credentials import KeyVault, validate_endpoint
from app.ai.models import AICallLog, AIModel, AIProvider
from app.errors import AppError


async def owned_provider(db, actor_id, provider_id, lock=False):
    query = select(AIProvider).where(AIProvider.id == provider_id, AIProvider.user_id == actor_id)
    value = await db.scalar(query.with_for_update() if lock else query)
    if not value:
        raise AppError("NOT_FOUND", "模型配置不存在", 404)
    return value


async def owned_model(db, actor_id, model_id):
    value = await db.scalar(
        select(AIModel)
        .join(AIProvider)
        .where(AIModel.id == model_id, AIProvider.user_id == actor_id)
    )
    if not value:
        raise AppError("NOT_FOUND", "模型配置不存在", 404)
    return value


def public_model(model):
    return {
        "id": str(model.id),
        "provider_id": str(model.provider_id),
        "model_name": model.model_name,
        "enabled": model.enabled,
        "capabilities": model.capabilities,
        "capability_source": model.capability_source,
        "tested_capabilities": model.tested_capabilities,
    }


def public_provider(provider, models=()):
    return {
        "id": str(provider.id),
        "provider_name": provider.provider_name,
        "protocol": provider.protocol,
        "base_url": provider.base_url,
        "has_api_key": bool(provider.encrypted_api_key),
        "enabled": provider.enabled,
        "models": [public_model(model) for model in models],
    }


async def reset_tests(db, provider_id):
    await db.execute(
        update(AIModel)
        .where(AIModel.provider_id == provider_id)
        .values(tested_capabilities={}, capability_source="user_confirmed")
    )


async def prepare(request, db, actor_id: UUID, provider_id: UUID, model_id: UUID, call: Call):
    provider = await owned_provider(db, actor_id, provider_id)
    model = await owned_model(db, actor_id, model_id)
    if model.provider_id != provider.id:
        raise AppError("NOT_FOUND", "模型配置不存在", 404)
    if not provider.enabled or not model.enabled:
        raise AppError("AI_CONFIG_DISABLED", "请先启用供应商和模型")
    endpoint = validate_endpoint(provider.base_url, request.app.state.settings.ai_allowed_origins)
    key = (
        KeyVault(request.app.state.settings.encryption_key).decrypt(provider.encrypted_api_key)
        if provider.encrypted_api_key
        else ""
    )
    target = Target(
        provider_id=str(provider.id),
        model_id=str(model.id),
        protocol=provider.protocol,
        base_url=endpoint,
        model_name=model.model_name,
        api_key=key,
        capabilities=Capabilities(**model.capabilities),
        config_revision=f"{provider.updated_at.isoformat()}:{model.updated_at.isoformat()}",
    )
    log = AICallLog(
        user_id=actor_id,
        provider_id=provider.id,
        model_id=model.id,
        protocol=provider.protocol,
        provider_name=provider.provider_name,
        model_name=model.model_name,
        gateway_prompt_version="gateway-v1",
        task_type=call.task_type,
        prompt_version=call.prompt_version,
        status="RUNNING",
        duration_ms=0,
        attempts=0,
        error_code=None,
    )
    db.add(log)
    await db.commit()
    log_id = log.id

    async def sink(values):
        async with request.app.state.resources.session() as audit_db:
            await audit_db.execute(update(AICallLog).where(AICallLog.id == log_id).values(**values))
            await audit_db.commit()

    return target, sink, log_id
