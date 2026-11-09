import base64
import binascii
from collections.abc import AsyncIterator
from typing import Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, hide_input_in_errors=True)


class Capabilities(Contract):
    vision: bool = False
    streaming: bool = False
    structured_output: bool = False
    tool_calling: bool = False
    max_context_tokens: int = Field(default=4096, ge=256, le=2_000_000)


class Message(Contract):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1, max_length=24000)


class ImageInput(Contract):
    data_url: SecretStr = Field(max_length=7_000_000, repr=False)

    @field_validator("data_url")
    @classmethod
    def embedded_image(cls, value):
        header, separator, encoded = value.get_secret_value().partition(",")
        if not separator or header not in {"data:image/png;base64", "data:image/jpeg;base64"}:
            raise ValueError("Only embedded PNG/JPEG images are supported")
        try:
            content = base64.b64decode(encoded, validate=True)
        except binascii.Error, ValueError:
            raise ValueError("Invalid image encoding") from None
        signature = b"\x89PNG\r\n\x1a\n" if header == "data:image/png;base64" else b"\xff\xd8\xff"
        if not content.startswith(signature) or len(content) > 5 * 1024 * 1024:
            raise ValueError("Invalid or oversized image")
        return value


class RetryPolicy(Contract):
    max_retries: int = Field(default=2, ge=0, le=2)


class Call(Contract):
    task_type: str = Field(default="connection_test", pattern=r"^[a-z][a-z0-9_]{0,63}$")
    messages: list[Message] = Field(min_length=1, max_length=32)
    images: list[ImageInput] = Field(default_factory=list, max_length=5, repr=False)
    task_context: dict[str, Any] = Field(default_factory=dict)
    output_schema: dict[str, Any] | None = None
    timeout: float = Field(default=60, ge=0.05, le=120)
    retry_policy: RetryPolicy = Field(default_factory=RetryPolicy)
    max_output_tokens: int = Field(default=1024, ge=16, le=8192)
    prompt_version: str = Field(default="caller-v1", max_length=80)


class Target(Contract):
    provider_id: str
    model_id: str
    protocol: Literal["openai"]
    base_url: str
    model_name: str
    api_key: SecretStr
    capabilities: Capabilities
    config_revision: str = ""


class Usage(Contract):
    input_tokens: int | None = Field(default=None, ge=0)
    output_tokens: int | None = Field(default=None, ge=0)


class Result(Contract):
    text: str
    usage: Usage = Field(default_factory=Usage)
    structured: Any = None


class Chunk(Contract):
    text: str = ""
    usage: Usage | None = None
    done: bool = False


class AIError(Exception):
    def __init__(self, code: str, retryable: bool = False):
        self.code = code
        self.retryable = retryable
        super().__init__(code)


class LLMProvider(Protocol):
    async def chat(self, target: Target, call: Call) -> Result: ...
    def stream(self, target: Target, call: Call) -> AsyncIterator[Chunk]: ...
    async def generate_structured(self, target: Target, call: Call) -> Result: ...
    async def test_connection(self, target: Target) -> Result: ...
    def get_capabilities(self, target: Target) -> Capabilities: ...
