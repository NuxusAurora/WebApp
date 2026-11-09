import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from uuid import uuid4

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from app.ai.adapters import OpenAIProvider
from app.ai.gateway import Gateway
from app.ai.routes import router as ai_router
from app.auth import router as auth_router
from app.config import Settings
from app.courses import router as course_router
from app.curriculum.ocr import LocalOCR
from app.curriculum.routes import router as curriculum_router
from app.database import Resources
from app.errors import AppError
from app.mail import Mailer
from app.storage import ObjectStore

logger = logging.getLogger("structured_learning.requests")
logger.setLevel(logging.INFO)
if not logger.handlers:
    logger.addHandler(logging.StreamHandler())


def create_app(
    settings: Settings | None = None,
    resources_factory=Resources,
    mailer_factory=Mailer,
    store_factory=ObjectStore,
    ai_client_factory=None,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        configured = settings or Settings()
        resources = resources_factory(configured)
        app.state.resources = resources
        app.state.settings = configured
        app.state.store = None
        app.state.ai_client = None
        try:
            app.state.mailer = mailer_factory(configured)
            app.state.store = store_factory(configured)
            app.state.ai_client = (
                ai_client_factory()
                if ai_client_factory
                else httpx.AsyncClient(
                    follow_redirects=False,
                    trust_env=False,
                    limits=httpx.Limits(max_connections=20, max_keepalive_connections=5),
                )
            )
            app.state.ai_gateway = Gateway({"openai": OpenAIProvider(app.state.ai_client)})
            app.state.curriculum_ocr = LocalOCR()
            yield
        finally:
            try:
                if app.state.store is not None:
                    await run_in_threadpool(app.state.store.close)
            finally:
                try:
                    if app.state.ai_client is not None:
                        await app.state.ai_client.aclose()
                finally:
                    await resources.close()

    app = FastAPI(title="Structured Learning API", version="0.1.0", lifespan=lifespan)
    app.include_router(auth_router)
    app.include_router(course_router)
    app.include_router(ai_router)
    app.include_router(curriculum_router)

    @app.exception_handler(AppError)
    async def application_error(request, error):
        return JSONResponse(
            status_code=error.status_code,
            content={
                "success": False,
                "data": None,
                "error": {"code": error.code, "message": error.message, "details": {}},
            },
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        # Pydantic errors can contain submitted passwords/keys. Never serialize them.
        return JSONResponse(
            status_code=422,
            content={
                "success": False,
                "data": None,
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": "请检查输入格式及长度",
                    "details": {},
                },
            },
        )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request_id = str(uuid4())
        started = time.monotonic()
        try:
            if request.method in {"POST", "PUT", "PATCH", "DELETE"} and (
                request.headers.get("X-Requested-With") != "structured-learning"
                or (
                    request.headers.get("Origin")
                    and request.headers["Origin"] != request.app.state.settings.public_origin
                )
            ):
                response = JSONResponse(
                    status_code=403,
                    content={
                        "success": False,
                        "data": None,
                        "error": {
                            "code": "CSRF_REJECTED",
                            "message": "请求来源无效",
                            "details": {},
                        },
                    },
                )
            else:
                oversized = False
                if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
                    path = request.url.path
                    limit = (
                        5 * 1024 * 1024
                        if path.endswith("/curriculum/images")
                        else 512 * 1024
                        if "/curriculum" in path
                        else 1024 * 1024
                        if path.endswith("/uploads")
                        else 32768
                    )
                    data = bytearray()
                    async for chunk in request.stream():
                        data.extend(chunk)
                        if len(data) > limit:
                            oversized = True
                            break
                    if not oversized:
                        request._body = bytes(data)
                if oversized:
                    response = JSONResponse(
                        status_code=413,
                        content={
                            "success": False,
                            "data": None,
                            "error": {
                                "code": "REQUEST_TOO_LARGE",
                                "message": "请求内容过大",
                                "details": {},
                            },
                        },
                    )
                else:
                    response = await call_next(request)
        except Exception:
            # Do not log exception text, headers, bodies, query strings or connection URLs.
            response = JSONResponse(
                status_code=500,
                content={
                    "success": False,
                    "data": None,
                    "error": {
                        "code": "INTERNAL_ERROR",
                        "message": "服务暂不可用",
                        "details": {},
                    },
                },
            )
        response.headers["X-Request-ID"] = request_id
        response.headers["Cache-Control"] = "no-store"
        logger.info(
            json.dumps(
                {
                    "request_id": request_id,
                    "method": request.method,
                    "route": getattr(request.scope.get("route"), "path", "unmatched"),
                    "status": response.status_code,
                    "duration_ms": round((time.monotonic() - started) * 1000, 2),
                }
            )
        )
        return response

    @app.get("/api/v1/health")
    async def health():
        return {"success": True, "data": {"status": "ok"}, "error": None}

    @app.get("/api/v1/ready")
    async def ready(request: Request):
        resources = request.app.state.resources
        timeout = request.app.state.settings.dependency_timeout

        async def probe(check):
            try:
                await asyncio.wait_for(check(), timeout=timeout)
                return "ok"
            except TimeoutError:
                return "timeout"
            except Exception:
                return "unavailable"

        database, redis = await asyncio.gather(probe(resources.database), probe(resources.cache))
        statuses = {"database": database, "redis": redis}
        if database == redis == "ok":
            return {"success": True, "data": {"status": "ready", **statuses}, "error": None}
        return JSONResponse(
            status_code=503,
            content={
                "success": False,
                "data": None,
                "error": {
                    "code": "DEPENDENCY_UNAVAILABLE",
                    "message": "依赖服务暂不可用",
                    "details": statuses,
                },
            },
        )

    return app


app = create_app()
