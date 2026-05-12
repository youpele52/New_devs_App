import pytest

from app.core.database_pool import DatabasePool


pytestmark = pytest.mark.asyncio


async def test_build_async_database_url_preserves_real_password():
    pool = DatabasePool()

    async_url = pool._build_async_database_url()

    assert "***" not in async_url
    assert async_url.startswith("postgresql+asyncpg://postgres:postgres@")
