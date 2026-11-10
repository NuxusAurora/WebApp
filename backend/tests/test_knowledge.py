import asyncio
import copy
import json
from uuid import UUID, uuid4

import httpx
import pytest
from sqlalchemy import select

from app.ai.adapters import OpenAIProvider
from app.ai.contracts import AIError, Result
from app.ai.gateway import Gateway
from app.curriculum.models import StructureVersion, WorkflowRun
from app.knowledge.models import KnowledgePoint
from app.models import Course
from tests.test_curriculum import apply as apply_directory
from tests.test_curriculum import draft as directory_draft
from tests.test_phase1 import account_app as account_app
from tests.test_phase1 import authenticate

PAYLOAD = {
    "knowledge_points": [
        {
            "temp_id": "kp_001",
            "existing_knowledge_point_id": None,
            "title": "函数的定义",
            "description": "非空集合之间的唯一对应。",
            "learning_objectives": ["能够解释函数定义"],
            "importance": "HIGH",
            "mastery_criteria": ["能判断给定对应是否为函数"],
        }
    ],
    "uncertain_items": [],
}


def setup(account_app):
    app, client = account_app
    cookie = authenticate(client, app)
    course = client.post("/api/v1/courses", json={"title": "高等数学"}).json()["data"]["id"]
    directory = f"/api/v1/courses/{course}/curriculum"
    version = directory_draft(
        client,
        directory,
        {
            "chapters": [
                {
                    "id": "tmp-c",
                    "title": "函数",
                    "sections": [
                        {"id": "tmp-s", "title": "函数的概念"},
                        {"id": "tmp-t", "title": "极限"},
                    ],
                }
            ]
        },
    )
    result = apply_directory(client, directory, version).json()["data"]
    section = result["id_mapping"]["tmp-s"]
    return app, client, f"/api/v1/sections/{section}/knowledge-points", directory, cookie


def draft(client, path, payload=None, base=1, **extra):
    result = client.post(
        path + "/drafts",
        json={"payload": payload or PAYLOAD, "base_course_revision": base, **extra},
    )
    assert result.status_code == 201, result.text
    return result.json()["data"]


def apply(client, path, version, **extra):
    return client.post(
        path + "/confirm",
        json={
            "version_id": version["id"],
            "expected_revision": version["revision"],
            "base_course_revision": version["base_course_revision"],
            **extra,
        },
    )


def test_knowledge_draft_edit_confirm_identity_status_history_and_scope(account_app):
    app, client, path, directory, _ = setup(account_app)
    version = draft(client, path)
    assert client.get(path).json()["data"]["knowledge_points"] == []
    assert client.get(directory).json()["data"]["versions"] == []
    payload = copy.deepcopy(PAYLOAD)
    payload["knowledge_points"][0]["title"] = "函数定义（已核对）"
    body = {
        "payload": payload,
        "version_id": version["id"],
        "expected_revision": 1,
        "base_course_revision": 1,
    }
    edited = client.patch(path, json=body).json()["data"]
    assert client.patch(path, json=body).status_code == 409
    assert apply(client, path, version).status_code == 409
    result = apply(client, path, edited)
    assert result.status_code == 200, result.text
    assert apply(client, path, edited).json() == result.json()
    point = client.get(path).json()["data"]["knowledge_points"][0]
    assert point["id"] == result.json()["data"]["id_mapping"]["kp_001"]
    assert point["status"] == "NOT_STARTED"

    async def mark_learned():
        async with app.state.resources.session() as db:
            row = await db.get(KnowledgePoint, UUID(point["id"]))
            row.status = "MASTERED"
            await db.commit()

    client.portal.call(mark_learned)
    payload["knowledge_points"][0].update(
        existing_knowledge_point_id=point["id"], description="修订定义"
    )
    next_version = draft(client, path, payload, 2)
    assert next_version["change_summary"]["modified"][0]["review_mastery"]
    assert apply(client, path, next_version).status_code == 200
    current = client.get(path).json()["data"]
    assert current["confirmed_revision"] == 3
    assert current["knowledge_points"][0]["id"] == point["id"]
    assert current["knowledge_points"][0]["status"] == "MASTERED"
    assert apply(client, path, edited).json() == result.json()
    # Directory confirmation must neither supersede nor consume a knowledge version.
    official = client.get(directory).json()["data"]["curriculum"]
    dv = directory_draft(client, directory, official, 3)
    assert apply_directory(client, directory, dv).status_code == 200

    async def history():
        async with app.state.resources.session() as db:
            assert (await db.get(StructureVersion, UUID(next_version["id"]))).status == "CONFIRMED"
            assert (await db.get(StructureVersion, UUID(version["id"]))).payload[
                "knowledge_points"
            ][0]["title"] == payload["knowledge_points"][0]["title"]

    client.portal.call(history)


@pytest.mark.parametrize(
    "mutation", ["duplicate_temp", "duplicate_match", "foreign", "state", "blank"]
)
def test_invalid_knowledge_contracts_and_cross_scope_ids(account_app, mutation):
    _, client, path, _, _ = setup(account_app)
    first = draft(client, path)
    apply(client, path, first)
    point = client.get(path).json()["data"]["knowledge_points"][0]
    payload = copy.deepcopy(PAYLOAD)
    if mutation == "duplicate_temp":
        payload["knowledge_points"].append(copy.deepcopy(payload["knowledge_points"][0]))
    elif mutation == "duplicate_match":
        payload["knowledge_points"][0]["existing_knowledge_point_id"] = point["id"]
        payload["knowledge_points"].append({**payload["knowledge_points"][0], "temp_id": "kp_002"})
    elif mutation == "foreign":
        payload["knowledge_points"][0]["existing_knowledge_point_id"] = str(uuid4())
    elif mutation == "state":
        payload["knowledge_points"][0]["status"] = "MASTERED"
    else:
        payload["knowledge_points"][0]["learning_objectives"] = [" "]
    assert client.post(
        path + "/drafts", json={"payload": payload, "base_course_revision": 2}
    ).status_code in {400, 422}
    assert len(client.get(path).json()["data"]["knowledge_points"]) == 1


def test_uncertainties_archival_stale_conflict_and_explicit_replacement(account_app):
    app, client, path, directory, _ = setup(account_app)
    payload = {**copy.deepcopy(PAYLOAD), "uncertain_items": ["定义需要核对教材"]}
    first = draft(client, path, payload)
    assert apply(client, path, first).json()["error"]["code"] == "UNRESOLVED_ITEMS"
    assert (
        client.post(
            path + "/drafts", json={"payload": PAYLOAD, "base_course_revision": 1}
        ).status_code
        == 409
    )
    replacement = draft(client, path, base=1, replace_version_id=first["id"], replace_revision=1)
    assert apply(client, path, first).status_code == 409
    assert apply(client, path, replacement).status_code == 200
    removed = draft(client, path, {"knowledge_points": [], "uncertain_items": []}, 2)
    assert apply(client, path, removed).json()["error"]["code"] == "ARCHIVE_CONFIRMATION_REQUIRED"
    assert apply(client, path, removed, accept_archives=True).status_code == 200
    assert client.get(path).json()["data"]["knowledge_points"] == []
    # Archived IDs cannot be reused implicitly.
    old = apply(client, path, replacement).json()["data"]["id_mapping"]["kp_001"]
    invalid = copy.deepcopy(PAYLOAD)
    invalid["knowledge_points"][0]["existing_knowledge_point_id"] = old
    assert (
        client.post(
            path + "/drafts", json={"payload": invalid, "base_course_revision": 3}
        ).status_code
        == 400
    )
    stale = draft(client, path, base=3)
    dv = directory_draft(client, directory, client.get(directory).json()["data"]["curriculum"], 3)
    apply_directory(client, directory, dv)
    assert apply(client, path, stale).status_code == 409


def test_ownership_missing_section_wrong_version_and_curriculum_archival(account_app):
    app, client, path, directory, cookie = setup(account_app)
    version = draft(client, path)
    apply(client, path, version)
    official = client.get(directory).json()["data"]["curriculum"]
    other_id = official["chapters"][0]["sections"][1]["id"]
    other = f"/api/v1/sections/{other_id}/knowledge-points"
    assert apply(client, other, version).status_code == 404
    invalid = copy.deepcopy(PAYLOAD)
    invalid["knowledge_points"][0]["existing_knowledge_point_id"] = client.get(path).json()["data"][
        "knowledge_points"
    ][0]["id"]
    assert (
        client.post(
            other + "/drafts", json={"payload": invalid, "base_course_revision": 2}
        ).status_code
        == 400
    )
    authenticate(client, app, "other@example.com")
    assert client.get(path).status_code == 404
    assert (
        client.post(
            path + "/drafts", json={"payload": PAYLOAD, "base_course_revision": 2}
        ).status_code
        == 404
    )
    assert apply(client, path, version).status_code == 404
    client.cookies.set("learning_session", cookie)
    official["chapters"][0]["sections"].pop(0)
    dv = directory_draft(client, directory, official, 2)
    assert dv["change_summary"]["knowledge_archived"][0]["title"] == "函数的定义"
    assert apply_directory(client, directory, dv).status_code == 409
    assert apply_directory(client, directory, dv, accept_archives=True).status_code == 200
    assert client.get(path).status_code == 404

    async def archived():
        async with app.state.resources.session() as db:
            point = await db.scalar(select(KnowledgePoint))
            assert point.archived_at is not None and point.status == "NOT_STARTED"

    client.portal.call(archived)


def test_generation_gateway_schema_provenance_and_failed_replacement_keeps_draft(
    account_app, caplog
):
    app, client, path, _, _ = setup(account_app)
    provider = client.post(
        "/api/v1/ai/providers",
        json={"provider_name": "local", "base_url": "http://localhost:1234/v1"},
    ).json()["data"]
    model = client.post(
        f"/api/v1/ai/providers/{provider['id']}/models", json={"model_name": "knowledge-fixture"}
    ).json()["data"]
    output = copy.deepcopy(PAYLOAD)
    requests = []

    def handler(request):
        requests.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": json.dumps(output)}, "finish_reason": "stop"}]
            },
        )

    wire = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    app.state.ai_gateway = Gateway({"openai": OpenAIProvider(wire)})
    body = {"provider_id": provider["id"], "model_id": model["id"], "base_course_revision": 1}
    response = client.post(path + "/generate", json=body)
    assert response.status_code == 201, response.text
    first = response.json()["data"]
    assert first["source"]["prompt_version"] == "knowledge-extract-v2"
    assert first["source"]["knowledge_basis"] == "model_knowledge"
    assert first["source"]["context"]["adjacent_sections"] == ["极限"]
    assert "函数的概念" in requests[0]["messages"][-1]["content"]
    assert client.get(path).json()["data"]["knowledge_points"] == []
    assert client.post(path + "/generate", json=body).status_code == 409
    output["knowledge_points"][0]["title"] = ""
    failure = client.post(
        path + "/generate", json={**body, "replace_version_id": first["id"], "replace_revision": 1}
    )
    assert failure.status_code == 502
    assert client.get(path).json()["data"]["draft"]["id"] == first["id"]
    assert apply(client, path, first).status_code == 200
    formal = client.get(path).json()["data"]["knowledge_points"][0]
    assert formal["source"] == {
        "kind": "ai",
        "knowledge_basis": "model_knowledge",
        "model_name": "knowledge-fixture",
        "prompt_version": "knowledge-extract-v2",
    }

    async def audit():
        async with app.state.resources.session() as db:
            runs = (
                await db.scalars(
                    select(WorkflowRun)
                    .where(WorkflowRun.workflow_type == "KNOWLEDGE_EXTRACTION")
                    .order_by(WorkflowRun.created_at)
                )
            ).all()
            assert [r.status for r in runs] == ["SUCCEEDED", "FAILED"]
            assert (
                json.loads((await db.get(StructureVersion, UUID(first["id"]))).raw_output)
                == PAYLOAD
            )

    client.portal.call(audit)
    assert "唯一对应" not in caplog.text
    client.portal.call(wire.aclose)


def test_course_delete_cascades_formal_knowledge_and_source_versions(account_app):
    app, client, path, directory, _ = setup(account_app)
    version = draft(client, path)
    assert apply(client, path, version).status_code == 200
    response = client.delete(directory.removesuffix("/curriculum"))
    assert response.status_code == 200, response.text
    assert client.get(path).status_code == 404

    async def verify():
        async with app.state.resources.session() as db:
            assert await db.scalar(select(KnowledgePoint)) is None
            assert await db.scalar(select(StructureVersion)) is None

    client.portal.call(verify)


@pytest.mark.parametrize(
    "mode", ["course_changes", "course_metadata_changes", "cancel", "model_error"]
)
def test_generation_inflight_change_cancellation_and_model_error_keep_previous(account_app, mode):
    app, client, path, directory, _ = setup(account_app)
    previous = draft(client, path)
    provider = client.post(
        "/api/v1/ai/providers",
        json={"provider_name": "local", "base_url": "http://localhost:1234/v1"},
    ).json()["data"]
    model = client.post(
        f"/api/v1/ai/providers/{provider['id']}/models", json={"model_name": "fixture"}
    ).json()["data"]

    class Controlled:
        async def execute(self, target, call, sink):
            if mode == "cancel":
                raise asyncio.CancelledError()
            if mode == "model_error":
                raise AIError("UPSTREAM_UNAVAILABLE")
            async with app.state.resources.session() as db:
                course = await db.get(Course, UUID(directory.split("/")[4]))
                if mode == "course_metadata_changes":
                    course.learning_goal = "mastery"
                else:
                    course.confirmed_revision += 1
                await db.commit()
            return Result(text=json.dumps(PAYLOAD), structured=PAYLOAD)

    app.state.ai_gateway = Controlled()
    body = {
        "provider_id": provider["id"],
        "model_id": model["id"],
        "base_course_revision": 1,
        "replace_version_id": previous["id"],
        "replace_revision": 1,
    }
    if mode == "cancel":
        try:
            client.post(path + "/generate", json=body)
        except BaseException:
            pass
    else:
        assert client.post(path + "/generate", json=body).status_code == (
            409 if mode.startswith("course_") else 502
        )
    assert client.get(path).json()["data"]["draft"]["id"] == previous["id"]

    async def audit():
        async with app.state.resources.session() as db:
            run = await db.scalar(select(WorkflowRun))
            assert run.status == ("CANCELLED" if mode == "cancel" else "FAILED")

    client.portal.call(audit)
