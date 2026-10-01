"""Authenticated merchant setup and verified QR Ph checkout endpoints."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field, field_validator

from touchorders_core.api.auth import IdentityError, VerifiedIdentity
from touchorders_core.api.routes.ai import get_verifier
from touchorders_core.api.routes.orders import OrderItem

router = APIRouter(prefix="/api/payments", tags=["payments"])


class QrCheckoutRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    companyId: str
    branchId: str
    orderId: UUID
    customerName: str = Field(min_length=1, max_length=80)
    expectedTotal: float = Field(ge=0, le=1000000, allow_inf_nan=False)
    items: list[OrderItem] = Field(min_length=1, max_length=99)

    @field_validator("customerName")
    @classmethod
    def customer_name_is_trimmed(cls, value: str) -> str:
        if value != value.strip():
            raise ValueError("Customer name must be trimmed")
        return value


class MerchantOnboardingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    companyId: str
    branchId: str
    email: str = Field(min_length=3, max_length=160, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class RefundRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    companyId: str
    branchId: str
    orderId: UUID
    reason: str = Field(default="requested_by_customer", pattern=r"^(requested_by_customer|duplicate|fraudulent|others)$")


def require_identity(authorization: str | None = Header(default=None), verifier=Depends(get_verifier)) -> VerifiedIdentity:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Sign-in required")
    try:
        return verifier.verify(authorization.removeprefix("Bearer ").strip())
    except IdentityError as exc:
        raise HTTPException(401, "Invalid or expired session") from exc


def get_payment_service(request: Request):
    service = getattr(request.app.state, "payment_service", None)
    if service is None:
        raise HTTPException(503, "Payment service is unavailable")
    return service


@router.get("/merchant/status")
async def merchant_status(companyId: str = Query(), branchId: str = Query(),
                          identity: VerifiedIdentity = Depends(require_identity),
                          service=Depends(get_payment_service)) -> dict:
    return await run_in_threadpool(service.merchant_status, uid=identity.uid, company=companyId, branch=branchId)


@router.post("/merchant/onboarding")
async def merchant_onboarding(body: MerchantOnboardingRequest,
                              identity: VerifiedIdentity = Depends(require_identity),
                              service=Depends(get_payment_service)) -> dict:
    return await run_in_threadpool(service.request_merchant_onboarding, uid=identity.uid,
                                   company=body.companyId, branch=body.branchId, email=str(body.email))


@router.post("/qrph/checkouts")
async def start_checkout(body: QrCheckoutRequest, identity: VerifiedIdentity = Depends(require_identity),
                         service=Depends(get_payment_service)) -> dict:
    try:
        return await run_in_threadpool(service.start_checkout, uid=identity.uid, body=body)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(503, "QR Ph checkout is temporarily unavailable; use pay at counter") from exc


@router.get("/qrph/checkouts/{order_id}")
async def checkout_status(order_id: UUID, companyId: str = Query(), branchId: str = Query(),
                          identity: VerifiedIdentity = Depends(require_identity),
                          service=Depends(get_payment_service)) -> dict:
    try:
        return await run_in_threadpool(service.checkout_status, uid=identity.uid, company=companyId,
                                       branch=branchId, order_id=str(order_id))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(503, "Unable to verify payment; the order remains pending") from exc


@router.post("/qrph/checkouts/{order_id}/cancel")
async def cancel_checkout(order_id: UUID, companyId: str = Query(), branchId: str = Query(),
                          identity: VerifiedIdentity = Depends(require_identity),
                          service=Depends(get_payment_service)) -> dict:
    return await run_in_threadpool(service.cancel_checkout, uid=identity.uid, company=companyId,
                                   branch=branchId, order_id=str(order_id))


@router.post("/refunds")
async def refund_order(body: RefundRequest, identity: VerifiedIdentity = Depends(require_identity),
                       service=Depends(get_payment_service)) -> dict:
    try:
        return await run_in_threadpool(service.refund_order, uid=identity.uid, company=body.companyId,
                                       branch=body.branchId, order_id=str(body.orderId), reason=body.reason)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(503, "Refund could not be submitted; check PayMongo before retrying") from exc


@router.post("/paymongo/webhook/{connection_id}")
async def paymongo_webhook(connection_id: str, request: Request,
                           paymongo_signature: str | None = Header(default=None, alias="Paymongo-Signature"),
                           service=Depends(get_payment_service)) -> dict:
    if not paymongo_signature:
        raise HTTPException(401, "Missing webhook signature")
    raw_body = await request.body()
    await run_in_threadpool(service.handle_webhook, connection_id=connection_id,
                            raw_body=raw_body, signature=paymongo_signature)
    return {"received": True}
