import asyncio
import logging

from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from ..config import settings

logger = logging.getLogger(__name__)


class DatabasePool:
    def __init__(self) -> None:
        self.engine: AsyncEngine | None = None
        self.session_factory: async_sessionmaker[AsyncSession] | None = None
        self._init_lock = asyncio.Lock()

    def _build_async_database_url(self) -> str:
        url = make_url(settings.database_url)
        if "+" not in url.drivername:
            if url.drivername == "postgresql":
                url = url.set(drivername="postgresql+asyncpg")
            elif url.drivername == "sqlite":
                url = url.set(drivername="sqlite+aiosqlite")
        return url.render_as_string(hide_password=False)

    async def initialize(self) -> None:
        """Initialize the shared async engine once."""
        if self.session_factory is not None:
            return

        async with self._init_lock:
            if self.session_factory is not None:
                return

            database_url = self._build_async_database_url()
            engine_kwargs = {
                "echo": False,
            }
            if database_url.startswith("postgresql+"):
                engine_kwargs.update(
                    {
                        "pool_size": settings.database_pool_size,
                        "max_overflow": settings.database_max_overflow,
                        "pool_pre_ping": True,
                        "pool_recycle": settings.database_pool_recycle,
                    }
                )
            self.engine = create_async_engine(database_url, **engine_kwargs)
            self.session_factory = async_sessionmaker(
                bind=self.engine,
                class_=AsyncSession,
                expire_on_commit=False,
            )
            logger.info("Database connection pool initialized")

    async def close(self) -> None:
        if self.engine is not None:
            await self.engine.dispose()
        self.engine = None
        self.session_factory = None

    def get_session(self) -> AsyncSession:
        if self.session_factory is None:
            raise RuntimeError("Database pool not initialized")
        return self.session_factory()


db_pool = DatabasePool()


async def get_db_session():
    await db_pool.initialize()
    async with db_pool.get_session() as session:
        yield session
