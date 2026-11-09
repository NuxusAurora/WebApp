import asyncio
import io
import json
from uuid import UUID, uuid4

import httpx
import pytest
from PIL import Image
from sqlalchemy import func, select

from app.ai.adapters import OpenAIProvider
from app.ai.gateway import Gateway
from app.curriculum.models import Chapter, Section, StructureEvent, StructureVersion, WorkflowRun
from app.curriculum.ocr import LocalOCR, normalize_image
from app.errors import AppError
from tests.test_phase1 import account_app as account_app
from tests.test_phase1 import authenticate

PAYLOAD = {
    "chapters": [
        {
            "id": "tmp-c1",
            "title": "第一章 函数与极限",
            "sections": [{"id": "tmp-s1", "title": "1.1 映射与函数"}],
        }
    ]
}


def setup(account_app):
    app, client = account_app
    cookie = authenticate(client, app)
    course = client.post("/api/v1/courses", json={"title": "高等数学"}).json()["data"]["id"]
    return app, client, f"/api/v1/courses/{course}/curriculum", cookie


def draft(client, path, payload=PAYLOAD, base=0):
    response = client.post(
        path + "/drafts", json={"payload": payload, "base_course_revision": base}
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def apply(client, path, version, **updates):
    body = {key: version[key] for key in ("revision", "base_course_revision")}
    body.update(version_id=version["id"], **updates)
    return client.post(path + "/confirm", json=body)


def test_drafts_edit_lock_confirm_id_mapping_and_idempotency(account_app):
    app, client, path, _ = setup(account_app)
    first = draft(client, path)
    assert client.get(path).json()["data"]["curriculum"] == {"chapters": []}
    edited = json.loads(json.dumps(PAYLOAD))
    edited["chapters"][0]["title"] = "第一章 函数与极限（修正）"
    body = {"payload": edited, "version_id": first["id"], "revision": 1, "base_course_revision": 0}
    saved = client.patch(path, json=body)
    assert saved.status_code == 200, saved.text
    assert client.patch(path, json=body).status_code == 409
    assert apply(client, path, first).status_code == 409
    version = saved.json()["data"]
    result = apply(client, path, version)
    assert result.status_code == 200, result.text
    assert len(result.json()["data"]["id_mapping"]) == 2
    assert apply(client, path, version).json()["data"] == result.json()["data"]
    current = client.get(path).json()["data"]
    assert current["confirmed_revision"] == 1
    chapter = current["curriculum"]["chapters"][0]
    assert chapter["id"] == result.json()["data"]["id_mapping"]["tmp-c1"]
    assert chapter["title"].endswith("（修正）")
    assert client.patch(path, json={**body, "revision": 2}).status_code == 409


def test_replacement_keeps_one_draft_and_preserves_confirmed_history(account_app):
    app, client, path, _ = setup(account_app)
    original = draft(client, path)
    assert apply(client, path, original).status_code == 200
    assert client.get(path).json()["data"]["versions"] == []
    untouched = draft(client, path, base=1)
    replacement = draft(client, path, base=1)
    assert [v["id"] for v in client.get(path).json()["data"]["versions"]] == [replacement["id"]]
    assert apply(client, path, untouched).status_code == 409
    assert (
        client.patch(
            path,
            json={
                "version_id": untouched["id"],
                "revision": 1,
                "base_course_revision": 1,
                "payload": PAYLOAD,
            },
        ).status_code
        == 409
    )
    formal = client.get(path).json()["data"]["curriculum"]
    retained_id = formal["chapters"][0]["id"]
    formal["chapters"][0]["sections"] = []
    next_version = draft(client, path, formal, 1)
    assert len(next_version["change_summary"]["archived"]) == 1
    assert apply(client, path, next_version).status_code == 409
    assert apply(client, path, next_version, accept_archives=True).status_code == 200
    current = client.get(path).json()["data"]
    assert current["curriculum"]["chapters"][0]["id"] == retained_id
    assert current["versions"] == []
    assert apply(client, path, original).status_code == 200

    async def verify():
        async with app.state.resources.session() as db:
            for old in (original, untouched, replacement):
                row = await db.get(StructureVersion, UUID(old["id"]))
                assert row.status == "SUPERSEDED"
                assert row.payload == old["payload"]
            assert (await db.scalar(select(Section))).archived
            assert (
                await db.scalar(
                    select(func.count())
                    .select_from(StructureEvent)
                    .where(StructureEvent.action == "REPLACED")
                )
                == 2
            )
            assert (
                await db.scalar(
                    select(func.count())
                    .select_from(StructureVersion)
                    .where(StructureVersion.status == "DRAFT")
                )
                == 0
            )

    client.portal.call(verify)


def test_foreign_ids_duplicate_ids_and_tenant_boundaries(account_app):
    app, client, path, cookie = setup(account_app)
    first = draft(client, path)
    apply(client, path, first)
    for bad_id in (str(uuid4()), "not-a-node"):
        bad = {"chapters": [{"id": bad_id, "title": "x", "sections": []}]}
        assert client.post(
            path + "/drafts", json={"payload": bad, "base_course_revision": 1}
        ).status_code in {400, 422}
    duplicate = {"chapters": [PAYLOAD["chapters"][0], PAYLOAD["chapters"][0]]}
    assert (
        client.post(
            path + "/drafts", json={"payload": duplicate, "base_course_revision": 1}
        ).status_code
        == 422
    )
    authenticate(client, app, "other@example.com")
    for method, suffix, body in [
        ("GET", "", None),
        ("GET", "/images", None),
        ("POST", "/drafts", {"payload": PAYLOAD, "base_course_revision": 0}),
        ("POST", "/ocr", {"image_ids": [str(uuid4())]}),
        ("POST", "/confirm", {"version_id": first["id"], "revision": 1, "base_course_revision": 0}),
    ]:
        assert client.request(method, path + suffix, json=body).status_code == 404
    client.cookies.set("learning_session", cookie)
    assert client.get(path).status_code == 200


@pytest.mark.parametrize("existing_parent", [False, True])
def test_cross_chapter_move_preserves_identity_pages_and_old_snapshot(account_app, existing_parent):
    app, client, path, _ = setup(account_app)
    initial = json.loads(json.dumps(PAYLOAD))
    initial["chapters"][0]["sections"][0].update(page_start=7, page_end=12)
    if existing_parent:
        initial["chapters"].append({"id": "tmp-c2", "title": "第二章", "sections": []})
    first = draft(client, path, initial)
    assert apply(client, path, first).status_code == 200
    formal = client.get(path).json()["data"]["curriculum"]
    moved = json.loads(json.dumps(formal))
    child = moved["chapters"][0]["sections"].pop()
    if existing_parent:
        moved["chapters"][1]["sections"].append(child)
    else:
        moved["chapters"].append({"id": "tmp-c2", "title": "第二章", "sections": [child]})
    # Moving out and removing the former parent must not archive the retained child.
    moved["chapters"].pop(0)
    response = client.post(path + "/drafts", json={"payload": moved, "base_course_revision": 1})
    assert response.status_code == 201, response.text
    second = response.json()["data"]
    assert child["id"] in [item["id"] for item in second["change_summary"]["modified"]]
    assert [item["id"] for item in second["change_summary"]["archived"]] == [
        formal["chapters"][0]["id"]
    ]
    assert client.get(path).json()["data"]["curriculum"] == formal
    assert apply(client, path, second).status_code == 409
    assert apply(client, path, second, accept_archives=True).status_code == 200
    current = client.get(path).json()["data"]
    assert current["curriculum"]["chapters"][0]["sections"] == [child]
    assert current["confirmed_revision"] == 2
    assert apply(client, path, second, accept_archives=True).status_code == 200

    async def verify():
        async with app.state.resources.session() as db:
            row = await db.get(Section, UUID(child["id"]))
            assert not row.archived
            assert str(row.chapter_id) == current["curriculum"]["chapters"][0]["id"]
            old = await db.get(StructureVersion, UUID(first["id"]))
            assert old.payload == first["payload"]
            assert await db.scalar(select(func.count()).select_from(Section)) == 1

    client.portal.call(verify)


def png():
    image = Image.new("RGB", (400, 200), "white")
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def test_image_validation_storage_ocr_order_and_cleanup(account_app, monkeypatch):
    app, client, path, _ = setup(account_app)
    monkeypatch.setattr(
        app.state.store, "read", lambda key, size: app.state.store.objects[key], raising=False
    )
    calls = []

    class OCR:
        async def recognize(self, content):
            calls.append(content)
            return "第一章 函数与极限"

    app.state.curriculum_ocr = OCR()
    assert (
        client.post(
            path + "/images", content=b"<svg/>", headers={"X-Filename": "x.png"}
        ).status_code
        == 400
    )
    assert (
        client.post(path + "/images", content=png(), headers={"X-Filename": "../x.png"}).status_code
        == 400
    )
    assert (
        client.post(
            path + "/images", content=b"x" * (5 * 1024 * 1024 + 1), headers={"X-Filename": "x.png"}
        ).status_code
        == 413
    )
    result = client.post(path + "/images", content=png(), headers={"X-Filename": "contents.png"})
    assert result.status_code == 201, result.text
    image_id = result.json()["data"]["id"]
    assert client.get(path.removesuffix("/curriculum") + "/uploads").json()["data"] == []
    result = client.post(path + "/ocr", json={"image_ids": [image_id]})
    assert result.status_code == 200, result.text
    assert result.json()["data"]["ocr_text"] == "第一章 函数与极限" and len(calls) == 1
    assert client.post(path + "/ocr", json={"image_ids": [image_id, image_id]}).status_code == 400
    assert client.get(path).json()["data"]["versions"] == []
    assert client.delete(path.removesuffix("/curriculum")).status_code == 200
    assert app.state.store.objects == {}


def test_confirm_failure_rolls_back_all_nodes(account_app, monkeypatch):
    app, client, path, _ = setup(account_app)
    version = draft(client, path)
    from sqlalchemy.ext.asyncio import AsyncSession

    async def fail(self):
        raise RuntimeError("private-commit-failure")

    with monkeypatch.context() as patch:
        patch.setattr(AsyncSession, "commit", fail)
        assert apply(client, path, version).status_code == 500
    assert client.get(path).json()["data"]["confirmed_revision"] == 0
    assert client.get(path).json()["data"]["curriculum"]["chapters"] == []
    assert apply(client, path, version).status_code == 200


def test_parse_uses_gateway_with_private_provenance_and_schema_failures(account_app, caplog):
    app, client, path, _ = setup(account_app)
    provider = client.post(
        "/api/v1/ai/providers",
        json={"provider_name": "local", "base_url": "http://localhost:1234/v1"},
    ).json()["data"]
    model = client.post(
        f"/api/v1/ai/providers/{provider['id']}/models", json={"model_name": "local-test"}
    ).json()["data"]
    requests = []
    output = PAYLOAD

    def handler(request):
        requests.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": json.dumps(output)}, "finish_reason": "stop"}]
            },
        )

    transport_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    app.state.ai_gateway = Gateway({"openai": OpenAIProvider(transport_client)})
    body = {
        "provider_id": provider["id"],
        "model_id": model["id"],
        "ocr_text": "private-ocr 第一章 函数与极限",
    }
    result = client.post(path + "/parse", json=body)
    assert result.status_code == 201, result.text
    assert any(message["content"] == body["ocr_text"] for message in requests[-1]["messages"])
    assert "textbook" in requests[-1]["messages"][-1]["content"]
    assert result.json()["data"]["source"]["prompt_version"] == "curriculum-parse-v1"
    first = result.json()["data"]
    assert client.get(path).json()["data"]["curriculum"]["chapters"] == []
    assert client.post(path + "/parse", json=body).status_code == 201
    current_drafts = client.get(path).json()["data"]["versions"]
    assert len(current_drafts) == 1 and current_drafts[0]["id"] != first["id"]
    logs = client.get("/api/v1/ai/calls").json()["data"]
    assert all(log["status"] == "SUCCEEDED" for log in logs)
    assert "private-ocr" not in caplog.text and "private-ocr" not in json.dumps(logs)

    output = {"chapters": [PAYLOAD["chapters"][0], PAYLOAD["chapters"][0]]}
    assert client.post(path + "/parse", json=body).status_code == 502
    assert client.get(path).json()["data"]["versions"] == current_drafts

    async def inspect():
        async with app.state.resources.session() as db:
            row = await db.get(StructureVersion, UUID(first["id"]))
            assert json.loads(row.raw_output) == PAYLOAD
            run = await db.get(WorkflowRun, row.generation_run_id)
            assert run.status == "SUCCEEDED" and run.output_data["structured"] == PAYLOAD
            failed = await db.scalar(select(WorkflowRun).where(WorkflowRun.status == "FAILED"))
            assert failed.error_message == "INVALID_STRUCTURE"
            assert await db.scalar(select(func.count()).select_from(Chapter)) == 0

    client.portal.call(inspect)
    client.portal.call(transport_client.aclose)


def test_image_parse_bypasses_ocr_sends_private_image_and_requires_schema(
    account_app, monkeypatch, caplog
):
    app, client, path, _ = setup(account_app)
    monkeypatch.setattr(
        app.state.store, "read", lambda key, size: app.state.store.objects[key], raising=False
    )
    provider = client.post(
        "/api/v1/ai/providers",
        json={"provider_name": "vision", "base_url": "http://localhost:1234/v1"},
    ).json()["data"]
    model = client.post(
        f"/api/v1/ai/providers/{provider['id']}/models",
        json={
            "model_name": "vision-test",
            "capabilities": {"vision": True, "structured_output": True},
            "capabilities_confirmed": True,
        },
    ).json()["data"]
    image = client.post(
        path + "/images", content=png(), headers={"X-Filename": "photo.png"}
    ).json()["data"]
    expected = {
        "chapters": [
            {
                "id": "tmp-c1",
                "title": "第1章 行列式",
                "page_start": 1,
                "page_end": None,
                "sections": [
                    {
                        "id": "tmp-s1",
                        "title": "1.1 n阶行列式的定义",
                        "page_start": 1,
                        "page_end": None,
                    }
                ],
            }
        ],
        "uncertain_items": [],
    }
    requests = []

    def handler(request):
        requests.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": json.dumps(expected)}, "finish_reason": "stop"}]
            },
        )

    wire = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    app.state.ai_gateway = Gateway({"openai": OpenAIProvider(wire)})
    response = client.post(
        path + "/parse",
        json={
            "input_mode": "images",
            "image_ids": [image["id"]],
            "provider_id": provider["id"],
            "model_id": model["id"],
        },
    )
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert data["payload"] == expected
    assert data["source"]["input_mode"] == "images"
    assert data["source"]["prompt_version"] == "curriculum-vision-v1"
    parts = next(
        message["content"]
        for message in requests[0]["messages"]
        if isinstance(message["content"], list)
    )
    assert parts[1]["image_url"]["url"].startswith("data:image/png;base64,")
    assert parts[1]["image_url"]["detail"] == "high"
    assert requests[0]["response_format"]["json_schema"]["strict"] is True
    assert "uncertain_items" in requests[0]["response_format"]["json_schema"]["schema"]["required"]
    assert "data:image" not in response.text and "data:image" not in caplog.text
    assert client.get(path).json()["data"]["curriculum"]["chapters"] == []
    client.portal.call(wire.aclose)


def test_image_parse_requires_owned_images_and_confirmed_vision_model(account_app):
    app, client, path, _ = setup(account_app)
    provider = client.post(
        "/api/v1/ai/providers",
        json={"provider_name": "text", "base_url": "http://localhost:1234/v1"},
    ).json()["data"]
    model = client.post(
        f"/api/v1/ai/providers/{provider['id']}/models", json={"model_name": "text-only"}
    ).json()["data"]
    image = client.post(
        path + "/images", content=png(), headers={"X-Filename": "photo.png"}
    ).json()["data"]
    body = {
        "input_mode": "images",
        "image_ids": [image["id"]],
        "provider_id": provider["id"],
        "model_id": model["id"],
    }
    result = client.post(path + "/parse", json=body)
    assert result.status_code == 400 and result.json()["error"]["code"] == "VISION_MODEL_REQUIRED"
    assert client.post(path + "/parse", json={**body, "image_ids": []}).status_code == 422
    assert (
        client.post(path + "/parse", json={**body, "image_ids": [str(uuid4())]}).status_code == 404
    )
    assert client.get(path).json()["data"]["versions"] == []


def test_image_decoder_rejects_animated_and_oversized_images():
    with pytest.raises(AppError):
        normalize_image(b"not-a-photo")
    assert normalize_image(png()).startswith(b"\x89PNG")


def test_pages_and_uncertain_items_require_review_before_confirmation(account_app):
    app, client, path, _ = setup(account_app)
    payload = json.loads(json.dumps(PAYLOAD))
    payload["chapters"][0].update(page_start=1, page_end=35)
    payload["chapters"][0]["sections"][0].update(page_start=1, page_end=10)
    payload["uncertain_items"] = ["请核对函数标题"]
    version = draft(client, path, payload)
    assert apply(client, path, version).json()["error"]["code"] == "UNRESOLVED_ITEMS"
    payload["uncertain_items"] = []
    saved = client.patch(
        path,
        json={
            "version_id": version["id"],
            "revision": 1,
            "base_course_revision": 0,
            "payload": payload,
        },
    ).json()["data"]
    assert apply(client, path, saved).status_code == 200
    formal = client.get(path).json()["data"]["curriculum"]
    assert formal["chapters"][0]["page_end"] == 35
    assert formal["chapters"][0]["sections"][0]["page_start"] == 1
    formal["chapters"][0]["page_start"] = 100
    assert (
        client.post(
            path + "/drafts", json={"payload": formal, "base_course_revision": 1}
        ).status_code
        == 422
    )


@pytest.mark.anyio
async def test_ocr_cancellation_kills_and_reaps_child(monkeypatch):
    started = asyncio.Event()

    class Process:
        returncode = None
        killed = False

        async def communicate(self, content=None):
            if self.killed:
                self.returncode = -9
                return b"", None
            started.set()
            await asyncio.Event().wait()

        def kill(self):
            self.killed = True

    process = Process()

    async def spawn(*args, **kwargs):
        return process

    monkeypatch.setattr(asyncio, "create_subprocess_exec", spawn)
    task = asyncio.create_task(LocalOCR().recognize(png()))
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert process.killed and process.returncode == -9
