import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.errors import AppError, app_error_handler, unhandled_exception_handler


pytestmark = pytest.mark.asyncio


async def test_unhandled_exception_handler_returns_safe_500_payload():
    test_app = FastAPI()
    test_app.add_exception_handler(AppError, app_error_handler)
    test_app.add_exception_handler(Exception, unhandled_exception_handler)

    @test_app.get("/boom")
    async def boom():
        raise RuntimeError("unexpected failure")

    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/boom")

    assert response.status_code == 500
    assert response.json() == {
        "detail": "An unexpected error occurred.",
        "error_code": "internal_server_error",
    }
