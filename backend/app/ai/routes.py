import json
from contextlib import aclosing
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import Field, SecretStr
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.ai.capability_tests import ProbeKind, run_capability_test
from app.ai.contracts import AIError, Call, Capabilities
from app.ai.credentials import KeyVault, validate_endpoint
from app.ai.models import AICallLog, AIModel, AIProvider
from app.ai.policy import required_model_name, validate_model_name
from app.ai.service import (
    discover_models,
    lock_connections,
    owned_model,
    owned_provider,
    prepare,
    public_model,
    public_provider,
    reset_tests,
    select_connection,
)
from app.auth import DB, Actor, Input, limit
from app.errors import AppError, ok

router = APIRouter(prefix="/api/v1/ai", tags=["ai"])


class ProviderInput(Input):
    provider_kind: Literal["default", "custom"] | None = None
    provider_name: str = Field(min_length=1, max_length=80, pattern=r"\S")
    protocol: Literal["openai"] = "openai"
    base_url: str = Field(max_length=500)
    api_key: SecretStr = Field(default=SecretStr(""), max_length=4096)
    enabled: bool = True


class ProviderUpdate(Input):
    provider_name: str | None = Field(default=None, min_length=1, max_length=80, pattern=r"\S")
    base_url: str | None = Field(default=None, min_length=1, max_length=500)
    api_key: SecretStr | None = Field(default=None, max_length=4096)
    enabled: bool | None = None


class ModelInput(Input):
    model_name: str = Field(min_length=1, max_length=160, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$")
    capabilities: Capabilities = Field(default_factory=Capabilities)
    capabilities_confirmed: bool = False
    enabled: bool = True


class Invoke(Call):
    provider_id: UUID
    model_id: UUID


class Probe(Input):
    kind: ProbeKind = "chat"


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


@router.get("/options")
async def options(request: Request, actor: Actor):
    return ok(
        {
            "protocols": ["openai"],
            "allowed_origins": [
                item.strip()
                for item in request.app.state.settings.ai_allowed_origins.split(",")
                if item.strip()
            ],
        }
    )


@router.get("/providers")
async def providers(db: DB, actor: Actor):
    values = (
        await db.scalars(
            select(AIProvider)
            .where(AIProvider.user_id == actor.id)
            .order_by(AIProvider.created_at)
            .limit(100)
        )
    ).all()
    models = (
        await db.scalars(
            select(AIModel)
            .join(AIProvider)
            .where(AIProvider.user_id == actor.id)
            .order_by(AIModel.created_at)
        )
    ).all()
    return ok([public_provider(p, [m for m in models if m.provider_id == p.id]) for p in values])


@router.post("/providers", status_code=201)
async def add_provider(body: ProviderInput, request: Request, db: DB, actor: Actor):
    # Only an explicitly selected custom slot may await its endpoint configuration.
    endpoint = (
        ""
        if body.provider_kind == "custom" and body.base_url == ""
        else validate_endpoint(body.base_url, request.app.state.settings.ai_allowed_origins)
    )
    kind = "default" if required_model_name(endpoint) else "custom"
    if body.provider_kind and body.provider_kind != kind:
        raise AppError("AI_PROVIDER_KIND", "连接类型与接口地址不符")
    await lock_connections(db, actor.id)
    if await db.scalar(
        select(AIProvider.id).where(
            AIProvider.user_id == actor.id, AIProvider.provider_kind == kind
        )
    ):
        raise AppError("AI_PROVIDER_EXISTS", "此类连接已保存，请修改现有配置", 409)
    if body.enabled:
        await select_connection(db, actor.id, None)
    provider = AIProvider(
        user_id=actor.id,
        provider_kind=kind,
        provider_name=body.provider_name.strip(),
        protocol=body.protocol,
        base_url=endpoint,
        enabled=body.enabled,
        encrypted_api_key=(
            KeyVault(request.app.state.settings.encryption_key).encrypt(body.api_key)
            if body.api_key.get_secret_value()
            else ""
        ),
    )
    db.add(provider)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise AppError("AI_PROVIDER_EXISTS", "此类连接已保存，请修改现有配置", 409) from None
    return ok(public_provider(provider))


@router.patch("/providers/{provider_id}")
async def edit_provider(
    provider_id: UUID, body: ProviderUpdate, request: Request, db: DB, actor: Actor
):
    await lock_connections(db, actor.id)
    provider = await owned_provider(db, actor.id, provider_id, lock=True)
    values = body.model_dump(exclude_unset=True)
    if any(value is None for value in values.values()):
        raise AppError("VALIDATION_ERROR", "配置字段不能为空")
    if "base_url" in values:
        values["base_url"] = validate_endpoint(
            values["base_url"], request.app.state.settings.ai_allowed_origins
        )
        if (
            values["base_url"] != provider.base_url
            and provider.encrypted_api_key
            and "api_key" not in values
        ):
            raise AppError("AI_KEY_REENTRY_REQUIRED", "更换地址时请重新输入密钥，或先删除已存密钥")
        model = await db.scalar(select(AIModel).where(AIModel.provider_id == provider.id))
        if model:
            validate_model_name(values["base_url"], model.model_name)
    if "base_url" in values:
        kind = "default" if required_model_name(values["base_url"]) else "custom"
        if await db.scalar(
            select(AIProvider.id).where(
                AIProvider.user_id == actor.id,
                AIProvider.provider_kind == kind,
                AIProvider.id != provider.id,
            )
        ):
            raise AppError("AI_PROVIDER_EXISTS", "此类连接已保存，请修改现有配置", 409)
        values["provider_kind"] = kind
    if values.get("enabled"):
        await select_connection(db, actor.id, provider.id)
    if "api_key" in values:
        key = values.pop("api_key")
        values["encrypted_api_key"] = (
            KeyVault(request.app.state.settings.encryption_key).encrypt(key)
            if key.get_secret_value()
            else ""
        )
    for name, value in values.items():
        setattr(provider, name, value)
    if "base_url" in values or "encrypted_api_key" in values:
        await reset_tests(db, provider.id)
    await db.commit()
    return ok(public_provider(provider))


@router.post("/providers/{provider_id}/activate")
async def activate_provider(provider_id: UUID, db: DB, actor: Actor):
    await lock_connections(db, actor.id)
    provider = await owned_provider(db, actor.id, provider_id, lock=True)
    await select_connection(db, actor.id, provider.id)
    await db.commit()
    await db.refresh(provider)
    return ok(public_provider(provider))


@router.delete("/providers/{provider_id}/key")
async def remove_key(provider_id: UUID, db: DB, actor: Actor):
    provider = await owned_provider(db, actor.id, provider_id, lock=True)
    provider.encrypted_api_key = ""
    await reset_tests(db, provider.id)
    await db.commit()
    return ok({"message": "密钥已删除"})


@router.delete("/providers/{provider_id}")
async def remove_provider(provider_id: UUID, db: DB, actor: Actor):
    provider = await owned_provider(db, actor.id, provider_id, lock=True)
    await db.delete(provider)
    await db.commit()
    return ok()


@router.post("/providers/{provider_id}/models", status_code=201)
async def add_model(provider_id: UUID, body: ModelInput, db: DB, actor: Actor):
    provider = await owned_provider(db, actor.id, provider_id, lock=True)
    if not provider.base_url:
        raise AppError("AI_CONFIG_INCOMPLETE", "请先填写并保存自定义连接地址")
    validate_model_name(provider.base_url, body.model_name)
    if await db.scalar(select(AIModel.id).where(AIModel.provider_id == provider_id)):
        raise AppError("AI_MODEL_EXISTS", "只能保存一个模型，请修改现有模型", 409)
    if not body.capabilities_confirmed and body.capabilities != Capabilities():
        raise AppError("AI_CONFIRM_CAPABILITIES", "请确认模型能力，或使用未知能力默认值")
    model = AIModel(
        provider_id=provider_id,
        model_name=body.model_name,
        capabilities=body.capabilities.model_dump(),
        capability_source="user_confirmed" if body.capabilities_confirmed else "unknown",
        tested_capabilities={},
        enabled=body.enabled,
    )
    db.add(model)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise AppError("AI_MODEL_EXISTS", "只能保存一个模型，请修改现有模型", 409) from None
    return ok(public_model(model))


@router.get("/providers/{provider_id}/discovery")
async def discover(provider_id: UUID, request: Request, db: DB, actor: Actor):
    await limit(request, "ai", str(actor.id))
    try:
        return ok(await discover_models(request, db, actor.id, provider_id))
    except AIError as error:
        message = {
            "AI_INVALID_RESPONSE": "服务未返回有效的模型列表",
            "AI_REQUEST_REJECTED": "服务未提供模型列表，请手动填写或稍后重试",
            "AI_RESPONSE_TOO_LARGE": "服务返回的模型列表过大，请手动填写",
        }.get(error.code)
        if message:
            raise AppError(error.code, message, 502) from None
        raise public_error(error) from None


@router.put("/models/{model_id}")
async def edit_model(model_id: UUID, body: ModelInput, db: DB, actor: Actor):
    model = await owned_model(db, actor.id, model_id)
    provider = await owned_provider(db, actor.id, model.provider_id, lock=True)
    validate_model_name(provider.base_url, body.model_name)
    if not body.capabilities_confirmed and body.capabilities != Capabilities():
        raise AppError("AI_CONFIRM_CAPABILITIES", "请确认模型能力")
    model.model_name = body.model_name
    model.capabilities = body.capabilities.model_dump()
    model.capability_source = "user_confirmed" if body.capabilities_confirmed else "unknown"
    model.tested_capabilities = {}
    model.enabled = body.enabled
    await db.commit()
    return ok(public_model(model))


@router.delete("/models/{model_id}")
async def remove_model(model_id: UUID, db: DB, actor: Actor):
    model = await owned_model(db, actor.id, model_id)
    await owned_provider(db, actor.id, model.provider_id, lock=True)
    await db.delete(model)
    await db.commit()
    return ok()


@router.post("/models/{model_id}/test")
async def test_model(model_id: UUID, body: Probe, request: Request, db: DB, actor: Actor):
    await limit(request, "ai", str(actor.id))
    try:
        return ok(await run_capability_test(request, db, actor.id, model_id, body.kind))
    except AIError as error:
        raise public_error(error) from None


@router.get("/calls")
async def logs(db: DB, actor: Actor, offset: int = Query(default=0, ge=0)):
    values = (
        await db.scalars(
            select(AICallLog)
            .where(AICallLog.user_id == actor.id)
            .order_by(AICallLog.created_at.desc(), AICallLog.id)
            .offset(offset)
            .limit(100)
        )
    ).all()
    names = (
        "id",
        "provider_id",
        "model_id",
        "protocol",
        "provider_name",
        "model_name",
        "gateway_prompt_version",
        "task_type",
        "prompt_version",
        "status",
        "duration_ms",
        "attempts",
        "input_tokens",
        "output_tokens",
        "error_code",
        "created_at",
    )
    return ok([{name: getattr(item, name) for name in names} for item in values])


@router.post("/calls")
async def invoke(body: Invoke, request: Request, db: DB, actor: Actor):
    await limit(request, "ai", str(actor.id))
    target, sink, log_id = await prepare(
        request, db, actor.id, body.provider_id, body.model_id, body
    )
    try:
        result = await request.app.state.ai_gateway.execute(target, body, sink)
    except AIError as error:
        raise public_error(error) from None
    return ok({**result.model_dump(), "log_id": str(log_id)})


@router.post("/calls/stream")
async def invoke_stream(body: Invoke, request: Request, db: DB, actor: Actor):
    await limit(request, "ai", str(actor.id))
    target, sink, log_id = await prepare(
        request, db, actor.id, body.provider_id, body.model_id, body
    )

    async def events():
        try:
            async with aclosing(request.app.state.ai_gateway.stream(target, body, sink)) as source:
                async for chunk in source:
                    value = {**chunk.model_dump(), "log_id": str(log_id)}
                    yield "data: " + json.dumps(value, ensure_ascii=False) + "\n\n"
        except AIError as error:
            value = {"error": {"code": error.code, "message": public_error(error).message}}
            yield "event: error\ndata: " + json.dumps(value, ensure_ascii=False) + "\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )
