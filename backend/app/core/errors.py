import logging
from typing import Any, Mapping

from fastapi import Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


class AppError(Exception):
    """Application error with separate public and internal messages."""

    def __init__(
        self,
        *,
        status_code: int,
        public_message: str,
        log_message: str | None = None,
        error_code: str = "application_error",
        log_level: int = logging.ERROR,
        details: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
        expose_details: bool = False,
    ) -> None:
        super().__init__(public_message)
        self.status_code = status_code
        self.public_message = public_message
        self.log_message = log_message or public_message
        self.error_code = error_code
        self.log_level = log_level
        self.details = dict(details or {})
        self.headers = dict(headers or {})
        self.expose_details = expose_details


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    logger.log(
        exc.log_level,
        "%s | path=%s method=%s status=%s code=%s details=%s",
        exc.log_message,
        request.url.path,
        request.method,
        exc.status_code,
        exc.error_code,
        exc.details or "{}",
    )

    payload: dict[str, Any] = {
        "detail": exc.public_message,
        "error_code": exc.error_code,
    }

    if exc.expose_details and exc.details:
        payload["details"] = exc.details

    return JSONResponse(
        status_code=exc.status_code,
        content=payload,
        headers=exc.headers,
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception(
        "Unhandled application error | path=%s method=%s error=%s",
        request.url.path,
        request.method,
        type(exc).__name__,
    )
    return JSONResponse(
        status_code=500,
        content={
            "detail": "An unexpected error occurred.",
            "error_code": "internal_server_error",
        },
    )
