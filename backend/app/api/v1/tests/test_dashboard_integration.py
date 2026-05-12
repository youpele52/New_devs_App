import pytest

from app.api.v1 import dashboard
from app.core.errors import AppError


pytestmark = pytest.mark.asyncio


async def test_dashboard_properties_are_tenant_scoped(api_client, auth_context, user_factory):
    auth_context["user"] = user_factory("tenant-b")

    response = await api_client.get("/api/v1/dashboard/properties")

    assert response.status_code == 200
    assert response.json() == [
        {"id": "prop-004", "name": "Lakeside Cottage"},
        {"id": "prop-001", "name": "Mountain Lodge Beta"},
        {"id": "prop-005", "name": "Urban Loft Modern"},
    ]


async def test_dashboard_summary_rejects_cross_tenant_access(api_client, auth_context, user_factory):
    auth_context["user"] = user_factory("tenant-b")

    response = await api_client.get("/api/v1/dashboard/summary?property_id=prop-002&month=3&year=2024")

    assert response.status_code == 404
    assert response.json()["error_code"] == "property_not_found"


async def test_dashboard_properties_db_failures_return_structured_error(
    api_client,
    auth_context,
    user_factory,
    monkeypatch,
):
    auth_context["user"] = user_factory("tenant-a")

    async def broken_property_list(_tenant_id: str):
        raise AppError(
            status_code=500,
            public_message="Property data is temporarily unavailable.",
            log_message="forced property failure",
            error_code="property_query_failed",
        )

    monkeypatch.setattr(dashboard, "list_tenant_properties", broken_property_list)

    response = await api_client.get("/api/v1/dashboard/properties")

    assert response.status_code == 500
    assert response.json() == {
        "detail": "Property data is temporarily unavailable.",
        "error_code": "property_query_failed",
    }


async def test_dashboard_summary_db_failures_return_structured_error(
    api_client,
    auth_context,
    user_factory,
    monkeypatch,
):
    auth_context["user"] = user_factory("tenant-a")

    async def broken_summary(*_args, **_kwargs):
        raise AppError(
            status_code=500,
            public_message="Revenue data is temporarily unavailable.",
            log_message="forced summary failure",
            error_code="revenue_query_failed",
        )

    monkeypatch.setattr(dashboard, "get_revenue_summary", broken_summary)

    response = await api_client.get("/api/v1/dashboard/summary?property_id=prop-001&month=3&year=2024")

    assert response.status_code == 500
    assert response.json() == {
        "detail": "Revenue data is temporarily unavailable.",
        "error_code": "revenue_query_failed",
    }


async def test_dashboard_summary_returns_exact_string_amount(api_client, auth_context, user_factory):
    auth_context["user"] = user_factory("tenant-a")

    response = await api_client.get("/api/v1/dashboard/summary?property_id=prop-001&month=3&year=2024")

    assert response.status_code == 200
    assert response.json()["total_revenue"] == "2250.000"


async def test_dashboard_summary_returns_zero_for_empty_period(api_client, auth_context, user_factory):
    auth_context["user"] = user_factory("tenant-a")

    response = await api_client.get("/api/v1/dashboard/summary?property_id=prop-001&month=4&year=2024")

    assert response.status_code == 200
    assert response.json()["total_revenue"] == "0.000"
    assert response.json()["reservations_count"] == 0


async def test_dashboard_summary_requires_tenant_context(api_client, auth_context, user_factory):
    auth_context["user"] = user_factory(None)

    response = await api_client.get("/api/v1/dashboard/summary?property_id=prop-001&month=3&year=2024")

    assert response.status_code == 401
    assert response.json()["error_code"] == "missing_tenant_context"


async def test_dashboard_summary_returns_not_found_for_unknown_property(api_client, auth_context, user_factory):
    auth_context["user"] = user_factory("tenant-a")

    response = await api_client.get("/api/v1/dashboard/summary?property_id=prop-999&month=3&year=2024")

    assert response.status_code == 404
    assert response.json()["error_code"] == "property_not_found"
