import asyncio
import logging

from fastapi.testclient import TestClient

from app.main import create_app


class ControlledResources:
    def __init__(self, settings):
        self.database_behavior = "ok"
        self.redis_behavior = "ok"
        self.calls = 0
        self.cancelled = False
        self.closed = False

    async def check(self, behavior):
        self.calls += 1
        if behavior == "failure":
            raise RuntimeError("private-password must never enter API responses or logs")
        if behavior == "timeout":
            try:
                await asyncio.sleep(60)
            finally:
                self.cancelled = True

    async def database(self):
        await self.check(self.database_behavior)

    async def cache(self):
        await self.check(self.redis_behavior)

    async def close(self):
        self.closed = True


def test_health_never_calls_dependencies_and_lifespan_closes(configured):
    app = create_app(configured, ControlledResources)
    with TestClient(app) as client:
        resources = app.state.resources
        resources.database_behavior = resources.redis_behavior = "failure"
        response = client.get("/api/v1/health")
        assert response.status_code == 200
        assert response.json() == {"success": True, "data": {"status": "ok"}, "error": None}
        assert resources.calls == 0
        assert response.headers["cache-control"] == "no-store"
        assert len(response.headers["x-request-id"]) == 36
    assert resources.closed


def test_ready_success_and_failure_recovery(configured, caplog):
    app = create_app(configured, ControlledResources)
    with TestClient(app) as client, caplog.at_level(logging.INFO):
        response = client.get("/api/v1/ready")
        assert response.status_code == 200
        assert response.json()["data"] == {"status": "ready", "database": "ok", "redis": "ok"}
        app.state.resources.database_behavior = "failure"
        response = client.get("/api/v1/ready?token=private-password")
        assert response.status_code == 503
        assert response.json() == {
            "success": False,
            "data": None,
            "error": {
                "code": "DEPENDENCY_UNAVAILABLE",
                "message": "依赖服务暂不可用",
                "details": {"database": "unavailable", "redis": "ok"},
            },
        }
        assert "private-password" not in response.text
        # TestClient's own httpx logger includes request URLs; audit our application logger only.
        records = [
            record.message
            for record in caplog.records
            if record.name.startswith("structured_learning")
        ]
        assert records and all("private-password" not in record for record in records)
        app.state.resources.database_behavior = "ok"
        assert client.get("/api/v1/ready").status_code == 200


def test_ready_cancels_timed_out_probe(configured):
    configured.dependency_timeout = 0.05
    app = create_app(configured, ControlledResources)
    with TestClient(app) as client:
        app.state.resources.redis_behavior = "timeout"
        response = client.get("/api/v1/ready")
        assert response.status_code == 503
        assert response.json()["error"]["details"] == {"database": "ok", "redis": "timeout"}
        assert app.state.resources.cancelled


def test_unexpected_route_error_is_sanitized(configured):
    app = create_app(configured, ControlledResources)

    @app.get("/explode")
    async def explode():
        raise RuntimeError("private-password")

    with TestClient(app) as client:
        response = client.get("/explode")
        assert response.status_code == 500
        assert response.json()["error"]["code"] == "INTERNAL_ERROR"
        assert "private-password" not in response.text
