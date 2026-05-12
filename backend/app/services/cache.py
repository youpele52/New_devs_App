import json
import os
from typing import Any

import redis.asyncio as redis

from app.services.reservations import calculate_revenue_summary

redis_client = redis.Redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"))


def _get_revenue_cache_key(
    property_id: str,
    tenant_id: str,
    month: int | None,
    year: int | None,
) -> str:
    if month is None or year is None:
        return f"revenue:{tenant_id}:{property_id}:latest"
    return f"revenue:{tenant_id}:{property_id}:{year:04d}-{month:02d}"


async def get_revenue_summary(
    property_id: str,
    tenant_id: str,
    month: int | None = None,
    year: int | None = None,
) -> dict[str, Any]:
    cache_key = _get_revenue_cache_key(property_id, tenant_id, month, year)

    cached = await redis_client.get(cache_key)
    if cached:
        return json.loads(cached)

    result = await calculate_revenue_summary(
        property_id=property_id,
        tenant_id=tenant_id,
        month=month,
        year=year,
    )

    resolved_cache_key = _get_revenue_cache_key(
        property_id=property_id,
        tenant_id=tenant_id,
        month=result["reporting_month"],
        year=result["reporting_year"],
    )

    payload = json.dumps(result)
    await redis_client.setex(resolved_cache_key, 300, payload)
    if resolved_cache_key != cache_key:
        await redis_client.setex(cache_key, 300, payload)

    return result
