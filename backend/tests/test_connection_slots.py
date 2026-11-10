import asyncio

from sqlalchemy import select

from app.ai.models import AIProvider
from tests.test_ai import setup_api
from tests.test_phase1 import account_app as account_app
from tests.test_phase1 import authenticate

DEFAULT_URL = "https://api.nuxusaurora.com/v1"


def test_slots_switch_preserves_models_credentials_and_rejects_inactive_calls(account_app):
    app, client = account_app
    custom, custom_model = setup_api(app, client)
    default = client.post(
        "/api/v1/ai/providers",
        json={
            "provider_kind": "default",
            "provider_name": "默认连接",
            "base_url": DEFAULT_URL,
            "api_key": "default-private-key",
        },
    ).json()["data"]
    default_model = client.post(
        f"/api/v1/ai/providers/{default['id']}/models",
        json={
            "model_name": "Aurora-Zyron",
            "capabilities": {"max_context_tokens": 500000},
            "capabilities_confirmed": True,
        },
    ).json()["data"]
    before = client.get("/api/v1/ai/providers").json()["data"]
    assert len(before) == 2
    assert [p["provider_kind"] for p in before] == ["custom", "default"]
    assert [p["enabled"] for p in before] == [False, True]
    assert (
        client.post(f"/api/v1/ai/models/{custom_model['id']}/test", json={}).json()["error"]["code"]
        == "AI_CONFIG_DISABLED"
    )

    async def keys():
        async with app.state.resources.session() as db:
            return {
                str(p.id): p.encrypted_api_key for p in (await db.scalars(select(AIProvider))).all()
            }

    encrypted = asyncio.run(keys())
    for selected in [custom, default, custom, default]:
        response = client.post(f"/api/v1/ai/providers/{selected['id']}/activate")
        assert response.status_code == 200
        values = client.get("/api/v1/ai/providers").json()["data"]
        assert [p["id"] for p in values if p["enabled"]] == [selected["id"]]
        for old, current in zip(before, values, strict=True):
            assert {k: v for k, v in old.items() if k != "enabled"} == {
                k: v for k, v in current.items() if k != "enabled"
            }
    assert asyncio.run(keys()) == encrypted
    assert default_model["capabilities"]["max_context_tokens"] == 500000
    assert "default-private-key" not in client.get("/api/v1/ai/providers").text
    duplicate = client.post(
        "/api/v1/ai/providers", json={"provider_name": "duplicate", "base_url": DEFAULT_URL}
    )
    assert duplicate.status_code == 409
    # A failed duplicate creation must not deactivate the existing connection.
    assert client.get("/api/v1/ai/providers").json()["data"][1]["enabled"]
    client.post("/api/v1/auth/logout")
    authenticate(client, app, "another-slots@example.com")
    assert client.post(f"/api/v1/ai/providers/{default['id']}/activate").status_code == 404
    assert client.get("/api/v1/ai/providers").json()["data"] == []


def test_slot_type_validation_and_edit_collision_roll_back(account_app):
    app, client = account_app
    custom, _ = setup_api(app, client)
    assert (
        client.post(
            "/api/v1/ai/providers",
            json={
                "provider_kind": "default",
                "provider_name": "bad",
                "base_url": "https://other.example/v1",
            },
        ).status_code
        == 400
    )
    default = client.post(
        "/api/v1/ai/providers",
        json={"provider_kind": "default", "provider_name": "默认", "base_url": DEFAULT_URL},
    ).json()["data"]
    before = client.get("/api/v1/ai/providers").json()
    assert (
        client.patch(
            f"/api/v1/ai/providers/{default['id']}",
            json={"base_url": "https://other.example/v1", "api_key": "new"},
        ).status_code
        == 409
    )
    assert client.get("/api/v1/ai/providers").json() == before
    # Saving an inactive slot explicitly enables it and keeps the other configuration.
    assert (
        client.patch(f"/api/v1/ai/providers/{custom['id']}", json={"enabled": True}).status_code
        == 200
    )
    assert len(client.get("/api/v1/ai/providers").json()["data"]) == 2
