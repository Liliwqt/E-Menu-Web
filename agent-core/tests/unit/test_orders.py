"""Trusted checkout's atomic order and stock contract."""
from __future__ import annotations

import copy
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from touchorders_core.api.app import create_app
from touchorders_core.api.auth import FakeIdentityVerifier, VerifiedIdentity
from touchorders_core.api.orders import FirebaseOrderService
from touchorders_core.api.routes.orders import OrderRequest

COMPANY = "company-checkout"
BRANCH = "branch-checkout"
UID = "device-one"


class MemoryReference:
    def __init__(self, database, path):
        self.database, self.path = database, path

    def get(self):
        value = self.database.data
        for segment in self.path.split("/"):
            if not segment:
                continue
            value = value.get(segment) if isinstance(value, dict) else None
            if value is None:
                return None
        return copy.deepcopy(value)

    def transaction(self, update):
        with self.database.lock:
            if self.database.before_transaction:
                self.database.before_transaction()
            self.database.attempts += 1
            current = self.get()
            changed = update(current)
            cursor = self.database.data
            segments = self.path.split("/")
            for segment in segments[:-1]:
                cursor = cursor[segment]
            cursor[segments[-1]] = copy.deepcopy(changed)
            return changed


class MemoryDatabase:
    def __init__(self):
        self.lock = threading.Lock()
        self.attempts = 0
        self.before_transaction = None
        self.data = {
            "kioskEnrollments": {UID: {"companyId": COMPANY, "branchId": BRANCH, "isActive": True}},
            "billingEntitlements": {COMPANY: {BRANCH: {
                "plan": "basic", "subscriptionStatus": "active",
                "periodEndAt": int(time.time() * 1000) + 60000,
            }}},
            COMPANY: {"branches": {BRANCH: {
                "kiosks": {UID: {"isActive": True}},
                "categories": {"Drinks": {"coffee": {
                    "name": "Coffee", "price": 100, "available": True,
                    "sizes": {"Medium": {"priceModifier": 10}},
                }}},
                "inventory": {"Drinks": {"coffee": {
                    "sizes": {"Medium": {"stock": 2, "currentStock": 2}}
                }}},
                "logs": {},
            }}},
        }

    def reference(self, path):
        return MemoryReference(self, path)


def request(order_id=None, **changes):
    data = {
        "companyId": COMPANY, "branchId": BRANCH, "orderId": str(order_id or uuid4()),
        "customerName": "Guest", "paymentMethod": "COUNTER", "expectedTotal": 110,
        "items": [{"categoryId": "Drinks", "itemId": "coffee", "size": "Medium",
                   "quantity": 1, "expectedUnitPrice": 110}],
    }
    data.update(changes)
    return OrderRequest(**data)


def branch(db):
    return db.data[COMPANY]["branches"][BRANCH]


def stock(db):
    return branch(db)["inventory"]["Drinks"]["coffee"]["sizes"]["Medium"]["stock"]


def test_order_and_stock_commit_once_for_a_duplicate_id():
    db = MemoryDatabase()
    service = FirebaseOrderService(db)
    body = request()
    first = service.submit(uid=UID, body=body)
    second = service.submit(uid=UID, body=body)
    assert first == {**second, "duplicate": False}
    assert second["duplicate"] is True
    assert first["paymentStatus"] == "PAY_AT_COUNTER"
    assert stock(db) == 1
    assert len(branch(db)["logs"]) == 1


@pytest.mark.parametrize("change", [
    {"expectedTotal": 111},
    {"items": [{"categoryId": "Drinks", "itemId": "coffee", "size": "Medium",
                "quantity": 1, "expectedUnitPrice": 100}]},
])
def test_changed_client_price_or_total_never_writes(change):
    db = MemoryDatabase()
    before = copy.deepcopy(db.data)
    with pytest.raises(HTTPException) as exc:
        FirebaseOrderService(db).submit(uid=UID, body=request(**change))
    assert exc.value.status_code == 409
    assert db.data == before


def test_unavailable_insufficient_and_missing_size_never_write():
    for change in ("unavailable", "stock", "size"):
        db = MemoryDatabase()
        if change == "unavailable":
            branch(db)["categories"]["Drinks"]["coffee"]["available"] = False
        elif change == "stock":
            branch(db)["inventory"]["Drinks"]["coffee"]["sizes"]["Medium"]["stock"] = 0
        else:
            branch(db)["inventory"]["Drinks"]["coffee"]["sizes"].clear()
        before = copy.deepcopy(db.data)
        with pytest.raises(HTTPException) as exc:
            FirebaseOrderService(db).submit(uid=UID, body=request())
        assert exc.value.status_code == 409
        assert db.data == before


def test_revoked_or_wrong_branch_device_and_expired_plan_never_write():
    for change in ("root_revoked", "branch_revoked", "wrong_branch", "expired"):
        db = MemoryDatabase()
        if change == "root_revoked":
            db.data["kioskEnrollments"][UID]["isActive"] = False
        elif change == "branch_revoked":
            branch(db)["kiosks"][UID]["isActive"] = False
        elif change == "wrong_branch":
            db.data["kioskEnrollments"][UID]["branchId"] = "branch-other"
        else:
            db.data["billingEntitlements"][COMPANY][BRANCH]["periodEndAt"] = 0
        before = copy.deepcopy(db.data)
        with pytest.raises(HTTPException) as exc:
            FirebaseOrderService(db).submit(uid=UID, body=request())
        assert exc.value.status_code == 403
        assert db.data == before


def test_expiry_or_revocation_between_precheck_and_transaction_aborts_without_a_write():
    for change in ("expiry", "revocation"):
        db = MemoryDatabase()
        def before():
            if change == "expiry":
                db.data["billingEntitlements"][COMPANY][BRANCH]["periodEndAt"] = 0
            else:
                branch(db)["kiosks"][UID]["isActive"] = False
        db.before_transaction = before
        with pytest.raises(HTTPException) as exc:
            FirebaseOrderService(db).submit(uid=UID, body=request())
        assert exc.value.status_code == 403
        assert stock(db) == 2
        assert branch(db)["logs"] == {}


def test_concurrent_orders_cannot_oversell_stock():
    db = MemoryDatabase()
    branch(db)["inventory"]["Drinks"]["coffee"]["sizes"]["Medium"]["stock"] = 1
    service = FirebaseOrderService(db)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: _submit_result(service, request()), range(2)))
    assert sorted(results) == [201, 409]
    assert stock(db) == 0
    assert len(branch(db)["logs"]) == 1


def _submit_result(service, body):
    try:
        service.submit(uid=UID, body=body)
        return 201
    except HTTPException as exc:
        return exc.status_code


def test_http_requires_bearer_token_and_reports_order_readiness():
    db = MemoryDatabase()
    verifier = FakeIdentityVerifier({"valid": VerifiedIdentity(uid=UID)})
    app = create_app(identity_verifier=verifier, order_service=FirebaseOrderService(db))
    with TestClient(app) as client:
        assert client.get("/health/orders").status_code == 200
        assert client.post("/api/orders", json=request().model_dump(mode="json")).status_code == 401
        assert client.post("/api/orders", headers={"Authorization": "Bearer invalid"},
                           json=request().model_dump(mode="json")).status_code == 401
        legacy_qr = request().model_dump(mode="json")
        legacy_qr["orderId"] = str(legacy_qr["orderId"])
        legacy_qr["paymentMethod"] = "QR_CODE"
        before = copy.deepcopy(db.data)
        assert client.post("/api/orders", headers={"Authorization": "Bearer valid"}, json=legacy_qr).status_code == 422
        assert db.data == before
        response = client.post("/api/orders", headers={"Authorization": "Bearer valid"},
                               json=request().model_dump(mode="json"))
        assert response.status_code == 200
        assert response.json()["paymentStatus"] == "PAY_AT_COUNTER"
