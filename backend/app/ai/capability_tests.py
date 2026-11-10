import base64
from contextlib import aclosing
from pathlib import Path
from typing import Literal

from app.ai.contracts import AIError, Call, Capabilities, ImageInput, Message, RetryPolicy
from app.ai.prompts import prompt
from app.ai.service import owned_model, owned_provider, prepare, public_model
from app.errors import AppError

ProbeKind = Literal["chat", "vision", "stream", "structured"]
CAPABILITY_FIELDS = {"vision": "vision", "stream": "streaming", "structured": "structured_output"}


async def run_capability_test(request, db, actor_id, model_id, kind: ProbeKind):
    model = await owned_model(db, actor_id, model_id)
    images = []
    text = prompt("probe")
    if kind == "vision":
        image = Path(__file__).with_name("vision-probe.png").read_bytes()
        images = [ImageInput(data_url="data:image/png;base64," + base64.b64encode(image).decode())]
        text = "Read the three-character code in this image. Reply with only the code."
    call = Call(
        task_type="capability_test",
        messages=[Message(role="user", content=text)],
        images=images,
        output_schema=(
            {
                "type": "object",
                "properties": {"ok": {"type": "boolean"}},
                "required": ["ok"],
                "additionalProperties": False,
            }
            if kind == "structured"
            else None
        ),
        timeout=30,
        retry_policy=RetryPolicy(max_retries=0),
        max_output_tokens=128,
        prompt_version="gateway-probe-v3",
    )
    target, sink, log_id = await prepare(request, db, actor_id, model.provider_id, model_id, call)
    capabilities = target.capabilities.model_dump()
    capabilities.update(
        vision=kind == "vision", streaming=True, structured_output=kind == "structured"
    )
    target = target.model_copy(update={"capabilities": Capabilities(**capabilities)})
    failure = None
    try:
        if kind == "stream":
            text = ""
            async with aclosing(request.app.state.ai_gateway.stream(target, call, sink)) as stream:
                async for chunk in stream:
                    text += chunk.text
            mismatch = "AI_INVALID_RESPONSE" if not text.strip() else None
        else:
            result = await request.app.state.ai_gateway.execute(target, call, sink)
            mismatch = (
                "AI_VISION_MISMATCH" if kind == "vision" and result.text.strip() != "7K2" else None
            )
        if mismatch:
            try:
                await sink({"status": "FAILED", "error_code": mismatch})
            except Exception:
                raise AIError("AI_AUDIT_UNAVAILABLE") from None
            raise AIError(mismatch)
    except AIError as error:
        failure = error

    # Configuration writers share the provider lock; network work never holds it.
    await db.rollback()
    current = await owned_model(db, actor_id, model_id)
    provider = await owned_provider(db, actor_id, current.provider_id, lock=True)
    await db.refresh(current)
    if (
        current.model_name != target.model_name
        or provider.base_url != target.base_url
        or f"{provider.updated_at.isoformat()}:{current.updated_at.isoformat()}"
        != target.config_revision
    ):
        raise AppError("AI_CONFIG_CHANGED", "配置已变化，请重新保存并测试", 409)
    current.tested_capabilities = {**current.tested_capabilities, kind: failure is None}
    if kind in CAPABILITY_FIELDS:
        current.capabilities = {**current.capabilities, CAPABILITY_FIELDS[kind]: failure is None}
    current.capability_source = "tested"
    await db.commit()
    if failure:
        raise failure
    return {"model": public_model(current), "log_id": str(log_id), "kind": kind}
