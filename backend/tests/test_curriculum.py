import asyncio
import base64
import hashlib
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


def test_image_upload_logs_safe_diagnostics_with_request_id(account_app, caplog):
    _, client, path, _ = setup(account_app)
    caplog.set_level("INFO", logger="structured_learning.requests")
    output = io.BytesIO()
    Image.new("RGB", (40, 20), "white").save(output, format="JPEG")
    content = output.getvalue()
    response = client.post(
        path + "/images",
        content=content,
        headers={
            "X-Filename": "private-course-title.JPG",
            "Content-Type": "image/jpeg; private=secret-value",
            "Authorization": "Bearer secret-value",
        },
    )
    assert response.status_code == 201
    events = [
        json.loads(record.message) for record in caplog.records if '"event"' in record.message
    ]
    event = next(item for item in events if item["event"] == "curriculum_image_validation")
    assert event["request_id"] == response.headers["X-Request-ID"]
    assert event["stage"] == "complete" and event["outcome"] == "normalized"
    assert event["input_bytes"] == len(content)
    assert event["input_sha256"] == hashlib.sha256(content).hexdigest()
    assert event["extension"] == ".jpg" and event["content_type"] == "image/jpeg"
    assert event["detected_format"] == "JPEG" and event["dimensions"] == [40, 20]
    assert event["frames"] == 1 and event["output_bytes"] == response.json()["data"]["size"]
    assert "private-course-title" not in json.dumps(events)
    assert "secret-value" not in json.dumps(events)


@pytest.mark.parametrize(
    "kind, reason, error_type",
    [
        ("unknown", "unrecognized_image", "UnidentifiedImageError"),
        ("unsupported", "unsupported_format", "ValueError"),
        ("truncated", "truncated_image", "OSError"),
        ("animated", "multiple_frames", "AppError"),
    ],
)
def test_image_upload_failure_logs_reason_without_content(
    account_app, caplog, kind, reason, error_type
):
    app, client, path, _ = setup(account_app)
    caplog.set_level("INFO", logger="structured_learning.requests")
    output = io.BytesIO()
    image = Image.new("RGB", (40, 20), "white")
    if kind == "unknown":
        content = b"private-image-content-not-a-real-photo"
    elif kind == "unsupported":
        image.save(output, format="PPM")
        content = output.getvalue()
    elif kind == "truncated":
        image.save(output, format="JPEG")
        content = output.getvalue()[:-10]
    else:
        image.save(
            output,
            format="GIF",
            save_all=True,
            append_images=[Image.new("RGB", (40, 20), "black")],
        )
        content = output.getvalue()
    response = client.post(
        path + "/images",
        content=content,
        headers={"X-Filename": "private-image-name.jpg", "Content-Type": "private/secret-value"},
    )
    assert response.status_code == 400 and response.json()["error"]["code"] == "FILE_TYPE"
    events = [
        json.loads(record.message) for record in caplog.records if '"event"' in record.message
    ]
    event = next(item for item in events if item["event"] == "curriculum_image_validation")
    assert event["request_id"] == response.headers["X-Request-ID"]
    assert event["outcome"] == "rejected" and event["error_code"] == "FILE_TYPE"
    assert event["reason"] == reason and event["exception_type"] == error_type
    assert event["input_sha256"] == hashlib.sha256(content).hexdigest()
    assert event["content_type"] == "other"
    logged = json.dumps(events)
    assert "private-image" not in logged and "secret-value" not in logged
    assert "exception_message" not in event
    assert app.state.store.objects == {}


@pytest.mark.parametrize(
    "format, extension",
    [
        ("PNG", "png"),
        ("JPEG", "jpeg"),
        ("JPEG", "jpg"),
        ("JPEG", "JPG"),
        ("MPO", "jpg"),
        ("WEBP", "webp"),
        ("BMP", "bmp"),
        ("GIF", "gif"),
        ("TIFF", "tiff"),
        ("AVIF", "avif"),
    ],
)
def test_upload_supported_formats_preserves_jpeg_and_normalizes_others(
    account_app, format, extension
):
    app, client, path, _ = setup(account_app)
    output = io.BytesIO()
    options = (
        {"save_all": True, "append_images": [Image.new("RGB", (8, 8), "black")]}
        if format == "MPO"
        else {}
    )
    Image.new("RGB", (40, 20), "white").save(output, format=format, **options)
    result = client.post(
        path + "/images",
        content=output.getvalue(),
        headers={
            "X-Filename": "contents." + extension,
            "Content-Type": "application/octet-stream",
        },
    )
    assert result.status_code == 201, result.text
    assert len(app.state.store.objects) == 1
    key, value = next(iter(app.state.store.objects.items()))
    jpeg = format in {"JPEG", "MPO"}
    assert key.endswith(".jpg" if jpeg else ".png")
    if format == "JPEG":
        assert value == output.getvalue()
    with Image.open(io.BytesIO(value)) as image:
        assert image.format == ("JPEG" if jpeg else "PNG")
        assert image.mode == "RGB" and image.size == (40, 20)
    assert client.delete(path.removesuffix("/curriculum")).status_code == 200
    assert app.state.store.objects == {}


@pytest.mark.parametrize("format", ["PNG", "WEBP", "GIF", "TIFF", "AVIF"])
def test_image_normalization_flattens_transparency_on_white(format):
    output = io.BytesIO()
    Image.new("RGBA", (40, 20), (0, 0, 0, 0)).save(output, format=format)
    with Image.open(io.BytesIO(normalize_image(output.getvalue()))) as image:
        assert image.getpixel((0, 0)) == (255, 255, 255)


@pytest.mark.parametrize("format", ["PNG", "WEBP", "GIF", "TIFF", "AVIF"])
def test_image_normalization_rejects_animation_and_multiple_pages(format):
    output = io.BytesIO()
    Image.new("RGB", (40, 20), "white").save(
        output, format=format, save_all=True, append_images=[Image.new("RGB", (40, 20), "black")]
    )
    with pytest.raises(AppError, match="单张图片"):
        normalize_image(output.getvalue())


def test_image_normalization_keeps_orientation_and_rejects_unsupported_content():
    output = io.BytesIO()
    exif = Image.Exif()
    exif[274] = 6
    Image.new("RGB", (40, 20), "white").save(output, format="TIFF", exif=exif)
    with Image.open(io.BytesIO(normalize_image(output.getvalue()))) as image:
        assert image.size == (20, 40)
        assert not image.getexif()
    unsupported = io.BytesIO()
    Image.new("RGB", (40, 20), "white").save(unsupported, format="PPM")
    for content in (unsupported.getvalue(), b"<svg/>", b"RIFFbrokenWEBP"):
        with pytest.raises(AppError) as error:
            normalize_image(content)
        assert error.value.code == "FILE_TYPE"


@pytest.mark.parametrize("mode, orientation", [("RGB", 6), ("CMYK", 1), ("L", 1)])
def test_jpeg_orientation_and_color_conversion_remain_jpeg(mode, orientation):
    output = io.BytesIO()
    exif = Image.Exif()
    exif[274] = orientation
    Image.new(mode, (40, 20)).save(output, format="JPEG", exif=exif)
    normalized = normalize_image(output.getvalue())
    with Image.open(io.BytesIO(normalized)) as image:
        assert image.format == "JPEG"
        assert image.mode == ("L" if mode == "L" else "RGB")
        assert image.size == ((20, 40) if orientation == 6 else (40, 20))
        if orientation == 6:
            assert image.getexif().get(274, 1) == 1
    if mode == "L":
        assert normalized == output.getvalue()


@pytest.mark.parametrize("orientation, frame_count", [(1, 2), (6, 3)])
def test_mpo_jpg_extracts_oriented_primary_without_auxiliary_images(orientation, frame_count):
    output = io.BytesIO()
    exif = Image.Exif()
    exif[274] = orientation
    Image.new("RGB", (40, 20), "red").save(
        output,
        format="MPO",
        save_all=True,
        append_images=[Image.new("RGB", (8, 8), "blue") for _ in range(frame_count - 1)],
        exif=exif,
    )
    content = output.getvalue()
    with Image.open(io.BytesIO(content)) as original:
        assert original.format == "MPO" and original.n_frames == frame_count
    details = {}
    normalized = normalize_image(content, diagnostics=details)
    with Image.open(io.BytesIO(normalized)) as image:
        image.load()
        assert image.format == "JPEG" and getattr(image, "n_frames", 1) == 1
        assert image.size == ((20, 40) if orientation == 6 else (40, 20))
        red, green, blue = image.getpixel((0, 0))
        assert red > 240 and green < 10 and blue < 10
        assert image.getexif().get(274, 1) == 1
    assert b"MPF\x00" not in normalized
    assert details["detected_format"] == "MPO" and details["frames"] == frame_count
    assert details["selected_frame"] == 0 and details["output_format"] == "JPEG"


def test_image_normalization_does_not_limit_dimensions_or_pixel_count():
    assert Image.MAX_IMAGE_PIXELS is None
    output = io.BytesIO()
    Image.new("RGB", (4001, 4000), "white").save(output, format="PNG")
    normalized = normalize_image(output.getvalue())
    with Image.open(io.BytesIO(normalized)) as image:
        assert image.size == (4001, 4000)


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
            path + "/images", content=b"x" * (50 * 1024 * 1024 + 1), headers={"X-Filename": "x.png"}
        ).status_code
        == 413
    )
    content = png()
    content += b"\0" * (50 * 1024 * 1024 - len(content))
    result = client.post(path + "/images", content=content, headers={"X-Filename": "contents.png"})
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
    assert result.json()["data"]["source"]["prompt_version"] == "curriculum-parse-v2"
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


@pytest.mark.parametrize("image_format", ["PNG", "JPEG", "MPO"])
def test_image_parse_bypasses_ocr_sends_private_image_and_requires_schema(
    account_app, monkeypatch, caplog, image_format
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
    output = io.BytesIO()
    options = (
        {"save_all": True, "append_images": [Image.new("RGB", (8, 8), "black")]}
        if image_format == "MPO"
        else {}
    )
    Image.new("RGB", (40, 20), "white").save(output, format=image_format, **options)
    image = client.post(
        path + "/images", content=output.getvalue(), headers={"X-Filename": "photo.png"}
    ).json()["data"]
    image_ids = [image["id"]]
    if image_format == "PNG":
        next_photo = io.BytesIO()
        Image.new("RGB", (40, 20), "black").save(next_photo, format="PNG")
        second = client.post(
            path + "/images", content=next_photo.getvalue(), headers={"X-Filename": "next.png"}
        ).json()["data"]
        image_ids.insert(0, second["id"])
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
                "choices": [
                    {
                        "message": {"content": json.dumps({**expected, "gaps": []})},
                        "finish_reason": "stop",
                    }
                ]
            },
        )

    wire = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    app.state.ai_gateway = Gateway({"openai": OpenAIProvider(wire)})
    response = client.post(
        path + "/parse",
        json={
            "input_mode": "images",
            "image_ids": image_ids,
            "provider_id": provider["id"],
            "model_id": model["id"],
        },
    )
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert data["payload"] == expected
    assert data["source"]["input_mode"] == "images"
    assert data["source"]["prompt_version"] == "curriculum-vision-v3"
    assert data["source"]["image_ids"] == image_ids
    parts = next(
        message["content"]
        for message in requests[0]["messages"]
        if isinstance(message["content"], list)
    )
    media_type = "image/png" if image_format == "PNG" else "image/jpeg"
    assert parts[1]["image_url"]["url"].startswith(f"data:{media_type};base64,")
    if image_format == "PNG":
        decoded_photos = [
            base64.b64decode(part["image_url"]["url"].split(",", 1)[1]) for part in parts[1:]
        ]
        colors = []
        for photo in decoded_photos:
            with Image.open(io.BytesIO(photo)) as decoded:
                colors.append(decoded.convert("RGB").getpixel((0, 0)))
        assert colors == [(0, 0, 0), (255, 255, 255)]
    if image_format == "JPEG":
        assert base64.b64decode(parts[1]["image_url"]["url"].split(",", 1)[1]) == output.getvalue()
    if image_format == "MPO":
        sent = base64.b64decode(parts[1]["image_url"]["url"].split(",", 1)[1])
        with Image.open(io.BytesIO(sent)) as decoded:
            assert decoded.format == "JPEG" and getattr(decoded, "n_frames", 1) == 1
    assert parts[1]["image_url"]["detail"] == "high"
    assert requests[0]["response_format"]["json_schema"]["strict"] is True
    assert "uncertain_items" in requests[0]["response_format"]["json_schema"]["schema"]["required"]
    assert "data:image" not in response.text and "data:image" not in caplog.text
    assert client.get(path).json()["data"]["curriculum"]["chapters"] == []
    client.portal.call(wire.aclose)


@pytest.mark.parametrize("input_mode", ["images", "text"])
def test_parse_excludes_exercise_solutions(account_app, monkeypatch, input_mode):
    app, client, path, _ = setup(account_app)
    monkeypatch.setattr(
        app.state.store, "read", lambda key, size: app.state.store.objects[key], raising=False
    )
    provider = client.post(
        "/api/v1/ai/providers",
        json={"provider_name": "local", "base_url": "http://localhost:1234/v1"},
    ).json()["data"]
    model = client.post(
        f"/api/v1/ai/providers/{provider['id']}/models",
        json={
            "model_name": "local-test",
            "capabilities": {"vision": True, "structured_output": True},
            "capabilities_confirmed": True,
        },
    ).json()["data"]

    def node(key, title, page):
        return {"id": f"tmp-{key}", "title": title, "page_start": page, "page_end": None}

    exercises = [
        node("exercises", "习题一", 4),
        node("review", "复习题", 5),
        node("next-section", "1.3 习题全解的编写方法", 8),
    ]
    solutions = {
        **node("appendix", "附录一　各章习题参考答案", 10),
        "sections": [node("nested", "函数与极限", 11)],
    }
    chapter = {
        **node("chapter", "第一章 函数与极限", 1),
        "sections": [
            *exercises[:2],
            node("solutions", "１．２　习 题 全 解［待核对］", 6),
            node("volume-solutions", "【习题全解（上册）】", 7),
            exercises[2],
        ],
    }
    result = {"chapters": [chapter, solutions], "uncertain_items": []}
    requests = []

    def handler(request):
        requests.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": json.dumps(result)}, "finish_reason": "stop"}]
            },
        )

    wire = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    app.state.ai_gateway = Gateway({"openai": OpenAIProvider(wire)})
    body = {"input_mode": input_mode, "provider_id": provider["id"], "model_id": model["id"]}
    if input_mode == "images":
        result["gaps"] = []
        image = client.post(
            path + "/images", content=png(), headers={"X-Filename": "photo.png"}
        ).json()["data"]
        body["image_ids"] = [image["id"]]
    else:
        body["ocr_text"] = "第一章 函数与极限\n习题一\n习题全解\n附录一 各章习题参考答案"

    try:
        response = client.post(path + "/parse", json=body)
        assert response.status_code == 201, response.text
        saved = response.json()["data"]
        assert saved["payload"]["chapters"] == [{**chapter, "sections": exercises}]
        assert any(
            message["role"] == "system" and "跳过「习题全解」" in message["content"]
            for message in requests[0]["messages"]
        )

        for excluded in ([solutions], []):
            result["chapters"] = excluded
            response = client.post(path + "/parse", json=body)
            assert response.status_code == 422, response.text
            assert response.json()["error"]["code"] == "NO_CURRICULUM_CHAPTERS"
            assert client.get(path).json()["data"]["versions"] == [saved]
    finally:
        client.portal.call(wire.aclose)


def test_fills_only_the_requested_gap_from_new_images_with_revision_check(account_app, monkeypatch):
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

    def node(key, name, page):
        return {"id": f"tmp-{key}", "title": name, "page_start": page, "page_end": None}

    left = node("first", "1.1 映射与函数", 1)
    right = node("third", "1.3 连续性", 10)
    chapter = {**node("chapter", "函数与极限", 1), "sections": [left, right]}
    following_chapter = {**node("last", "积分", 30), "sections": []}
    vision_result = {
        "chapters": [chapter, following_chapter],
        "uncertain_items": ["请核对第三章标题"],
        "gaps": [
            {"chapter_id": chapter["id"], "after_id": left["id"], "reason": "1.2 未拍到"},
            {"chapter_id": None, "after_id": chapter["id"], "reason": "缺第二章"},
        ],
    }
    calls = []
    responses = [
        vision_result,
        {"complete": False, "items": [], "uncertain_items": []},
        {
            "complete": True,
            "items": [node("different", "映射与函数", 1), node("first", "1.2 极限", 5)],
            "uncertain_items": [],
        },
        {
            "complete": True,
            "items": [{**node("chapter", "微分", 20), "sections": [node("first", "导数", 21)]}],
            "uncertain_items": [],
        },
    ]
    responses.append(responses[-1])
    edit_during_request = None

    async def handler(request):
        calls.append(json.loads(request.content))
        if edit_during_request:
            async with app.state.resources.session() as db:
                changed = await db.get(StructureVersion, UUID(edit_during_request))
                updated = dict(changed.payload)
                updated["uncertain_items"] = [
                    *updated["uncertain_items"],
                    "来自另一个窗口的草稿修改",
                ]
                changed.payload = updated
                changed.revision += 1
                await db.commit()
        return httpx.Response(
            200,
            json={
                "choices": [
                    {"message": {"content": json.dumps(responses.pop(0))}, "finish_reason": "stop"}
                ]
            },
        )

    wire = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    app.state.ai_gateway = Gateway({"openai": OpenAIProvider(wire)})
    image_ids = [
        client.post(path + "/images", content=png(), headers={"X-Filename": filename}).json()[
            "data"
        ]["id"]
        for filename in ("initial.png", "supplement.png")
    ]
    selection = {"provider_id": provider["id"], "model_id": model["id"]}
    try:
        created = client.post(
            path + "/parse",
            json={**selection, "input_mode": "images", "image_ids": image_ids[:1]},
        )
        assert created.status_code == 201, created.text
        version = created.json()["data"]
        section_gap, chapter_gap = version["payload"]["gaps"]
        assert section_gap["after_id"] == left["id"]
        assert apply(client, path, version).json()["error"]["code"] == "UNRESOLVED_GAPS"
        body = {
            **selection,
            "image_ids": image_ids[1:],
            "version_id": version["id"],
            "revision": 1,
            "base_course_revision": 0,
            "gap_id": section_gap["id"],
        }
        incomplete = client.post(path + "/supplement", json=body)
        assert incomplete.status_code == 422
        assert incomplete.json()["error"]["code"] == "GAP_INCOMPLETE"
        assert client.get(path).json()["data"]["versions"] == [version]

        response = client.post(path + "/supplement", json=body)
        assert response.status_code == 200, response.text
        filled = response.json()["data"]
        assert filled["id"] == version["id"] and filled["revision"] == 2
        assert filled["payload"]["chapters"][1] == following_chapter
        sections = filled["payload"]["chapters"][0]["sections"]
        assert sections[0] == left and sections[2] == right
        assert sections[1]["title"] == "1.2 极限" and sections[1]["id"] != left["id"]
        assert filled["payload"]["gaps"] == [chapter_gap]
        assert filled["payload"]["uncertain_items"] == vision_result["uncertain_items"]
        assert len(calls) == 3
        assert client.post(path + "/supplement", json=body).status_code == 409
        assert len(calls) == 3

        chapter_body = {**body, "revision": 2, "gap_id": chapter_gap["id"]}
        edit_during_request = version["id"]
        assert client.post(path + "/supplement", json=chapter_body).status_code == 409
        externally_updated = client.get(path).json()["data"]["versions"][0]
        assert externally_updated["revision"] == 3
        assert externally_updated["payload"]["gaps"] == [chapter_gap]
        assert externally_updated["payload"]["uncertain_items"][-1] == "来自另一个窗口的草稿修改"
        edit_during_request = None

        response = client.post(path + "/supplement", json={**chapter_body, "revision": 3})
        assert response.status_code == 200, response.text
        filled = response.json()["data"]
        assert [row["title"] for row in filled["payload"]["chapters"]] == [
            "函数与极限",
            "微分",
            "积分",
        ]
        assert filled["payload"]["chapters"][0]["sections"] == sections
        assert not filled["payload"].get("gaps")
        assert client.get(path).json()["data"]["curriculum"]["chapters"] == []
        for call in calls[1:]:
            content = next(
                message["content"] for message in call["messages"] if message["role"] == "user"
            )
            assert len([part for part in content if part["type"] == "image_url"]) == 1
    finally:
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
