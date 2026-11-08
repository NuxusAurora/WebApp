from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from app.config import Settings
from app.database import Resources
from tests.conftest import VALUES


@pytest.mark.anyio
async def test_close_disposes_engine_even_if_redis_close_fails():
    resources = Resources.__new__(Resources)
    resources.redis = AsyncMock()
    resources.engine = AsyncMock()
    resources.redis.aclose.side_effect = RuntimeError("close failed")
    with pytest.raises(RuntimeError):
        await resources.close()
    resources.engine.dispose.assert_awaited_once()


@pytest.mark.anyio
async def test_session_is_closed_on_failure(configured):
    resources = Resources(configured)
    session = None
    try:
        with pytest.raises(RuntimeError):
            async with resources.session() as opened:
                session = opened
                raise RuntimeError("caller failed")
        assert session is not None and not session.in_transaction()
    finally:
        await resources.close()


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("database_url", "postgresql://bad:private-password@invalid/db"),
        ("redis_url", "http://invalid"),
        ("secret_key", "short"),
        ("encryption_key", "invalid-key"),
        ("storage_endpoint", "http://secret:private-password@invalid"),
    ],
)
def test_invalid_settings_rejected_without_printing_input(field, value):
    values = {key.lower(): item for key, item in VALUES.items()}
    values[field] = value
    with pytest.raises(ValidationError) as error:
        Settings(**values)
    assert "private-password" not in str(error.value)


def test_settings_repr_masks_credentials(configured):
    assert "private-password" not in repr(configured)
    assert "s" * 64 not in repr(configured)


@pytest.mark.parametrize("url", ["redis://invalid:abc/0", "redis://invalid:6379/not-a-db"])
def test_redis_configuration_fails_before_client_construction(url):
    values = {key.lower(): item for key, item in VALUES.items()}
    values["redis_url"] = url
    with pytest.raises(ValidationError):
        Settings(**values)


def test_smoke_task_has_no_business_side_effects(configured):
    from app.tasks import create_celery

    application = create_celery(configured)
    try:
        assert application.tasks["phase0.smoke"].run() == {"status": "ok"}
        assert application.conf.accept_content == ["json"]
        assert application.conf.result_expires == 300
    finally:
        application.close()
