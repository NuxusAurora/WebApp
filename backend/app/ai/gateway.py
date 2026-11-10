import asyncio
import json
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import aclosing

from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError, ValidationError

from app.ai.contracts import AIError, Call, Chunk, LLMProvider, Message, Result, Target, Usage
from app.ai.diagnostics import call_trace, current_trace
from app.ai.prompts import prompt

AuditSink = Callable[[dict], Awaitable[None]]


def schema_validator(schema):
    # Remote references must never trigger file/network reads in the validator.
    def check(value):
        if isinstance(value, dict):
            if any(key in value for key in ("$ref", "$dynamicRef")):
                raise AIError("AI_INVALID_SCHEMA")
            for item in value.values():
                check(item)
        elif isinstance(value, list):
            for item in value:
                check(item)

    try:
        check(schema)
        Draft202012Validator.check_schema(schema)
        return Draft202012Validator(schema)
    except SchemaError, RecursionError:
        raise AIError("AI_INVALID_SCHEMA") from None


def extract_json(text):
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines[-1].strip() == "```":
            text = "\n".join(lines[1:-1]).strip()
    # No greedy substring extraction: multiple objects or trailing prose fail closed.
    return json.loads(text, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))


class Gateway:
    def __init__(self, providers: dict[str, LLMProvider]):
        self.providers = providers

    async def _audit(self, sink, state, started):
        state["duration_ms"] = round((time.monotonic() - started) * 1000)
        trace = current_trace()
        previous_stage = trace.fields["stage"] if trace else None
        if trace:
            trace.step("audit")
        try:
            await asyncio.wait_for(sink(dict(state)), timeout=3)
        except Exception as error:
            if trace:
                trace.fields["exception_type"] = type(error).__name__
            raise AIError("AI_AUDIT_UNAVAILABLE") from None
        else:
            if trace:
                trace.fields["stage"] = previous_stage

    async def execute(
        self, target: Target, call: Call, sink: AuditSink, *, diagnostics: dict | None = None
    ) -> Result:
        with call_trace(call.task_type, diagnostics):
            return await self._execute(target, call, sink)

    async def _execute(self, target: Target, call: Call, sink: AuditSink) -> Result:
        trace = current_trace()
        started = time.monotonic()
        state = {
            "status": "FAILED",
            "attempts": 0,
            "error_code": None,
            "input_tokens": None,
            "output_tokens": None,
        }
        try:
            if call.images and not target.capabilities.vision:
                raise AIError("AI_UNSUPPORTED_CAPABILITY")
            validator = (
                schema_validator(call.output_schema) if call.output_schema is not None else None
            )
            messages = list(call.messages)
            trace.step("prepare_messages")
            if validator:
                messages.insert(
                    0,
                    Message(
                        role="system",
                        content=(prompt("structured") + json.dumps(call.output_schema)),
                    ),
                )
            adapter = self.providers[target.protocol]
            async with asyncio.timeout(call.timeout):
                for attempt in range(call.retry_policy.max_retries + 1):
                    state["attempts"] += 1
                    trace.begin_attempt(state["attempts"])
                    try:
                        current = call.model_copy(update={"messages": messages})
                        result = await (
                            adapter.generate_structured(target, current)
                            if validator
                            else adapter.chat(target, current)
                        )
                        for name, value in result.usage.model_dump().items():
                            if value is not None:
                                state[name] = (state[name] or 0) + value
                        if validator:
                            try:
                                trace.step("parse_output_json")
                                structured = extract_json(result.text)
                                trace.step("validate_output_schema")
                                validator.validate(structured)
                            except (ValueError, ValidationError, RecursionError) as error:
                                trace.exception(error)
                                messages.append(Message(role="user", content=prompt("repair")))
                                raise AIError("AI_SCHEMA_MISMATCH", True) from None
                            result = result.model_copy(update={"structured": structured})
                        state["status"] = "SUCCEEDED"
                        return result.model_copy(
                            update={
                                "usage": Usage(
                                    input_tokens=state["input_tokens"],
                                    output_tokens=state["output_tokens"],
                                )
                            }
                        )
                    except AIError as error:
                        trace.exception(error)
                        trace.emit("ai_call_attempt", "failed", error.code)
                        if not error.retryable or attempt == call.retry_policy.max_retries:
                            raise
                        trace.step("retry_backoff")
                        await asyncio.sleep(0.1 * 2**attempt)
            raise AIError("AI_UNAVAILABLE")
        except TimeoutError:
            trace.fields.update(timeout_source="gateway_deadline", exception_type="TimeoutError")
            state["error_code"] = "AI_TIMEOUT"
            raise AIError("AI_TIMEOUT") from None
        except asyncio.CancelledError:
            trace.fields.update(timeout_source="caller_cancelled", exception_type="CancelledError")
            state.update(status="CANCELLED", error_code="AI_CANCELLED")
            raise
        except AIError as error:
            state["error_code"] = error.code
            raise
        except Exception:
            state["error_code"] = "AI_INVALID_RESPONSE"
            raise AIError("AI_INVALID_RESPONSE") from None
        finally:
            await asyncio.shield(self._audit(sink, state, started))

    async def stream(self, target: Target, call: Call, sink: AuditSink) -> AsyncIterator[Chunk]:
        started = time.monotonic()
        state = {
            "status": "CANCELLED",
            "attempts": 0,
            "error_code": "AI_CANCELLED",
            "input_tokens": None,
            "output_tokens": None,
        }
        try:
            if not target.capabilities.streaming or call.output_schema is not None:
                raise AIError("AI_UNSUPPORTED_CAPABILITY")
            emitted = False
            async with asyncio.timeout(call.timeout):
                for attempt in range(call.retry_policy.max_retries + 1):
                    state["attempts"] += 1
                    try:
                        async with aclosing(
                            self.providers[target.protocol].stream(target, call)
                        ) as source:
                            async for chunk in source:
                                emitted = emitted or bool(chunk.text)
                                if chunk.usage:
                                    state.update(chunk.usage.model_dump())
                                if chunk.done:
                                    if not emitted:
                                        raise AIError("AI_INVALID_RESPONSE")
                                    state.update(status="SUCCEEDED", error_code=None)
                                    # Persist the success before emitting the terminal frame.
                                    await self._audit(sink, state, started)
                                    yield chunk
                                    return
                                yield chunk
                        raise AIError("AI_INCOMPLETE_RESPONSE")
                    except AIError as error:
                        if (
                            emitted
                            or not error.retryable
                            or attempt == call.retry_policy.max_retries
                        ):
                            raise
                        await asyncio.sleep(0.1 * 2**attempt)
        except TimeoutError:
            state.update(status="FAILED", error_code="AI_TIMEOUT")
            raise AIError("AI_TIMEOUT") from None
        except AIError as error:
            state.update(status="FAILED", error_code=error.code)
            raise
        except GeneratorExit, asyncio.CancelledError:
            raise
        except Exception:
            state.update(status="FAILED", error_code="AI_INVALID_RESPONSE")
            raise AIError("AI_INVALID_RESPONSE") from None
        finally:
            if state["status"] != "SUCCEEDED":
                await asyncio.shield(self._audit(sink, state, started))
