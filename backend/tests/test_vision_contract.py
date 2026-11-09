import base64
import io

import httpx
import pytest
from PIL import Image
from pydantic import ValidationError

from app.ai import contracts
from app.ai.adapters import OpenAIProvider
from app.ai.contracts import AIError, Call, Capabilities, Message, Target
from app.curriculum.contracts import output_schema


def photo():
    output = io.BytesIO()
    Image.new("RGB", (10, 10), "white").save(output, format="PNG")
    return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode()


def test_images_are_bounded_embedded_and_hidden_from_representations():
    image_type = getattr(contracts, "ImageInput", None)
    assert image_type is not None, "Gateway has no image input contract"
    image = image_type(data_url=photo())
    assert photo() not in repr(image)
    for value in [
        "https://private.invalid/image.png",
        "data:image/svg+xml;base64,PHN2Zy8+",
        "data:image/png;base64,invalid!",
    ]:
        with pytest.raises(ValidationError):
            image_type(data_url=value)


def test_image_json_schema_requires_every_field_and_explicit_unknown_pages():
    schema = output_schema(strict=True)

    def inspect(value):
        if isinstance(value, dict):
            if value.get("type") == "object":
                assert set(value["required"]) == set(value["properties"])
                assert value["additionalProperties"] is False
            for child in value.values():
                inspect(child)
        elif isinstance(value, list):
            for child in value:
                inspect(child)

    inspect(schema)


@pytest.mark.anyio
async def test_adapter_sends_images_with_high_detail_and_keeps_text_calls_unchanged():
    image_type = getattr(contracts, "ImageInput", None)
    assert image_type is not None, "Gateway has no image input contract"
    target = Target(
        provider_id="p",
        model_id="m",
        protocol="openai",
        base_url="http://local/v1",
        model_name="test",
        api_key="",
        capabilities=Capabilities(vision=True),
    )
    async with httpx.AsyncClient() as client:
        adapter = OpenAIProvider(client)
        text = Call(messages=[Message(role="user", content="目录")])
        assert adapter.payload(target, text, False)["messages"][0]["content"] == "目录"
        call = Call(messages=text.messages, images=[image_type(data_url=photo())])
        content = adapter.payload(target, call, False)["messages"][0]["content"]
        assert content[0] == {"type": "text", "text": "目录"}
        assert content[1] == {"type": "image_url", "image_url": {"url": photo(), "detail": "high"}}
        with pytest.raises(AIError, match="AI_UNSUPPORTED_CAPABILITY"):
            adapter.payload(target.model_copy(update={"capabilities": Capabilities()}), call, False)
