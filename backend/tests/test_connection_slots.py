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


def test_explicit_custom_selection_can_wait_for_configuration_without_network(account_app):
    app, client = account_app
    authenticate(client, app)
    default = client.post(
        "/api/v1/ai/providers",
        json={"provider_name": "默认", "base_url": DEFAULT_URL, "api_key": "default-key"},
    ).json()["data"]
    response = client.post(
        "/api/v1/ai/providers",
        json={"provider_name": "自定义连接", "provider_kind": "custom", "base_url": ""},
    )
    assert response.status_code == 201
    draft = response.json()["data"]
    assert draft["enabled"] and draft["base_url"] == "" and not draft["has_api_key"]
    providers = client.get("/api/v1/ai/providers").json()["data"]
    assert [p["id"] for p in providers if p["enabled"]] == [draft["id"]]
    assert (
        client.get(f"/api/v1/ai/providers/{draft['id']}/discovery").json()["error"]["code"]
        == "AI_CONFIG_INCOMPLETE"
    )
    assert (
        client.post(
            f"/api/v1/ai/providers/{draft['id']}/models", json={"model_name": "pending"}
        ).json()["error"]["code"]
        == "AI_CONFIG_INCOMPLETE"
    )
    assert client.get("/api/v1/ai/calls").json()["data"] == []
    assert (
        client.patch(
            f"/api/v1/ai/providers/{draft['id']}", json={"base_url": "not-a-url"}
        ).status_code
        == 400
    )
    configured = client.patch(
        f"/api/v1/ai/providers/{draft['id']}",
        json={"base_url": "https://custom.example/v1", "api_key": "custom-key"},
    )
    assert configured.status_code == 200 and configured.json()["data"]["id"] == draft["id"]
    before = client.get("/api/v1/ai/providers").json()["data"]
    for selected in [default, draft]:
        assert client.post(f"/api/v1/ai/providers/{selected['id']}/activate").status_code == 200
    after = client.get("/api/v1/ai/providers").json()["data"]
    assert [{k: v for k, v in p.items() if k != "enabled"} for p in before] == [
        {k: v for k, v in p.items() if k != "enabled"} for p in after
    ]


def test_empty_endpoint_requires_explicit_custom_slot(account_app):
    app, client = account_app
    authenticate(client, app)
    for extra in [{}, {"provider_kind": "default"}]:
        assert (
            client.post(
                "/api/v1/ai/providers", json={"provider_name": "bad", "base_url": "", **extra}
            ).status_code
            == 400
        )
    assert client.get("/api/v1/ai/providers").json()["data"] == []


def test_legacy_model_on_unconfigured_custom_slot_is_rejected_before_audit(account_app):
    from uuid import uuid4

    from app.ai.models import AIModel

    app, client = account_app
    authenticate(client, app)
    draft = client.post(
        "/api/v1/ai/providers",
        json={"provider_name": "自定义", "provider_kind": "custom", "base_url": ""},
    ).json()["data"]
    model_id = uuid4()

    async def legacy():
        from uuid import UUID

        async with app.state.resources.session() as db:
            db.add(
                AIModel(
                    id=model_id,
                    provider_id=UUID(draft["id"]),
                    model_name="legacy",
                    capabilities={},
                    capability_source="unknown",
                    tested_capabilities={},
                    enabled=True,
                )
            )
            await db.commit()

    asyncio.run(legacy())
    response = client.post(f"/api/v1/ai/models/{model_id}/test", json={})
    assert (
        response.status_code == 400 and response.json()["error"]["code"] == "AI_CONFIG_INCOMPLETE"
    )
    assert client.get("/api/v1/ai/calls").json()["data"] == []
