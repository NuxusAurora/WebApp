import asyncio
import json

import httpx
import pytest

from app.ai.adapters import OpenAIProvider
from app.ai.gateway import Gateway
from tests.test_ai import completion, setup_api
from tests.test_phase1 import account_app as account_app


def test_vision_probe_checks_actual_image_content_and_keeps_context(account_app):
    app, client = account_app
    provider, model = setup_api(app, client)
    client.put(
        f"/api/v1/ai/models/{model['id']}",
        json={
            "model_name": model["model_name"],
            "capabilities": {"max_context_tokens": 500000},
            "capabilities_confirmed": True,
        },
    )
    seen = []

    def handler(request):
        seen.append(json.loads(request.content))
        return completion("7K2")

    wire = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    app.state.ai_gateway = Gateway({"openai": OpenAIProvider(wire)})
    try:
        response = client.post(f"/api/v1/ai/models/{model['id']}/test", json={"kind": "vision"})
        assert response.status_code == 200, response.text
        content = seen[0]["messages"][0]["content"]
        assert content[1]["image_url"]["url"].startswith("data:image/png;base64,")
        assert "7K2" not in content[0]["text"]
        saved = response.json()["data"]["model"]
        assert saved["tested_capabilities"]["vision"] is True
        assert saved["capabilities"]["vision"] is True
        assert saved["capabilities"]["max_context_tokens"] == 500000
    finally:
        asyncio.run(wire.aclose())


@pytest.mark.parametrize(
    "kind, capability",
    [("vision", "vision"), ("stream", "streaming"), ("structured", "structured_output")],
)
def test_failed_probe_clears_support_and_records_failure(account_app, kind, capability):
    app, client = account_app
    provider, model = setup_api(app, client)
    wire = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(400) if kind == "stream" else completion("wrong")
        )
    )
    app.state.ai_gateway = Gateway({"openai": OpenAIProvider(wire)})
    try:
        response = client.post(f"/api/v1/ai/models/{model['id']}/test", json={"kind": kind})
        assert response.status_code == 502
        saved = client.get("/api/v1/ai/providers").json()["data"][0]["models"][0]
        assert saved["tested_capabilities"][kind] is False
        assert saved["capabilities"][capability] is False
        log = client.get("/api/v1/ai/calls").json()["data"][0]
        assert log["status"] == "FAILED"
        assert log["error_code"] is not None
    finally:
        asyncio.run(wire.aclose())
