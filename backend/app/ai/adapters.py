"""Wire protocols only. Response bodies and transport exceptions never escape this layer."""

import codecs
import json
from collections.abc import AsyncIterator

import httpx
from pydantic import SecretStr

from app.ai.contracts import AIError, Call, Capabilities, Chunk, Message, Result, Target, Usage
from app.ai.discovery import model_catalog
from app.ai.prompts import prompt

MAX_RESPONSE = 1024 * 1024


async def bounded_lines(response):
    decoder = codecs.getincrementaldecoder("utf-8")()
    buffer = ""
    size = 0
    async for chunk in response.aiter_bytes():
        size += len(chunk)
        if size > MAX_RESPONSE:
            raise AIError("AI_RESPONSE_TOO_LARGE")
        buffer += decoder.decode(chunk)
        while "\n" in buffer:
            line, buffer = buffer.split("\n", 1)
            yield line.rstrip("\r")
    buffer += decoder.decode(b"", final=True)
    if buffer:
        yield buffer.rstrip("\r")


def status_error(status: int):
    if status in {401, 403}:
        return AIError("AI_AUTH_FAILED")
    if status == 429:
        return AIError("AI_RATE_LIMITED", True)
    if status >= 500:
        return AIError("AI_UNAVAILABLE", True)
    return AIError("AI_REQUEST_REJECTED")


def usage(data: dict) -> Usage:
    return Usage(
        input_tokens=data.get("prompt_tokens"), output_tokens=data.get("completion_tokens")
    )


class HTTPProvider:
    protocol = "openai"
    endpoint = "/chat/completions"

    def __init__(self, client: httpx.AsyncClient):
        self.client = client

    def get_capabilities(self, target: Target) -> Capabilities:
        return target.capabilities

    def headers(self, target: Target):
        key = target.api_key.get_secret_value()
        return {"Authorization": f"Bearer {key}"} if key else {}

    async def discover_models(self, base_url: str, api_key: SecretStr):
        key = api_key.get_secret_value()
        headers = {"Authorization": f"Bearer {key}"} if key else {}
        try:
            async with self.client.stream(
                "GET", base_url + "/models", headers=headers, timeout=15, follow_redirects=False
            ) as response:
                if response.status_code != 200:
                    raise status_error(response.status_code)
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_RESPONSE:
                        raise AIError("AI_RESPONSE_TOO_LARGE")
                return model_catalog(json.loads(body))
        except httpx.TimeoutException:
            raise AIError("AI_TIMEOUT", True) from None
        except httpx.HTTPError:
            raise AIError("AI_UNAVAILABLE", True) from None
        except ValueError, KeyError, TypeError:
            raise AIError("AI_INVALID_RESPONSE") from None

    def payload(self, target: Target, call: Call, stream: bool):
        messages = [item.model_dump() for item in call.messages]
        if call.task_context:
            messages.append(
                {
                    "role": "user",
                    "content": json.dumps({"task_context": call.task_context}, ensure_ascii=False),
                }
            )
        data = {"model": target.model_name, "stream": stream, "max_tokens": call.max_output_tokens}
        data["messages"] = messages
        if stream:
            data["stream_options"] = {"include_usage": True}
        if call.output_schema is not None and target.capabilities.structured_output:
            data["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": "task_result",
                    "strict": True,
                    "schema": call.output_schema,
                },
            }
        return data

    async def chat(self, target: Target, call: Call) -> Result:
        try:
            async with self.client.stream(
                "POST",
                target.base_url + self.endpoint,
                headers=self.headers(target),
                json=self.payload(target, call, False),
                timeout=call.timeout,
            ) as response:
                if response.status_code != 200:
                    raise status_error(response.status_code)
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_RESPONSE:
                        raise AIError("AI_RESPONSE_TOO_LARGE")
                data = json.loads(body)
            choice = data["choices"][0]
            if choice.get("finish_reason") != "stop":
                raise AIError("AI_INCOMPLETE_RESPONSE")
            text = choice["message"]["content"]
            if not isinstance(text, str) or not text.strip():
                raise AIError("AI_INVALID_RESPONSE")
            return Result(text=text, usage=usage(data.get("usage", {})))
        except httpx.TimeoutException:
            raise AIError("AI_TIMEOUT", True) from None
        except httpx.HTTPError:
            raise AIError("AI_UNAVAILABLE", True) from None
        except ValueError, KeyError, IndexError, TypeError:
            raise AIError("AI_INVALID_RESPONSE") from None

    async def generate_structured(self, target: Target, call: Call) -> Result:
        return await self.chat(target, call)

    async def test_connection(self, target: Target) -> Result:
        return await self.chat(
            target, Call(messages=[Message(role="user", content=prompt("probe"))])
        )

    async def stream(self, target: Target, call: Call) -> AsyncIterator[Chunk]:
        try:
            async with self.client.stream(
                "POST",
                target.base_url + self.endpoint,
                headers=self.headers(target),
                json=self.payload(target, call, True),
                timeout=call.timeout,
            ) as response:
                if response.status_code != 200:
                    raise status_error(response.status_code)
                event_data = []
                finished = False
                last_usage = Usage()
                async for line in bounded_lines(response):
                    if line.startswith("data:"):
                        event_data.append(line[5:].lstrip())
                    if line != "" or not event_data:
                        continue
                    raw = "\n".join(event_data)
                    event_data = []
                    if raw == "[DONE]":
                        if not finished:
                            raise AIError("AI_INCOMPLETE_RESPONSE")
                        yield Chunk(done=True, usage=last_usage)
                        return
                    data = json.loads(raw)
                    if "error" in data or data.get("type") == "error":
                        raise AIError("AI_STREAM_FAILED")
                    if data.get("usage"):
                        last_usage = usage(data["usage"])
                    choices = data.get("choices", [])
                    if choices:
                        choice = choices[0]
                        text = choice.get("delta", {}).get("content")
                        if text:
                            yield Chunk(text=text)
                        reason = choice.get("finish_reason")
                        if reason is not None:
                            if reason != "stop":
                                raise AIError("AI_INCOMPLETE_RESPONSE")
                            finished = True
                raise AIError("AI_INCOMPLETE_RESPONSE")
        except httpx.TimeoutException:
            raise AIError("AI_TIMEOUT", True) from None
        except httpx.HTTPError:
            raise AIError("AI_UNAVAILABLE", True) from None
        except ValueError, KeyError, IndexError, TypeError:
            raise AIError("AI_INVALID_RESPONSE") from None


class OpenAIProvider(HTTPProvider):
    pass
