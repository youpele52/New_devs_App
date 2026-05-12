from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.auth import authenticate_request as get_current_user
from app.core.errors import AppError
from app.models.auth import AuthenticatedUser
from app.services.cache import get_revenue_summary
from app.services.reservations import list_tenant_properties

router = APIRouter()


class DashboardProperty(BaseModel):
    id: str
    name: str


class DashboardSummaryResponse(BaseModel):
    property_id: str
    property_name: str
    total_revenue: str
    currency: str
    reservations_count: int
    reporting_month: int
    reporting_year: int


def _require_tenant_id(current_user: AuthenticatedUser) -> str:
    tenant_id = current_user.tenant_id
    if not tenant_id:
        raise AppError(
            status_code=401,
            public_message="Tenant context is missing. Please log in again.",
            log_message=f"User {current_user.email} is missing tenant context",
            error_code="missing_tenant_context",
        )
    return tenant_id


@router.get("/dashboard/properties", response_model=list[DashboardProperty])
async def get_dashboard_properties(
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> list[DashboardProperty]:
    tenant_id = _require_tenant_id(current_user)
    properties = await list_tenant_properties(tenant_id)
    return [DashboardProperty(**item) for item in properties]


@router.get("/dashboard/summary", response_model=DashboardSummaryResponse)
async def get_dashboard_summary(
    property_id: str,
    month: int | None = None,
    year: int | None = None,
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> DashboardSummaryResponse:
    tenant_id = _require_tenant_id(current_user)
    revenue_data = await get_revenue_summary(property_id, tenant_id, month=month, year=year)

    return DashboardSummaryResponse(
        property_id=revenue_data["property_id"],
        property_name=revenue_data["property_name"],
        total_revenue=revenue_data["total"],
        currency=revenue_data["currency"],
        reservations_count=revenue_data["count"],
        reporting_month=revenue_data["reporting_month"],
        reporting_year=revenue_data["reporting_year"],
    )
