import asyncio
import json
from uuid import uuid4

import httpx
import pytest

from app.ai.adapters import OpenAIProvider
from app.ai.contracts import AIError, RetryPolicy
from app.ai.gateway import Gateway
from tests.test_ai import KEY, SCHEMA, call, completion, target


def events(caplog, name="ai_call_diagnostics"):
    return [
        item
        for record in caplog.records
        if record.name == "structured_learning.requests"
        for item in [json.loads(record.message)]
        if item.get("event") == name
    ]


async def sink(state):
    pass


class PartialBody(httpx.AsyncByteStream):
    async def __aiter__(self):
        yield b'{"choices":'
        await asyncio.sleep(10)


@pytest.mark.anyio
@pytest.mark.parametrize("partial", [False, True])
async def test_deadline_logs_waiting_headers_or_partial_body(caplog, partial):
    caplog.set_level("INFO", logger="structured_learning.requests")
    context = {"request_id": str(uuid4()), "ai_call_id": str(uuid4())}

    async def handler(request):
        if partial:
            return httpx.Response(200, stream=PartialBody())
        await request.extensions["trace"]("http11.receive_response_headers.started", {})
        await asyncio.sleep(10)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(AIError, match="AI_TIMEOUT"):
            await Gateway({"openai": OpenAIProvider(client)}).execute(
                target(), call(timeout=0.05), sink, diagnostics=context
            )
    event = events(caplog)[-1]
    assert event["error_code"] == "AI_TIMEOUT" and event["timeout_source"] == "gateway_deadline"
    assert event["stage"] == ("read_response_body" if partial else "wait_response_headers")
    assert event["http_status"] == (200 if partial else None)
    assert event["response_bytes"] == (11 if partial else 0)
    assert event["wire_bytes"] == (11 if partial else 0)
    assert event["request_id"] == context["request_id"]
    assert event["ai_call_id"] == context["ai_call_id"]


@pytest.mark.anyio
@pytest.mark.parametrize("partial", [False, True])
async def test_real_httpcore_trace_reports_last_network_phase(caplog, partial):
    caplog.set_level("INFO", logger="structured_learning.requests")
    release = asyncio.Event()
    handlers = set()

    async def serve(reader, writer):
        handlers.add(asyncio.current_task())
        try:
            await reader.readuntil(b"\r\n\r\n")
            if partial:
                writer.write(b'HTTP/1.1 200 OK\r\nContent-Length: 1000\r\n\r\n{"choices":')
                await writer.drain()
            await release.wait()
        finally:
            writer.close()
            await writer.wait_closed()

    server = await asyncio.start_server(serve, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    try:
        async with httpx.AsyncClient(trust_env=False) as client:
            with pytest.raises(AIError, match="AI_TIMEOUT"):
                await Gateway({"openai": OpenAIProvider(client)}).execute(
                    target().model_copy(update={"base_url": f"http://127.0.0.1:{port}/v1"}),
                    call(timeout=0.2),
                    sink,
                )
    finally:
        release.set()
        server.close()
        await server.wait_closed()
        await asyncio.gather(*handlers)
    event = events(caplog)[-1]
    assert event["stage"] == ("read_response_body" if partial else "wait_response_headers")
    assert event["http_status"] == (200 if partial else None)
    assert event["response_bytes"] == (11 if partial else 0)
    assert {"connect", "send_request_body", "wait_response_headers"} <= event[
        "milestones_ms"
    ].keys()


@pytest.mark.anyio
@pytest.mark.parametrize(
    "kind,stage,code",
    [
        ("connect", "connect", "AI_TIMEOUT"),
        ("status", "check_http_status", "AI_AUTH_FAILED"),
        ("wire_json", "parse_response_json", "AI_INVALID_RESPONSE"),
        ("envelope", "extract_response", "AI_INVALID_RESPONSE"),
        ("output_json", "parse_output_json", "AI_SCHEMA_MISMATCH"),
        ("schema", "validate_output_schema", "AI_SCHEMA_MISMATCH"),
    ],
)
async def test_diagnostic_failure_stage_and_no_raw_secrets(caplog, kind, stage, code):
    caplog.set_level("INFO", logger="structured_learning.requests")

    async def handler(request):
        if kind == "connect":
            await request.extensions["trace"]("connection.connect_tcp.started", {"host": KEY})
            raise httpx.ConnectTimeout(KEY)
        if kind == "status":
            return httpx.Response(401, json={"error": {"message": KEY}}, headers={"X-Secret": KEY})
        if kind == "wire_json":
            return httpx.Response(200, content=("private-body-" + KEY).encode())
        if kind == "envelope":
            return httpx.Response(200, json={"private-field": KEY})
        return completion("private-body-" + KEY if kind == "output_json" else '{"ok":"bad"}')

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(AIError, match=code):
            await Gateway({"openai": OpenAIProvider(client)}).execute(
                target(), call(output_schema=SCHEMA, retry_policy=RetryPolicy(max_retries=0)), sink
            )
    event = events(caplog)[-1]
    assert event["stage"] == stage and event["error_code"] == code
    logged = json.dumps(events(caplog) + events(caplog, "ai_call_attempt"))
    for secret in [KEY, "private-question", "private-body", "localhost:1234", "X-Secret"]:
        assert secret not in logged


@pytest.mark.anyio
async def test_retry_records_failed_attempt_and_clears_failure_on_success(caplog):
    caplog.set_level("INFO", logger="structured_learning.requests")
    count = 0

    def handler(request):
        nonlocal count
        count += 1
        return completion('{"ok":"bad"}' if count == 1 else '{"ok":true}')

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        await Gateway({"openai": OpenAIProvider(client)}).execute(
            target(), call(output_schema=SCHEMA), sink
        )
    attempt = events(caplog, "ai_call_attempt")[0]
    assert attempt["attempt"] == 1 and attempt["stage"] == "validate_output_schema"
    result = events(caplog)[-1]
    assert result["outcome"] == "succeeded" and result["attempt"] == 2
    assert "exception_type" not in result and "error_code" not in result


@pytest.mark.anyio
async def test_audit_failure_has_own_stage(caplog):
    caplog.set_level("INFO", logger="structured_learning.requests")

    async def broken_sink(state):
        raise RuntimeError(KEY)

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: completion())
    ) as client:
        with pytest.raises(AIError, match="AI_AUDIT_UNAVAILABLE"):
            await Gateway({"openai": OpenAIProvider(client)}).execute(target(), call(), broken_sink)
    event = events(caplog)[-1]
    assert event["stage"] == "audit" and event["exception_type"] == "RuntimeError"
    assert KEY not in json.dumps(event)


@pytest.mark.anyio
async def test_deadline_during_retry_backoff_is_not_reported_as_network_wait(caplog):
    caplog.set_level("INFO", logger="structured_learning.requests")

    def handler(request):
        raise httpx.ConnectTimeout(KEY)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(AIError, match="AI_TIMEOUT"):
            await Gateway({"openai": OpenAIProvider(client)}).execute(
                target(), call(timeout=0.05), sink
            )
    assert events(caplog)[-1]["stage"] == "retry_backoff"


@pytest.mark.anyio
async def test_concurrent_calls_and_cancellation_do_not_leak_context(caplog):
    from app.ai.diagnostics import current_trace

    caplog.set_level("INFO", logger="structured_learning.requests")
    started = asyncio.Event()

    async def handler(request):
        if b"cancel-me" in request.content:
            started.set()
            await asyncio.sleep(10)
        return completion()

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        gateway = Gateway({"openai": OpenAIProvider(client)})
        from app.ai.contracts import Message

        cancelled = asyncio.create_task(
            gateway.execute(
                target(),
                call().model_copy(update={"messages": [Message(role="user", content="cancel-me")]}),
                sink,
            )
        )
        await started.wait()
        await gateway.execute(target(), call(), sink)
        cancelled.cancel()
        with pytest.raises(asyncio.CancelledError):
            await cancelled
    results = events(caplog)
    assert len({row["trace_id"] for row in results}) == 2
    assert {row["outcome"] for row in results} == {"succeeded", "cancelled"}
    assert current_trace() is None
