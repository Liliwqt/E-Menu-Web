"""Authenticated lifecycle APIs; scheduled processing is CLI-only."""
from __future__ import annotations

import time
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field

from touchorders_core.api.routes.orders import require_device_identity

router = APIRouter(prefix="/api/lifecycle", tags=["lifecycle"])


class Scope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    companyId: str = Field(pattern=r"^company-[a-z0-9-]+$", max_length=120)
    branchId: str | None = Field(default=None, pattern=r"^branch-[a-z0-9-]+$", max_length=120)


class Activity(Scope):
    kind: Literal["visit", "operation"] = "visit"


class Confirmation(Scope):
    confirm: Literal[True]


def service(request: Request):
    value = getattr(request.app.state, "lifecycle_service", None)
    if not value:
        raise HTTPException(503, "Lifecycle service unavailable")
    return value


def recent(identity):
    auth_time = getattr(identity, "auth_time", None)
    if not auth_time or not 0 <= time.time() - auth_time <= 300:
        raise HTTPException(401, "Reauthenticate to confirm this sensitive action")


@router.get("/status")
async def status(companyId: str, branchId: str, identity=Depends(require_device_identity), api=Depends(service)):
    return await run_in_threadpool(api.status, identity.uid, companyId, branchId)


@router.post("/activity")
async def activity(body: Activity, identity=Depends(require_device_identity), api=Depends(service)):
    if not body.branchId:
        raise HTTPException(400, "Branch required")
    return await run_in_threadpool(api.activity, identity.uid, body.companyId, body.branchId, body.kind)


@router.post("/cancel")
async def cancel(body: Confirmation, identity=Depends(require_device_identity), api=Depends(service)):
    recent(identity)
    if not body.branchId:
        raise HTTPException(400, "Branch required")
    return await run_in_threadpool(api.cancel, identity.uid, body.companyId, body.branchId)


@router.post("/close")
async def close(body: Confirmation, identity=Depends(require_device_identity), api=Depends(service)):
    recent(identity)
    return await run_in_threadpool(api.close, identity.uid, body.companyId, body.branchId)


@router.post("/recover")
async def recover(body: Confirmation, identity=Depends(require_device_identity), api=Depends(service)):
    recent(identity)
    return await run_in_threadpool(api.recover, identity.uid, body.companyId, body.branchId)


@router.post("/exports")
async def export(body: Scope, identity=Depends(require_device_identity), api=Depends(service)):
    return await run_in_threadpool(api.export, identity.uid, body.companyId, body.branchId)


@router.get("/exports/{export_id}")
async def download(export_id: str, identity=Depends(require_device_identity), api=Depends(service)):
    data = await run_in_threadpool(api.download, identity.uid, export_id)
    return Response(data, media_type="application/zip", headers={"Cache-Control": "no-store",
                    "Content-Disposition": 'attachment; filename="touch-business-export.zip"'})
