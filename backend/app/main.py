import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.config import Settings
from app.database import Resources

logger = logging.getLogger("structured_learning.requests")
logger.setLevel(logging.INFO)
if not logger.handlers:
    logger.addHandler(logging.StreamHandler())


def create_app(settings: Settings | None = None, resources_factory=Resources) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        configured = settings or Settings()
        resources = resources_factory(configured)
        app.state.resources = resources
        app.state.settings = configured
        try:
            yield
        finally:
            await resources.close()

    app = FastAPI(title="Structured Learning API", version="0.1.0", lifespan=lifespan)

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request_id = str(uuid4())
        started = time.monotonic()
        try:
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
