import pytest

from app.services.cache import get_revenue_summary


pytestmark = pytest.mark.asyncio


async def test_revenue_cache_is_isolated_for_duplicate_property_ids_across_tenants(
    db_session_factory,
    fake_redis,
):
    tenant_a_result = await get_revenue_summary("prop-001", "tenant-a", month=3, year=2024)
    tenant_b_result = await get_revenue_summary("prop-001", "tenant-b", month=3, year=2024)

    assert tenant_a_result["total"] == "2250.000"
    assert tenant_b_result["total"] == "0.000"
    assert "revenue:tenant-a:prop-001:2024-03" in fake_redis.store
    assert "revenue:tenant-b:prop-001:2024-03" in fake_redis.store
