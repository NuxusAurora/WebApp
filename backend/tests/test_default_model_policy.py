import asyncio

import httpx
import pytest
from sqlalchemy import update

from app.ai.adapters import OpenAIProvider
from app.ai.gateway import Gateway
from app.ai.models import AIProvider
from app.ai.policy import DEFAULT_MODEL, required_model_name
from tests.test_ai import completion, setup_api
from tests.test_phase1 import account_app as account_app
from tests.test_phase1 import authenticate

DEFAULT_URL = "https://api.nuxusaurora.com/v1"


@pytest.mark.parametrize(
    "url, expected",
    [
        (DEFAULT_URL, DEFAULT_MODEL),
        ("https://API.NUXUSAURORA.COM:443/v1/", DEFAULT_MODEL),
        ("http://localhost:1234/v1", None),
        ("https://api.nuxusaurora.com.other.invalid/v1", None),
        ("https://other.invalid/api.nuxusaurora.com/v1", None),
        ("https://api.nuxusaurora.com:8443/v1", None),
    ],
)
def test_policy_uses_canonical_endpoint_instead_of_display_name(url, expected):
    assert required_model_name(url) == expected


def test_default_connection_rejects_other_models_and_preserves_context(account_app):
    app, client = account_app
    authenticate(client, app)
    provider = client.post(
        "/api/v1/ai/providers",
        json={"provider_name": "任意名称", "base_url": DEFAULT_URL},
    ).json()["data"]
    assert provider["required_model_name"] == DEFAULT_MODEL
    path = f"/api/v1/ai/providers/{provider['id']}/models"
    for name in ["other-model", "Aurora-Zyron-extra", "aurora-zyron"]:
        response = client.post(path, json={"model_name": name})
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "AI_MODEL_RESTRICTED"
    body = {
        "model_name": DEFAULT_MODEL,
        "capabilities": {"max_context_tokens": 500000},
        "capabilities_confirmed": True,
    }
    response = client.post(path, json=body)
    assert response.status_code == 201
    model = response.json()["data"]
    response = client.put(f"/api/v1/ai/models/{model['id']}", json={"model_name": "other"})
    assert response.status_code == 400
    saved = client.get("/api/v1/ai/providers").json()["data"][0]["models"][0]
    assert saved["id"] == model["id"]
    assert saved["model_name"] == DEFAULT_MODEL
    assert saved["capabilities"]["max_context_tokens"] == 500000
    assert client.put(f"/api/v1/ai/models/{model['id']}", json=body).status_code == 200


def test_changing_to_default_connection_cannot_keep_an_unrestricted_model(account_app):
    app, client = account_app
    provider, model = setup_api(app, client)
    path = f"/api/v1/ai/providers/{provider['id']}"
    response = client.patch(path, json={"base_url": DEFAULT_URL, "api_key": "replacement"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "AI_MODEL_RESTRICTED"
    assert client.get("/api/v1/ai/providers").json()["data"][0]["base_url"] == provider["base_url"]
    assert (
        client.put(
            f"/api/v1/ai/models/{model['id']}", json={"model_name": DEFAULT_MODEL}
        ).status_code
        == 200
    )
    response = client.patch(path, json={"base_url": DEFAULT_URL, "api_key": "replacement"})
    assert response.status_code == 200
    assert response.json()["data"]["required_model_name"] == DEFAULT_MODEL


def test_default_discovery_filters_models_without_changing_configuration(account_app):
    app, client = account_app
    authenticate(client, app)
    provider = client.post(
        "/api/v1/ai/providers", json={"provider_name": "默认", "base_url": DEFAULT_URL}
    ).json()["data"]
    before = client.get("/api/v1/ai/providers").json()
    wire = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                200, json={"data": [{"id": DEFAULT_MODEL}, {"id": "other"}]}
            )
        )
    )
    previous = app.state.ai_client
    app.state.ai_client = wire
    try:
        response = client.get(f"/api/v1/ai/providers/{provider['id']}/discovery")
        assert response.status_code == 200
        assert response.json()["data"] == [{"model_name": DEFAULT_MODEL, "capabilities": {}}]
        assert client.get("/api/v1/ai/providers").json() == before
    finally:
        app.state.ai_client = previous
        asyncio.run(wire.aclose())


def test_legacy_disallowed_model_is_rejected_before_network_or_audit(account_app):
    app, client = account_app
    provider, model = setup_api(app, client)

    async def legacy_config():
        async with app.state.resources.session() as db:
            await db.execute(update(AIProvider).values(base_url=DEFAULT_URL))
            await db.commit()

    asyncio.run(legacy_config())
    seen = []

    def handler(request):
        seen.append(request)
        return completion()

    wire = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    app.state.ai_gateway = Gateway({"openai": OpenAIProvider(wire)})
    try:
        response = client.post(f"/api/v1/ai/models/{model['id']}/test", json={})
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "AI_MODEL_RESTRICTED"
        assert seen == []
        assert client.get("/api/v1/ai/calls").json()["data"] == []
    finally:
        asyncio.run(wire.aclose())
