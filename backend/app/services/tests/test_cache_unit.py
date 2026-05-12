import pytest

from app.services.cache import _get_revenue_cache_key


pytestmark = pytest.mark.asyncio


async def test_revenue_cache_key_is_tenant_and_period_scoped():
    cache_key = _get_revenue_cache_key("prop-001", "tenant-a", 3, 2024)

    assert cache_key == "revenue:tenant-a:prop-001:2024-03"
