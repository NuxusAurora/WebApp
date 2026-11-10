"""Per-call progress only: never retain wire content, URLs, headers or exception text."""

import asyncio
import json
import logging
import time
from contextlib import contextmanager
from contextvars import ContextVar
from uuid import UUID, uuid4

logger = logging.getLogger("structured_learning.requests")
_current: ContextVar[CallTrace | None] = ContextVar("ai_call_trace", default=None)


def current_trace():
    return _current.get()


class CallTrace:
    def __init__(self, task_type, context):
        self.started = time.monotonic()
        self.identity = {"trace_id": str(uuid4()), "task_type": task_type}
        for name in ("request_id", "ai_call_id"):
            try:
                self.identity[name] = str(UUID((context or {})[name]))
            except KeyError, ValueError, TypeError, AttributeError:
                pass
        self.attempt = 0
        self.fields = {}
        self.begin_attempt(0)

    def elapsed(self):
        return round((time.monotonic() - self.started) * 1000, 2)

    def step(self, name):
        self.fields["stage"] = name
        self.fields["milestones_ms"].setdefault(name, self.elapsed())

    def begin_attempt(self, attempt):
        self.attempt = attempt
        self.fields = {
            "http_status": None,
            "response_bytes": 0,
            "wire_bytes": 0,
            "milestones_ms": {},
        }
        self.step("validate_call" if not attempt else "provider_call")

    def exception(self, error):
        self.fields.setdefault("exception_type", type(error).__name__)

    async def transport(self, event, info):
        # httpcore also supplies URLs, sockets and exceptions in info. Never inspect/log them.
        stages = {
            "connection.connect_tcp.started": "connect",
            "connection.start_tls.started": "tls",
        }
        for protocol in ("http11", "http2"):
            for operation, stage in (
                ("send_request_headers", "send_request_headers"),
                ("send_request_body", "send_request_body"),
                ("receive_response_headers", "wait_response_headers"),
                ("receive_response_body", "read_response_body"),
            ):
                stages[f"{protocol}.{operation}.started"] = stage
        if event in stages:
            self.fields["transport_event"] = event
            self.step(stages[event])

    def headers(self, response):
        self.fields["http_status"] = response.status_code
        self.fields["headers_received_ms"] = self.elapsed()
        content_type = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
        self.fields["response_type"] = (
            content_type
            if content_type in {"application/json", "text/event-stream", "text/html", "text/plain"}
            else "other"
        )

    def received(self, chunk):
        if chunk:
            self.fields.setdefault("first_body_byte_ms", self.elapsed())
        self.fields["response_bytes"] += len(chunk)

    def emit(self, event, outcome, error_code=None):
        record = {
            "event": event,
            **self.identity,
            **self.fields,
            "attempt": self.attempt,
            "outcome": outcome,
            "duration_ms": self.elapsed(),
        }
        if error_code:
            record["error_code"] = error_code
        logger.info(json.dumps(record))


@contextmanager
def call_trace(task_type, context=None):
    trace = CallTrace(task_type, context)
    token = _current.set(trace)
    try:
        yield trace
    except BaseException as error:
        trace.exception(error)
        trace.emit(
            "ai_call_diagnostics",
            "cancelled" if isinstance(error, asyncio.CancelledError) else "failed",
            getattr(
                error,
                "code",
                "AI_CANCELLED"
                if isinstance(error, asyncio.CancelledError)
                else "AI_INVALID_RESPONSE",
            ),
        )
        raise
    else:
        trace.step("complete")
        trace.emit("ai_call_diagnostics", "succeeded")
    finally:
        _current.reset(token)
