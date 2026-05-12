import sys
from pathlib import Path
from typing import Optional

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.auth import authenticate_request
from app.core.database_pool import db_pool
from app.main import app
from app.models.auth import AuthenticatedUser
from app.services import cache as revenue_cache


class FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    async def get(self, key: str):
        return self.store.get(key)

    async def setex(self, key: str, ttl: int, value: str):
        self.store[key] = value


def _make_user(tenant_id: Optional[str]) -> AuthenticatedUser:
    suffix = tenant_id or "no-tenant"
    return AuthenticatedUser(
        id=f"user-{suffix}",
        email=f"{suffix}@example.com",
        permissions=[],
        cities=[],
        is_admin=False,
        tenant_id=tenant_id,
    )


async def seed_dashboard_data(connection) -> None:
    await connection.execute(
        text(
            """
            CREATE TABLE properties (
                id TEXT NOT NULL,
                tenant_id TEXT NOT NULL,
                name TEXT NOT NULL,
                timezone TEXT NOT NULL,
                PRIMARY KEY (id, tenant_id)
            )
            """
        )
    )
    await connection.execute(
        text(
            """
            CREATE TABLE reservations (
                id TEXT PRIMARY KEY,
                property_id TEXT NOT NULL,
                tenant_id TEXT NOT NULL,
                check_in_date TEXT NOT NULL,
                check_out_date TEXT NOT NULL,
                total_amount TEXT NOT NULL,
                currency TEXT DEFAULT 'USD'
            )
            """
        )
    )

    for statement in (
        "INSERT INTO properties (id, tenant_id, name, timezone) VALUES ('prop-001', 'tenant-a', 'Beach House Alpha', 'Europe/Paris')",
        "INSERT INTO properties (id, tenant_id, name, timezone) VALUES ('prop-001', 'tenant-b', 'Mountain Lodge Beta', 'America/New_York')",
        "INSERT INTO properties (id, tenant_id, name, timezone) VALUES ('prop-002', 'tenant-a', 'City Apartment Downtown', 'Europe/Paris')",
        "INSERT INTO properties (id, tenant_id, name, timezone) VALUES ('prop-003', 'tenant-a', 'Country Villa Estate', 'Europe/Paris')",
        "INSERT INTO properties (id, tenant_id, name, timezone) VALUES ('prop-004', 'tenant-b', 'Lakeside Cottage', 'America/New_York')",
        "INSERT INTO properties (id, tenant_id, name, timezone) VALUES ('prop-005', 'tenant-b', 'Urban Loft Modern', 'America/New_York')",
        "INSERT INTO reservations (id, property_id, tenant_id, check_in_date, check_out_date, total_amount, currency) VALUES ('res-tz-1', 'prop-001', 'tenant-a', '2024-02-29T23:30:00+00:00', '2024-03-05T10:00:00+00:00', '1250.000', 'USD')",
        "INSERT INTO reservations (id, property_id, tenant_id, check_in_date, check_out_date, total_amount, currency) VALUES ('res-dec-1', 'prop-001', 'tenant-a', '2024-03-15T10:00:00+00:00', '2024-03-18T10:00:00+00:00', '333.333', 'USD')",
        "INSERT INTO reservations (id, property_id, tenant_id, check_in_date, check_out_date, total_amount, currency) VALUES ('res-dec-2', 'prop-001', 'tenant-a', '2024-03-16T10:00:00+00:00', '2024-03-19T10:00:00+00:00', '333.333', 'USD')",
        "INSERT INTO reservations (id, property_id, tenant_id, check_in_date, check_out_date, total_amount, currency) VALUES ('res-dec-3', 'prop-001', 'tenant-a', '2024-03-17T10:00:00+00:00', '2024-03-20T10:00:00+00:00', '333.334', 'USD')",
        "INSERT INTO reservations (id, property_id, tenant_id, check_in_date, check_out_date, total_amount, currency) VALUES ('res-004', 'prop-002', 'tenant-a', '2024-03-05T14:00:00+00:00', '2024-03-08T11:00:00+00:00', '1250.00', 'USD')",
        "INSERT INTO reservations (id, property_id, tenant_id, check_in_date, check_out_date, total_amount, currency) VALUES ('res-005', 'prop-002', 'tenant-a', '2024-03-12T16:00:00+00:00', '2024-03-15T10:00:00+00:00', '1475.50', 'USD')",
        "INSERT INTO reservations (id, property_id, tenant_id, check_in_date, check_out_date, total_amount, currency) VALUES ('res-006', 'prop-002', 'tenant-a', '2024-03-20T15:00:00+00:00', '2024-03-23T12:00:00+00:00', '1199.25', 'USD')",
        "INSERT INTO reservations (id, property_id, tenant_id, check_in_date, check_out_date, total_amount, currency) VALUES ('res-007', 'prop-002', 'tenant-a', '2024-03-25T18:00:00+00:00', '2024-03-28T14:00:00+00:00', '1050.75', 'USD')",
        "INSERT INTO reservations (id, property_id, tenant_id, check_in_date, check_out_date, total_amount, currency) VALUES ('res-008', 'prop-003', 'tenant-a', '2024-03-02T15:00:00+00:00', '2024-03-09T12:00:00+00:00', '2850.00', 'USD')",
        "INSERT INTO reservations (id, property_id, tenant_id, check_in_date, check_out_date, total_amount, currency) VALUES ('res-009', 'prop-003', 'tenant-a', '2024-03-18T16:00:00+00:00', '2024-03-25T11:00:00+00:00', '3250.50', 'USD')",
        "INSERT INTO reservations (id, property_id, tenant_id, check_in_date, check_out_date, total_amount, currency) VALUES ('res-010', 'prop-004', 'tenant-b', '2024-03-08T18:00:00+00:00', '2024-03-11T15:00:00+00:00', '420.00', 'USD')",
        "INSERT INTO reservations (id, property_id, tenant_id, check_in_date, check_out_date, total_amount, currency) VALUES ('res-011', 'prop-004', 'tenant-b', '2024-03-14T17:00:00+00:00', '2024-03-18T14:00:00+00:00', '560.75', 'USD')",
        "INSERT INTO reservations (id, property_id, tenant_id, check_in_date, check_out_date, total_amount, currency) VALUES ('res-012', 'prop-004', 'tenant-b', '2024-03-22T16:00:00+00:00', '2024-03-26T13:00:00+00:00', '480.25', 'USD')",
        "INSERT INTO reservations (id, property_id, tenant_id, check_in_date, check_out_date, total_amount, currency) VALUES ('res-013', 'prop-004', 'tenant-b', '2024-03-28T19:00:00+00:00', '2024-03-31T15:00:00+00:00', '315.50', 'USD')",
        "INSERT INTO reservations (id, property_id, tenant_id, check_in_date, check_out_date, total_amount, currency) VALUES ('res-014', 'prop-005', 'tenant-b', '2024-03-06T19:00:00+00:00', '2024-03-10T16:00:00+00:00', '920.00', 'USD')",
        "INSERT INTO reservations (id, property_id, tenant_id, check_in_date, check_out_date, total_amount, currency) VALUES ('res-015', 'prop-005', 'tenant-b', '2024-03-15T18:00:00+00:00', '2024-03-19T17:00:00+00:00', '1080.40', 'USD')",
        "INSERT INTO reservations (id, property_id, tenant_id, check_in_date, check_out_date, total_amount, currency) VALUES ('res-016', 'prop-005', 'tenant-b', '2024-03-24T20:00:00+00:00', '2024-03-29T14:00:00+00:00', '1255.60', 'USD')",
    ):
        await connection.execute(text(statement))


@pytest.fixture
def user_factory():
    return _make_user


@pytest.fixture
def auth_context(user_factory):
    state = {"user": user_factory("tenant-a")}

    async def override_auth():
        return state["user"]

    app.dependency_overrides[authenticate_request] = override_auth
    yield state
    app.dependency_overrides.clear()


@pytest.fixture
def fake_redis(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(revenue_cache, "redis_client", fake)
    return fake


@pytest_asyncio.fixture
async def db_session_factory(tmp_path):
    db_path = tmp_path / "dashboard-test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await seed_dashboard_data(conn)

    original_engine = db_pool.engine
    original_session_factory = db_pool.session_factory
    db_pool.engine = engine
    db_pool.session_factory = session_factory

    yield session_factory

    db_pool.engine = original_engine
    db_pool.session_factory = original_session_factory
    await engine.dispose()


@pytest_asyncio.fixture
async def api_client(db_session_factory, auth_context, fake_redis):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client
