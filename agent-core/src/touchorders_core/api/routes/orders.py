"""Authenticated Android order submission."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field, field_validator

from touchorders_core.api.auth import IdentityError, VerifiedIdentity
from touchorders_core.api.routes.ai import get_verifier

router = APIRouter(prefix="/api/orders", tags=["orders"])


class OrderItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    categoryId: str = Field(min_length=1, max_length=120)
    itemId: str = Field(min_length=1, max_length=120)
    size: str = Field(default="", max_length=40)
    quantity: int = Field(ge=1, le=99)
    expectedUnitPrice: float = Field(ge=0, le=1000000, allow_inf_nan=False)


class OrderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    companyId: str
    branchId: str
    orderId: UUID
    customerName: str = Field(min_length=1, max_length=80)
    paymentMethod: str
    expectedTotal: float = Field(ge=0, le=1000000, allow_inf_nan=False)
    items: list[OrderItem] = Field(min_length=1, max_length=99)

    @field_validator("customerName")
    @classmethod
    def customer_name_is_trimmed(cls, value: str) -> str:
        if value != value.strip():
            raise ValueError("Customer name must be trimmed")
        return value

    @field_validator("paymentMethod")
    @classmethod
    def known_payment_method(cls, value: str) -> str:
        if value not in ("QR_CODE", "COUNTER"):
            raise ValueError("Unknown payment method")
        return value


def require_device_identity(request: Request, authorization: str | None = Header(default=None),
                            verifier=Depends(get_verifier)) -> VerifiedIdentity:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Sign-in required")
    try:
        return verifier.verify(authorization.removeprefix("Bearer ").strip())
    except IdentityError as exc:
        raise HTTPException(401, "Invalid or expired session") from exc


def get_order_service(request: Request):
    service = getattr(request.app.state, "order_service", None)
    if service is None:
        raise HTTPException(503, "Order service is unavailable")
    return service


@router.post("")
async def submit_order(body: OrderRequest, identity: VerifiedIdentity = Depends(require_device_identity),
                       service=Depends(get_order_service)) -> dict:
    try:
        return await run_in_threadpool(service.submit, uid=identity.uid, body=body)
    except HTTPException:
        raise
    except Exception as exc:
        # Do not disclose database paths or credential errors to the device.
        raise HTTPException(503, "Order service temporarily unavailable; retry with the same order ID") from exc
