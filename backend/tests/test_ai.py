import asyncio
import json
from contextlib import aclosing

import httpx
import pytest
from sqlalchemy import select

from app.ai.adapters import OpenAIProvider
from app.ai.contracts import AIError, Call, Capabilities, Message, Target
from app.ai.credentials import KeyVault, validate_endpoint
from app.ai.gateway import Gateway
from app.ai.models import AIProvider
from app.errors import AppError
from tests.test_phase1 import account_app as account_app
from tests.test_phase1 import authenticate

KEY = "local-secret-should-never-escape"
ENDPOINT = "http://localhost:1234/v1"
SCHEMA = {
    "type": "object",
    "properties": {"ok": {"type": "boolean"}},
    "required": ["ok"],
    "additionalProperties": False,
}


def target(**updates):
    return Target(
        provider_id="provider",
        model_id="model",
        protocol="openai",
        base_url=ENDPOINT,
        model_name="local-model",
        api_key=KEY,
        capabilities=Capabilities(streaming=True),
        **updates,
    )


def call(**updates):
    return Call(messages=[Message(role="user", content="private-question")], **updates)


def completion(text="OK", status=200):
    return httpx.Response(
        status,
        json={
            "choices": [{"message": {"content": text}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 4, "completion_tokens": 2},
        },
    )


def sse(text="本地回复", complete=True):
    values = [{"choices": [{"delta": {"content": text}, "finish_reason": None}]}]
    if complete:
        values += [
            {"choices": [{"delta": {}, "finish_reason": "stop"}]},
            {"choices": [], "usage": {"prompt_tokens": 4, "completion_tokens": 2}},
        ]
    raw = "".join("data: " + json.dumps(value, ensure_ascii=False) + "\n\n" for value in values)
    return raw + ("data: [DONE]\n\n" if complete else "")


@pytest.mark.anyio
async def test_contract_chat_context_native_schema_and_keyless(configured):
    requests = []

    def handler(request):
        requests.append(request)
        return completion('{"ok":true}')

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        adapter = OpenAIProvider(client)
        value = await adapter.chat(
            target(), call(task_context={"difficulty_policy": {"level": "pass"}})
        )
        assert value.usage.input_tokens == 4
        assert requests[0].headers["authorization"] == f"Bearer {KEY}"
        assert json.loads(requests[0].content)["messages"][-1]["role"] == "user"
        await adapter.generate_structured(
            target().model_copy(
                update={
                    "api_key": configured.smtp_password,
                    "capabilities": Capabilities(structured_output=True),
                }
            ),
            call(output_schema=SCHEMA),
        )
        assert "authorization" not in requests[-1].headers
        assert (
            json.loads(requests[-1].content)["response_format"]["json_schema"]["schema"] == SCHEMA
        )


@pytest.mark.anyio
async def test_schema_fallback_repair_and_usage_are_bounded():
    requests, audits = [], []

    def handler(request):
        requests.append(json.loads(request.content))
        return completion('```json\n{"ok":true}\n```' if len(requests) == 2 else '{"ok":"bad"}')

    async def sink(state):
        audits.append(state)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await Gateway({"openai": OpenAIProvider(client)}).execute(
            target(), call(output_schema=SCHEMA), sink
        )
    assert result.structured == {"ok": True} and result.usage.input_tokens == 8
    assert len(requests) == 2 and "response_format" not in requests[0]
    assert audits[0]["attempts"] == 2 and audits[0]["status"] == "SUCCEEDED"
    assert "private-question" not in json.dumps(audits)


@pytest.mark.anyio
@pytest.mark.parametrize(
    "status,code,attempts",
    [
        (401, "AI_AUTH_FAILED", 1),
        (429, "AI_RATE_LIMITED", 3),
        (500, "AI_UNAVAILABLE", 3),
        (302, "AI_REQUEST_REJECTED", 1),
    ],
)
async def test_retry_errors_never_include_upstream_secrets(status, code, attempts):
    seen, audits = [], []

    def handler(request):
        seen.append(1)
        return httpx.Response(
            status,
            json={"error": {"message": KEY}},
            headers={"Location": "http://private.invalid/"},
        )

    async def sink(state):
        audits.append(state)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(AIError) as error:
            await Gateway({"openai": OpenAIProvider(client)}).execute(target(), call(), sink)
    assert error.value.code == code and KEY not in str(error.value)
    assert len(seen) == attempts and audits[0]["error_code"] == code


@pytest.mark.anyio
async def test_total_deadline_and_cancellation_audited():
    started = asyncio.Event()
    audits = []

    async def handler(request):
        started.set()
        await asyncio.sleep(10)
        return completion()

    async def sink(state):
        audits.append(state)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        gateway = Gateway({"openai": OpenAIProvider(client)})
        with pytest.raises(AIError, match="AI_TIMEOUT"):
            await gateway.execute(target(), call(timeout=0.05), sink)
        started.clear()
        task = asyncio.create_task(gateway.execute(target(), call(), sink))
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    assert [item["status"] for item in audits] == ["FAILED", "CANCELLED"]


@pytest.mark.anyio
async def test_schema_ref_rejected_before_network_and_persistent_mismatch():
    seen, audits = [], []

    def handler(request):
        seen.append(1)
        return completion('{"ok":"invalid"}')

    async def sink(state):
        audits.append(state)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        gateway = Gateway({"openai": OpenAIProvider(client)})
        with pytest.raises(AIError, match="AI_INVALID_SCHEMA"):
            await gateway.execute(target(), call(output_schema={"$ref": "http://private/"}), sink)
        assert seen == []
        with pytest.raises(AIError, match="AI_SCHEMA_MISMATCH"):
            await gateway.execute(target(), call(output_schema=SCHEMA), sink)
    assert len(seen) == 3 and audits[-1]["status"] == "FAILED"


@pytest.mark.anyio
@pytest.mark.parametrize("complete", [True, False])
async def test_stream_terminal_usage_and_truncated_stream_no_replay(complete):
    seen, audits = [], []

    def handler(request):
        seen.append(1)
        return httpx.Response(200, text=sse(complete=complete))

    async def sink(state):
        audits.append(state)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        source = Gateway({"openai": OpenAIProvider(client)}).stream(target(), call(), sink)
        chunks = []
        try:
            async for chunk in source:
                chunks.append(chunk)
        except AIError as error:
            assert not complete and error.code == "AI_INCOMPLETE_RESPONSE"
    assert len(seen) == 1 and chunks[0].text == "本地回复"
    if complete:
        assert chunks[-1].done and chunks[-1].usage.input_tokens == 4
    assert audits[0]["status"] == ("SUCCEEDED" if complete else "FAILED")


@pytest.mark.anyio
async def test_stream_close_cleans_up_and_records_cancellation():
    closed, audits = [], []

    class Body(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield sse(complete=False).encode()
            await asyncio.sleep(10)

        async def aclose(self):
            closed.append(True)

    async def sink(state):
        audits.append(state)

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, stream=Body()))
    ) as client:
        async with aclosing(
            Gateway({"openai": OpenAIProvider(client)}).stream(target(), call(), sink)
        ) as source:
            assert (await anext(source)).text == "本地回复"
    assert closed and audits[0]["status"] == "CANCELLED"


def test_endpoint_vault_restrictions_and_authentication(configured):
    vault = KeyVault(configured.encryption_key)
    secret = target().api_key
    encrypted = vault.encrypt(secret)
    assert KEY not in encrypted and vault.decrypt(encrypted) == secret
    with pytest.raises(AppError, match="模型密钥不可用"):
        vault.decrypt(encrypted[:-2] + "AA")
    for endpoint in [
        "http://x@localhost:1234/v1",
        ENDPOINT + "?key=x",
        ENDPOINT + "/../private",
        "file:///tmp/model",
        "https://example.com:invalid/v1",
    ]:
        with pytest.raises(AppError):
            validate_endpoint(endpoint, configured.ai_allowed_origins)
    for endpoint in [
        "http://localhost:9999/v1",
        "https://example.com/v1",
        "https://example.com:8443/api/v1/",
    ]:
        assert validate_endpoint(endpoint, "*") == endpoint.rstrip("/")
    assert configured.ai_allowed_origins == "*"
    with pytest.raises(AppError):
        validate_endpoint("https://example.com/v1", "http://localhost:1234")


def setup_api(app, client):
    authenticate(client, app)
    provider = client.post(
        "/api/v1/ai/providers", json={"provider_name": "本地", "base_url": ENDPOINT, "api_key": KEY}
    ).json()["data"]
    assert "api_key" not in provider and provider["has_api_key"]
    model = client.post(
        f"/api/v1/ai/providers/{provider['id']}/models",
        json={
            "model_name": "local-one",
            "capabilities": {"streaming": True},
            "capabilities_confirmed": True,
        },
    ).json()["data"]
    return provider, model


def test_configuration_isolation_key_rotation_deletion_and_business_unchanged(account_app):
    app, client = account_app
    provider, model = setup_api(app, client)
    course = client.post("/api/v1/courses", json={"title": "不要修改"}).json()["data"]
    before = client.get(f"/api/v1/courses/{course['id']}").json()

    async def stored():
        async with app.state.resources.session() as db:
            value = await db.scalar(select(AIProvider))
            return value.encrypted_api_key

    assert KEY not in asyncio.run(stored())
    response = client.patch(f"/api/v1/ai/providers/{provider['id']}", json={"api_key": "rotated"})
    assert response.status_code == 200 and "rotated" not in response.text
    assert client.get(f"/api/v1/courses/{course['id']}").json() == before
    first = client.cookies.get("learning_session")
    client.post("/api/v1/auth/logout")
    authenticate(client, app, "two@example.com")
    assert client.get("/api/v1/ai/providers").json()["data"] == []

    assert (
        client.patch(f"/api/v1/ai/providers/{provider['id']}", json={"enabled": False}).status_code
        == 404
    )
    assert client.delete(f"/api/v1/ai/models/{model['id']}").status_code == 404
    assert client.post(f"/api/v1/ai/models/{model['id']}/test", json={}).status_code == 404
    assert client.get("/api/v1/ai/calls").json()["data"] == []
    # Login original account again; logout revoked the first cookie.
    client.post("/api/v1/auth/logout")
    client.post(
        "/api/v1/auth/login", json={"email": "one@example.com", "password": "example-password-123"}
    )
    assert client.cookies.get("learning_session") != first
    assert client.delete(f"/api/v1/ai/providers/{provider['id']}/key").status_code == 200
    assert not client.get("/api/v1/ai/providers").json()["data"][0]["has_api_key"]
    assert client.delete(f"/api/v1/ai/providers/{provider['id']}").status_code == 200
    assert client.get("/api/v1/ai/providers").json()["data"] == []


def test_single_configuration_limit_including_disabled_and_replacement(account_app):
    app, client = account_app
    provider, model = setup_api(app, client)
    response = client.post(
        "/api/v1/ai/providers", json={"provider_name": "second", "base_url": ENDPOINT}
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "AI_PROVIDER_EXISTS"
    client.patch(f"/api/v1/ai/providers/{provider['id']}", json={"enabled": False})
    assert (
        client.post(
            "/api/v1/ai/providers", json={"provider_name": "second", "base_url": ENDPOINT}
        ).status_code
        == 409
    )
    response = client.post(
        f"/api/v1/ai/providers/{provider['id']}/models", json={"model_name": "second"}
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "AI_MODEL_EXISTS"
    assert (
        client.put(
            f"/api/v1/ai/models/{model['id']}", json={"model_name": "replacement", "enabled": False}
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/v1/ai/providers/{provider['id']}/models", json={"model_name": "second"}
        ).status_code
        == 409
    )
    values = client.get("/api/v1/ai/providers").json()["data"]
    assert len(values) == len(values[0]["models"]) == 1
    assert values[0]["models"][0]["id"] == model["id"]
    assert client.delete(f"/api/v1/ai/models/{model['id']}").status_code == 200
    assert (
        client.post(
            f"/api/v1/ai/providers/{provider['id']}/models", json={"model_name": "new"}
        ).status_code
        == 201
    )
    client.post("/api/v1/auth/logout")
    authenticate(client, app, "another@example.com")
    assert (
        client.post(
            "/api/v1/ai/providers", json={"provider_name": "other account", "base_url": ENDPOINT}
        ).status_code
        == 201
    )


def test_unrestricted_endpoint_save_and_invocation(account_app):
    app, client = account_app
    provider, model = setup_api(app, client)
    endpoint = "https://models.example.invalid:8443/api/v1"
    response = client.patch(
        f"/api/v1/ai/providers/{provider['id']}",
        json={"base_url": endpoint, "api_key": "replacement-key"},
    )
    assert response.status_code == 200
    assert response.json()["data"]["base_url"] == endpoint
    assert response.json()["data"]["provider_name"] == provider["provider_name"]
    requests = []

    def handler(request):
        requests.append(str(request.url))
        return completion()

    wire = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    app.state.ai_gateway = Gateway({"openai": OpenAIProvider(wire)})
    assert client.post(f"/api/v1/ai/models/{model['id']}/test", json={}).status_code == 200
    assert requests == [endpoint + "/chat/completions"]
    asyncio.run(wire.aclose())


def test_api_calls_probes_and_audit_are_sanitized(account_app):
    app, client = account_app
    provider, model = setup_api(app, client)

    def handler(request):
        body = json.loads(request.content)
        if body.get("stream"):
            return httpx.Response(200, text=sse())
        return completion('{"ok":true}' if "response_format" in body else "OK")

    wire = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    app.state.ai_gateway = Gateway({"openai": OpenAIProvider(wire)})
    for kind in ["chat", "stream", "structured"]:
        response = client.post(f"/api/v1/ai/models/{model['id']}/test", json={"kind": kind})
        assert response.status_code == 200, response.text
    body = {
        "provider_id": provider["id"],
        "model_id": model["id"],
        "messages": [{"role": "user", "content": "private-question"}],
    }
    assert client.post("/api/v1/ai/calls", json=body).status_code == 200
    stream = client.post("/api/v1/ai/calls/stream", json=body)
    assert '"done": true' in stream.text and KEY not in stream.text
    logs = client.get("/api/v1/ai/calls").json()["data"]
    assert len(logs) == 5 and all(item["status"] == "SUCCEEDED" for item in logs)
    assert all(item["model_name"] == "local-one" for item in logs)
    assert all(item["gateway_prompt_version"] == "gateway-v1" for item in logs)
    assert "private-question" not in json.dumps(logs) and KEY not in json.dumps(logs)
    assert (
        client.put(f"/api/v1/ai/models/{model['id']}", json={"model_name": "local-two"}).status_code
        == 200
    )
    changed = client.get("/api/v1/ai/providers").json()["data"][0]["models"][0]
    assert changed["tested_capabilities"] == {} and changed["capability_source"] == "unknown"
    asyncio.run(wire.aclose())


def test_api_unknown_protocol_invalid_endpoint_nulls_and_error_logs(account_app):
    app, client = account_app
    provider, model = setup_api(app, client)
    assert (
        client.post(
            "/api/v1/ai/providers",
            json={"provider_name": "bad", "protocol": "anthropic", "base_url": ENDPOINT},
        ).status_code
        == 422
    )
    assert (
        client.patch(f"/api/v1/ai/providers/{provider['id']}", json={"enabled": None}).status_code
        == 400
    )
    assert (
        client.patch(
            f"/api/v1/ai/providers/{provider['id']}", json={"base_url": "http://localhost:11434/v1"}
        ).status_code
        == 400
    )
    wire = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda req: httpx.Response(401, text=KEY + " private upstream")
        )
    )
    app.state.ai_gateway = Gateway({"openai": OpenAIProvider(wire)})
    response = client.post(f"/api/v1/ai/models/{model['id']}/test", json={})
    assert response.status_code == 502 and KEY not in response.text
    logs = client.get("/api/v1/ai/calls").json()["data"]
    assert logs[0]["error_code"] == "AI_AUTH_FAILED" and logs[0]["status"] == "FAILED"
    asyncio.run(wire.aclose())


@pytest.mark.anyio
async def test_fragmented_utf8_stream_and_size_limit():
    class Body(httpx.AsyncByteStream):
        async def __aiter__(self):
            raw = sse().encode()
            for index in range(0, len(raw), 3):
                yield raw[index : index + 3]

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, stream=Body()))
    ) as client:
        values = [chunk async for chunk in OpenAIProvider(client).stream(target(), call())]
    assert values[0].text == "本地回复" and values[-1].done
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(200, content=b"x" * (1024 * 1024 + 1))
        )
    ) as client:
        with pytest.raises(AIError, match="AI_RESPONSE_TOO_LARGE"):
            async for _ in OpenAIProvider(client).stream(target(), call()):
                pass


@pytest.mark.anyio
async def test_audit_failure_does_not_report_a_successful_call():
    async def sink(state):
        raise RuntimeError(KEY)

    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda req: completion())) as client:
        with pytest.raises(AIError, match="AI_AUDIT_UNAVAILABLE") as error:
            await Gateway({"openai": OpenAIProvider(client)}).execute(target(), call(), sink)
    assert KEY not in str(error.value)


def test_configuration_change_during_probe_cannot_mark_new_config_tested(account_app):
    from sqlalchemy import update

    app, client = account_app
    provider, model = setup_api(app, client)

    async def handler(request):
        async with app.state.resources.session() as db:
            await db.execute(update(AIProvider).values(base_url="http://localhost:11434/v1"))
            await db.commit()
        return completion()

    wire = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    app.state.ai_gateway = Gateway({"openai": OpenAIProvider(wire)})
    response = client.post(f"/api/v1/ai/models/{model['id']}/test", json={})
    assert response.status_code == 409, response.text
    current = client.get("/api/v1/ai/providers").json()["data"][0]["models"][0]
    assert current["tested_capabilities"] == {}
    asyncio.run(wire.aclose())
