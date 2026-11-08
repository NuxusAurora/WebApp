import os

import pytest

from app.config import Settings

VALUES = {
    "DATABASE_URL": "postgresql+psycopg://test:private-password@invalid:5432/test",
    "REDIS_URL": "redis://invalid:6379/0",
    "CELERY_BROKER_URL": "redis://invalid:6379/1",
    "CELERY_RESULT_BACKEND": "redis://invalid:6379/2",
    "SECRET_KEY": "s" * 64,
    "ENCRYPTION_KEY": "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=",
    "STORAGE_ENDPOINT": "http://invalid:9000",
    "STORAGE_ACCESS_KEY": "test-access",
    "STORAGE_SECRET_KEY": "k" * 48,
}
for key, value in VALUES.items():
    os.environ[key] = value


@pytest.fixture
def configured():
    return Settings(**{key.lower(): value for key, value in VALUES.items()})


@pytest.fixture
def anyio_backend():
    return "asyncio"
