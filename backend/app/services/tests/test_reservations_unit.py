import pytest

from app.core.errors import AppError
from app.services import reservations


pytestmark = pytest.mark.asyncio


class FailingSession:
    async def __aenter__(self):
        raise RuntimeError("database unavailable")

    async def __aexit__(self, exc_type, exc, tb):
        return False


async def _noop():
    return None


async def test_list_tenant_properties_raises_app_error_on_db_failure(monkeypatch):
    monkeypatch.setattr(reservations.db_pool, "initialize", _noop)
    monkeypatch.setattr(reservations.db_pool, "get_session", lambda: FailingSession())

    with pytest.raises(AppError) as error:
        await reservations.list_tenant_properties("tenant-a")

    assert error.value.error_code == "property_query_failed"


async def test_calculate_revenue_summary_raises_app_error_on_db_failure(monkeypatch):
    monkeypatch.setattr(reservations.db_pool, "initialize", _noop)
    monkeypatch.setattr(reservations.db_pool, "get_session", lambda: FailingSession())

    with pytest.raises(AppError) as error:
        await reservations.calculate_revenue_summary("prop-001", "tenant-a", month=3, year=2024)

    assert error.value.error_code == "revenue_query_failed"


async def test_calculate_revenue_summary_requires_month_and_year_together():
    with pytest.raises(AppError) as error:
        await reservations.calculate_revenue_summary("prop-001", "tenant-a", month=3)

    assert error.value.error_code == "invalid_reporting_period"


async def test_calculate_revenue_summary_rejects_invalid_month():
    with pytest.raises(AppError) as error:
        await reservations.calculate_revenue_summary("prop-001", "tenant-a", month=13, year=2024)

    assert error.value.error_code == "invalid_month"
