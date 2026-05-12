import pytest
from sqlalchemy import text

from conftest import make_user
from app.core.database_pool import DatabasePool

pytestmark = pytest.mark.asyncio


async def test_database_pool_preserves_password_in_async_url():
    pool = DatabasePool()
    async_url = pool._build_async_database_url()

    assert "***" not in async_url
    assert async_url.startswith("postgresql+asyncpg://postgres:postgres@")


async def test_dashboard_summary_uses_property_timezone_for_march_revenue(client):
    test_client, auth_context, _fake_redis, _session_factory = client
    auth_context["user"] = make_user("tenant-a")

    response = await test_client.get("/api/v1/dashboard/summary?property_id=prop-001&month=3&year=2024")

    assert response.status_code == 200
    payload = response.json()
    assert payload["total_revenue"] == "2250.000"
    assert payload["reservations_count"] == 4
    assert payload["reporting_month"] == 3
    assert payload["reporting_year"] == 2024


async def test_dashboard_cache_is_tenant_isolated_for_duplicate_property_ids(client):
    test_client, auth_context, fake_redis, _session_factory = client

    auth_context["user"] = make_user("tenant-a")
    first_response = await test_client.get("/api/v1/dashboard/summary?property_id=prop-001&month=3&year=2024")
    assert first_response.status_code == 200
    assert first_response.json()["total_revenue"] == "2250.000"

    auth_context["user"] = make_user("tenant-b")
    second_response = await test_client.get("/api/v1/dashboard/summary?property_id=prop-001&month=3&year=2024")

    assert second_response.status_code == 200
    assert second_response.json()["total_revenue"] == "0.000"
    assert "revenue:tenant-a:prop-001:2024-03" in fake_redis.store
    assert "revenue:tenant-b:prop-001:2024-03" in fake_redis.store


async def test_dashboard_summary_returns_exact_string_amount(client):
    test_client, auth_context, _fake_redis, _session_factory = client
    auth_context["user"] = make_user("tenant-a")

    response = await test_client.get("/api/v1/dashboard/summary?property_id=prop-001&month=3&year=2024")

    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload["total_revenue"], str)
    assert payload["total_revenue"] == "2250.000"


async def test_cross_tenant_property_access_returns_not_found(client):
    test_client, auth_context, _fake_redis, _session_factory = client
    auth_context["user"] = make_user("tenant-b")

    response = await test_client.get("/api/v1/dashboard/summary?property_id=prop-002&month=3&year=2024")

    assert response.status_code == 404
    assert response.json()["error_code"] == "property_not_found"


async def test_dashboard_defaults_to_latest_month_with_data(client):
    test_client, auth_context, _fake_redis, _session_factory = client
    auth_context["user"] = make_user("tenant-a")

    response = await test_client.get("/api/v1/dashboard/summary?property_id=prop-001")

    assert response.status_code == 200
    payload = response.json()
    assert payload["reporting_month"] == 3
    assert payload["reporting_year"] == 2024
    assert payload["total_revenue"] == "2250.000"


async def test_dashboard_properties_are_tenant_scoped(client):
    test_client, auth_context, _fake_redis, _session_factory = client
    auth_context["user"] = make_user("tenant-b")

    response = await test_client.get("/api/v1/dashboard/properties")

    assert response.status_code == 200
    assert response.json() == [
        {"id": "prop-004", "name": "Lakeside Cottage"},
        {"id": "prop-001", "name": "Mountain Lodge Beta"},
        {"id": "prop-005", "name": "Urban Loft Modern"},
    ]


async def test_dashboard_rejects_mixed_currency_summaries(client):
    test_client, auth_context, _fake_redis, session_factory = client
    auth_context["user"] = make_user("tenant-a")

    async with session_factory() as session:
        await session.execute(
            text(
                """
                INSERT INTO reservations (
                    id, property_id, tenant_id, check_in_date, check_out_date, total_amount, currency
                ) VALUES (
                    'res-eur-1', 'prop-001', 'tenant-a',
                    '2024-03-21T10:00:00+00:00', '2024-03-24T10:00:00+00:00', '99.999', 'EUR'
                )
                """
            )
        )
        await session.commit()

    response = await test_client.get("/api/v1/dashboard/summary?property_id=prop-001&month=3&year=2024")

    assert response.status_code == 409
    assert response.json()["error_code"] == "mixed_currency_revenue"


async def test_dashboard_requires_month_and_year_together(client):
    test_client, auth_context, _fake_redis, _session_factory = client
    auth_context["user"] = make_user("tenant-a")

    response = await test_client.get("/api/v1/dashboard/summary?property_id=prop-001&month=3")

    assert response.status_code == 400
    assert response.json()["error_code"] == "invalid_reporting_period"
