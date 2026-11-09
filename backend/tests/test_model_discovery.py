import asyncio

import httpx
import pytest
from pydantic import SecretStr

from app.ai.adapters import MAX_RESPONSE, OpenAIProvider
from app.ai.contracts import AIError
from app.ai.discovery import model_catalog
from tests.test_ai import ENDPOINT, KEY, setup_api
from tests.test_phase1 import account_app as account_app
from tests.test_phase1 import authenticate


def test_catalog_keeps_unknowns_unknown_and_only_accepts_explicit_typed_metadata():
    assert model_catalog({"data": [{"id": "vision-streaming-128k"}]}) == [
        {"model_name": "vision-streaming-128k", "capabilities": {}}
    ]
    assert model_catalog(
        {
            "data": [
                {
                    "id": "local-model",
                    "context_length": 32768,
                    "capabilities": {
                        "streaming": True,
                        "structured_output": False,
                        "vision": "yes",
                    },
                },
                {"id": "local-model"},
                {"id": "invalid\nmodel"},
            ]
        }
    ) == [
        {
            "model_name": "local-model",
            "capabilities": {
                "streaming": True,
                "structured_output": False,
                "max_context_tokens": 32768,
            },
        }
    ]
    assert (
        model_catalog({"data": [{"id": "local", "context_length": True}]})[0]["capabilities"] == {}
    )


@pytest.mark.parametrize(
    "payload", [{}, {"data": {}}, {"data": [None]}, {"data": [{}]}, {"data": [{}] * 1001}]
)
def test_invalid_catalogs_are_rejected(payload):
    with pytest.raises(AIError, match="AI_INVALID_RESPONSE"):
        model_catalog(payload)


@pytest.mark.anyio
async def test_adapter_reads_only_models_and_supports_keyless_auth():
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"data": [{"id": "one"}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as wire:
        adapter = OpenAIProvider(wire)
        await adapter.discover_models(ENDPOINT, SecretStr(KEY))
        await adapter.discover_models(ENDPOINT, SecretStr(""))
    assert str(requests[0].url) == ENDPOINT + "/models"
    assert all(request.method == "GET" and not request.content for request in requests)
    assert requests[0].headers["authorization"] == "Bearer " + KEY
    assert "authorization" not in requests[1].headers


@pytest.mark.anyio
@pytest.mark.parametrize(
    "status,code",
    [(401, "AI_AUTH_FAILED"), (404, "AI_REQUEST_REJECTED"), (302, "AI_REQUEST_REJECTED")],
)
async def test_discovery_errors_are_sanitized_and_redirects_are_not_followed(status, code):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(status, text=KEY, headers={"Location": "https://other.invalid"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as wire:
        with pytest.raises(AIError, match=code) as caught:
            await OpenAIProvider(wire).discover_models(ENDPOINT, SecretStr(KEY))
        assert KEY not in str(caught.value)
        assert len(requests) == 1


@pytest.mark.anyio
async def test_discovery_bounded_response_and_timeout():
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(200, content=b"x" * (MAX_RESPONSE + 1))
        )
    ) as wire:
        with pytest.raises(AIError, match="AI_RESPONSE_TOO_LARGE"):
            await OpenAIProvider(wire).discover_models(ENDPOINT, SecretStr(""))

    def timeout(request):
        raise httpx.ReadTimeout(KEY)

    async with httpx.AsyncClient(transport=httpx.MockTransport(timeout)) as wire:
        with pytest.raises(AIError, match="AI_TIMEOUT"):
            await OpenAIProvider(wire).discover_models(ENDPOINT, SecretStr(""))


def test_discovery_uses_owned_connection_without_mutating_models_or_exposing_keys(account_app):
    app, client = account_app
    provider, _ = setup_api(app, client)
    before = client.get("/api/v1/ai/providers").json()
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"data": [{"id": "available", "secret": KEY}]})

    wire = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    previous = app.state.ai_client
    app.state.ai_client = wire
    try:
        url = f"/api/v1/ai/providers/{provider['id']}/discovery"
        result = client.get(url)
        assert result.status_code == 200
        assert result.json()["data"] == [{"model_name": "available", "capabilities": {}}]
        assert KEY not in result.text
        assert client.get("/api/v1/ai/providers").json() == before
        assert requests[0].headers["authorization"] == "Bearer " + KEY
        client.patch(f"/api/v1/ai/providers/{provider['id']}", json={"enabled": False})
        assert client.get(url).status_code == 400
        client.post("/api/v1/auth/logout")
        authenticate(client, app, "other@example.com")
        assert client.get(url).status_code == 404
        assert len(requests) == 1
    finally:
        app.state.ai_client = previous
        asyncio.run(wire.aclose())
