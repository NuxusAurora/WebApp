from contextlib import asynccontextmanager

from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import Settings


class Resources:
    """Web lifespan owns these clients; construction does not connect to dependencies."""

    def __init__(self, settings: Settings):
        self.engine = create_async_engine(
            settings.database_url.get_secret_value(),
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=0,
            pool_timeout=settings.dependency_timeout,
            connect_args={"connect_timeout": 2},
            hide_parameters=True,
        )
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        self.redis = Redis.from_url(
            settings.redis_url.get_secret_value(),
            socket_connect_timeout=settings.dependency_timeout,
            socket_timeout=settings.dependency_timeout,
            retry_on_timeout=False,
        )

    async def database(self) -> None:
        async with self.engine.connect() as connection:
            await connection.execute(text("SELECT 1"))

    async def cache(self) -> None:
        await self.redis.ping()

    @asynccontextmanager
    async def session(self):
        # Closing a session rolls back any uncommitted transaction, including on cancellation.
        async with self.sessions() as session:
            yield session

    async def close(self) -> None:
        try:
            await self.redis.aclose()
        finally:
            await self.engine.dispose()
