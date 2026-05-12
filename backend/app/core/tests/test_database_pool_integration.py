import pytest
from sqlalchemy import text

from app.config import settings
from app.core.database_pool import DatabasePool


pytestmark = pytest.mark.asyncio


async def test_initialize_creates_working_sqlite_session_factory(tmp_path, monkeypatch):
    sqlite_path = tmp_path / "pool-test.db"
    monkeypatch.setattr(settings, "database_url", f"sqlite:///{sqlite_path}")

    pool = DatabasePool()
    await pool.initialize()

    async with pool.get_session() as session:
        result = await session.execute(text("select 1"))
        assert result.scalar() == 1

    await pool.close()
