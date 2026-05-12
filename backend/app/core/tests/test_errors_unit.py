import logging

import pytest

from app.core.errors import AppError, app_error_handler


pytestmark = pytest.mark.asyncio


async def test_app_error_handler_returns_structured_payload():
    request = type(
        "RequestStub",
        (),
        {"url": type("URLStub", (), {"path": "/api/v1/dashboard/summary"})(), "method": "GET"},
    )()
    error = AppError(
        status_code=409,
        public_message="Safe public message",
        log_message="Detailed log message",
        error_code="conflict_error",
        log_level=logging.WARNING,
    )

    response = await app_error_handler(request, error)

    assert response.status_code == 409
    assert response.body == b'{"detail":"Safe public message","error_code":"conflict_error"}'
