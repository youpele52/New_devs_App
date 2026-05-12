import pytest
from sqlalchemy import text

from app.services.reservations import calculate_revenue_summary


pytestmark = pytest.mark.asyncio


async def test_calculate_revenue_summary_uses_property_local_timezone_for_march(db_session_factory):
    result = await calculate_revenue_summary("prop-001", "tenant-a", month=3, year=2024)

    assert result["total"] == "2250.000"
    assert result["count"] == 4


async def test_calculate_revenue_summary_defaults_to_latest_month_with_data(db_session_factory):
    result = await calculate_revenue_summary("prop-001", "tenant-a")

    assert result["reporting_month"] == 3
    assert result["reporting_year"] == 2024
    assert result["total"] == "2250.000"


async def test_calculate_revenue_summary_rejects_mixed_currencies(db_session_factory):
    async with db_session_factory() as session:
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

    with pytest.raises(Exception) as error:
        await calculate_revenue_summary("prop-001", "tenant-a", month=3, year=2024)

    assert getattr(error.value, "error_code", None) == "mixed_currency_revenue"
