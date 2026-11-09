"""Checks executed only inside the owned acceptance backend container."""

import asyncio
import sys
import time
import urllib.request
from uuid import UUID

sys.path.insert(0, "/app")

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

import app.ai.models  # register AI metadata
import app.curriculum.models  # register curriculum metadata
from app.config import Settings
from app.models import Base


async def check(mode):
    engine = create_async_engine(Settings().database_url.get_secret_value())
    try:
        async with engine.begin() as connection:
            if mode == "metadata":
                diffs = await connection.run_sync(lambda c: compare_metadata(
                    MigrationContext.configure(c), Base.metadata))
                assert not diffs, str(diffs)
                print("metadata-ok")
            elif mode == "encrypted":
                value = await connection.scalar(text(
                    "SELECT encrypted_api_key FROM ai_providers LIMIT 1"))
                assert value.startswith("gAAAA")
                print("encrypted-ok")
            elif mode == "cleanup":
                await connection.execute(text("DELETE FROM users WHERE id IN (:a,:b)"),
                                         {"a": UUID(sys.argv[2]), "b": UUID(sys.argv[3])})
    finally:
        await engine.dispose()


if sys.argv[1] == "ready":
    for attempt in range(30):
        try:
            urllib.request.urlopen("http://127.0.0.1:1234", timeout=1).close()
            break
        except OSError:
            time.sleep(0.1)
    else:
        raise RuntimeError("fixture unavailable")
else:
    asyncio.run(check(sys.argv[1]))
