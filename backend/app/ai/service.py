from uuid import UUID

from pydantic import SecretStr
from sqlalchemy import select, update

from app.ai.adapters import OpenAIProvider
from app.ai.contracts import Call, Capabilities, Target
from app.ai.credentials import KeyVault, validate_endpoint
from app.ai.models import AICallLog, AIModel, AIProvider
from app.ai.policy import required_model_name, validate_model_name
from app.errors import AppError
from app.models import User


def public_error(error):
    messages = {
        "AI_AUTH_FAILED": "模型密钥无效或无访问权限",
        "AI_RATE_LIMITED": "模型服务繁忙，请稍后重试",
        "AI_TIMEOUT": "模型响应超时，请重试",
        "AI_UNAVAILABLE": "无法连接本地模型，请检查地址和服务状态",
        "AI_SCHEMA_MISMATCH": "模型输出不符合结构要求",
        "AI_UNSUPPORTED_CAPABILITY": "请先确认模型支持此能力",
        "AI_INVALID_SCHEMA": "输出结构定义无效",
        "AI_VISION_MISMATCH": "图片识别测试未通过",
        "AI_AUDIT_UNAVAILABLE": "调用记录保存失败，请稍后重试",
    }
    return AppError(error.code, messages.get(error.code, "模型未能完成请求，请检查配置后重试"), 502)


async def lock_connections(db, actor_id):
    # All slot creation/activation takes this account lock before provider row locks.
    await db.scalar(select(User.id).where(User.id == actor_id).with_for_update())


async def select_connection(db, actor_id, provider_id):
    await db.execute(
        update(AIProvider)
        .where(AIProvider.user_id == actor_id, AIProvider.enabled.is_(True))
        .values(enabled=False)
    )
    if provider_id:
        await db.execute(
            update(AIProvider)
            .where(AIProvider.id == provider_id, AIProvider.user_id == actor_id)
            .values(enabled=True)
        )


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
        "provider_kind": provider.provider_kind,
        "protocol": provider.protocol,
        "base_url": provider.base_url,
        "has_api_key": bool(provider.encrypted_api_key),
        "enabled": provider.enabled,
        "required_model_name": required_model_name(provider.base_url),
        "models": [public_model(model) for model in models],
    }


async def reset_tests(db, provider_id):
    await db.execute(
        update(AIModel)
        .where(AIModel.provider_id == provider_id)
        .values(tested_capabilities={}, capability_source="user_confirmed")
    )


async def discover_models(request, db, actor_id, provider_id):
    provider = await owned_provider(db, actor_id, provider_id)
    if not provider.enabled:
        raise AppError("AI_CONFIG_DISABLED", "请先启用连接")
    if not provider.base_url:
        raise AppError("AI_CONFIG_INCOMPLETE", "请先填写并保存自定义连接地址")
    endpoint = validate_endpoint(provider.base_url, request.app.state.settings.ai_allowed_origins)
    required = required_model_name(endpoint)
    key = (
        KeyVault(request.app.state.settings.encryption_key).decrypt(provider.encrypted_api_key)
        if provider.encrypted_api_key
        else SecretStr("")
    )
    # Discovery is read-only; release the database connection before network I/O.
    await db.rollback()
    models = await OpenAIProvider(request.app.state.ai_client).discover_models(endpoint, key)
    return [model for model in models if not required or model["model_name"] == required]


async def prepare(request, db, actor_id: UUID, provider_id: UUID, model_id: UUID, call: Call):
    provider = await owned_provider(db, actor_id, provider_id)
    model = await owned_model(db, actor_id, model_id)
    if model.provider_id != provider.id:
        raise AppError("NOT_FOUND", "模型配置不存在", 404)
    if not provider.enabled or not model.enabled:
        raise AppError("AI_CONFIG_DISABLED", "请先启用供应商和模型")
    if not provider.base_url:
        raise AppError("AI_CONFIG_INCOMPLETE", "请先填写并保存自定义连接地址")
    endpoint = validate_endpoint(provider.base_url, request.app.state.settings.ai_allowed_origins)
    validate_model_name(endpoint, model.model_name)
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
