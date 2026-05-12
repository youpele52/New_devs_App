import logging
from datetime import datetime
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import text

from app.core.database_pool import db_pool
from app.core.errors import AppError


def _coerce_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    raise AppError(
        status_code=500,
        public_message="Revenue data is temporarily unavailable.",
        log_message=f"Unsupported datetime value returned from database: {value!r}",
        error_code="invalid_datetime_value",
    )


def _format_decimal(value: Decimal) -> str:
    return format(value.quantize(Decimal("0.001")), "f")


def _normalize_period(month: int | None, year: int | None) -> tuple[int | None, int | None]:
    if (month is None) != (year is None):
        raise AppError(
            status_code=400,
            public_message="Both month and year are required together.",
            log_message=f"Invalid reporting period supplied: month={month}, year={year}",
            error_code="invalid_reporting_period",
            log_level=logging.WARNING,
        )

    if month is not None and not 1 <= month <= 12:
        raise AppError(
            status_code=400,
            public_message="Month must be between 1 and 12.",
            log_message=f"Invalid month supplied: {month}",
            error_code="invalid_month",
            log_level=logging.WARNING,
        )

    return month, year


async def list_tenant_properties(tenant_id: str) -> list[dict[str, str]]:
    await db_pool.initialize()
    try:
        async with db_pool.get_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, name
                    FROM properties
                    WHERE tenant_id = :tenant_id
                    ORDER BY name ASC
                    """
                ),
                {"tenant_id": tenant_id},
            )
            return [{"id": row.id, "name": row.name} for row in result.fetchall()]
    except Exception as exc:
        raise AppError(
            status_code=500,
            public_message="Property data is temporarily unavailable.",
            log_message=f"Property list query failed for tenant={tenant_id}: {exc}",
            error_code="property_query_failed",
        ) from exc


async def calculate_monthly_revenue(
    property_id: str,
    tenant_id: str,
    month: int,
    year: int,
) -> Decimal:
    revenue_data = await calculate_revenue_summary(
        property_id=property_id,
        tenant_id=tenant_id,
        month=month,
        year=year,
    )
    return Decimal(revenue_data["total"])


async def calculate_revenue_summary(
    property_id: str,
    tenant_id: str,
    month: int | None = None,
    year: int | None = None,
) -> dict[str, Any]:
    month, year = _normalize_period(month, year)

    await db_pool.initialize()

    try:
        async with db_pool.get_session() as session:
            property_result = await session.execute(
                text(
                    """
                    SELECT id, name, timezone
                    FROM properties
                    WHERE id = :property_id AND tenant_id = :tenant_id
                    """
                ),
                {"property_id": property_id, "tenant_id": tenant_id},
            )
            property_row = property_result.fetchone()

            if property_row is None:
                raise AppError(
                    status_code=404,
                    public_message="Property not found.",
                    log_message=f"Tenant {tenant_id} attempted to access unknown property {property_id}",
                    error_code="property_not_found",
                    log_level=logging.WARNING,
                )

            property_timezone = ZoneInfo(property_row.timezone)

            reservations_result = await session.execute(
                text(
                    """
                    SELECT check_in_date, total_amount, currency
                    FROM reservations
                    WHERE property_id = :property_id AND tenant_id = :tenant_id
                    ORDER BY check_in_date ASC
                    """
                ),
                {"property_id": property_id, "tenant_id": tenant_id},
            )
            reservations = reservations_result.fetchall()

    except AppError:
        raise
    except Exception as exc:
        raise AppError(
            status_code=500,
            public_message="Revenue data is temporarily unavailable.",
            log_message=f"Revenue query failed for tenant={tenant_id} property={property_id}: {exc}",
            error_code="revenue_query_failed",
        ) from exc

    local_reservations: list[tuple[datetime, Decimal, str]] = []
    currencies: set[str] = set()

    for reservation in reservations:
        local_check_in = _coerce_datetime(reservation.check_in_date).astimezone(property_timezone)
        total_amount = Decimal(str(reservation.total_amount))
        currency = reservation.currency or "USD"
        local_reservations.append((local_check_in, total_amount, currency))
        currencies.add(currency)

    if len(currencies) > 1:
        raise AppError(
            status_code=409,
            public_message="Revenue data contains multiple currencies and cannot be summarized safely.",
            log_message=f"Mixed currencies for tenant={tenant_id} property={property_id}: {sorted(currencies)}",
            error_code="mixed_currency_revenue",
        )

    if month is None or year is None:
        if local_reservations:
            latest_check_in = max(item[0] for item in local_reservations)
            month = latest_check_in.month
            year = latest_check_in.year
        else:
            now = datetime.now(property_timezone)
            month = now.month
            year = now.year

    total_revenue = Decimal("0.000")
    reservation_count = 0

    for local_check_in, total_amount, _currency in local_reservations:
        if local_check_in.month == month and local_check_in.year == year:
            total_revenue += total_amount
            reservation_count += 1

    return {
        "property_id": property_row.id,
        "property_name": property_row.name,
        "tenant_id": tenant_id,
        "total": _format_decimal(total_revenue),
        "currency": next(iter(currencies), "USD"),
        "count": reservation_count,
        "reporting_month": month,
        "reporting_year": year,
    }
