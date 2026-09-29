"""Real RTDB transaction checks; run only under the local database emulator."""
from __future__ import annotations

import os
import time
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi import HTTPException

from touchorders_core.api.orders import FirebaseOrderService
from touchorders_core.api.routes.orders import OrderRequest

pytestmark = pytest.mark.skipif(
    not os.environ.get("FIREBASE_DATABASE_EMULATOR_HOST"), reason="RTDB emulator is not running"
)


def test_atomic_checkout_against_database_emulator():
    import firebase_admin
    from firebase_admin import db

    if not firebase_admin._apps:
        firebase_admin.initialize_app(options={
            "projectId": "demo-menu-kiosk",
            "databaseURL": "https://demo-menu-kiosk-default-rtdb.firebaseio.com",
        })
    suffix = uuid4().hex[:8]
    company, branch, uid = f"company-order-{suffix}", f"branch-order-{suffix}", f"device-{suffix}"
    company_ref = db.reference(company)
    pointer_ref = db.reference(f"kioskEnrollments/{uid}")
    entitlement_ref = db.reference(f"billingEntitlements/{company}/{branch}")
    branch_ref = db.reference(f"{company}/branches/{branch}")
    try:
        pointer_ref.set({"companyId": company, "branchId": branch, "isActive": True})
        entitlement_ref.set({"plan": "basic", "subscriptionStatus": "active",
                             "periodEndAt": int(time.time() * 1000) + 60000})
        branch_ref.set({
            "kiosks": {uid: {"isActive": True}},
            "categories": {"Drinks": {"coffee": {
                "name": "Coffee", "price": 100, "available": True,
                "sizes": {"Medium": {"priceModifier": 10}},
            }}},
            "inventory": {"Drinks": {"coffee": {"sizes": {"Medium": {"stock": 1}}}}},
        })
        service = FirebaseOrderService(db)

        def submit(order_id):
            body = OrderRequest(
                companyId=company, branchId=branch, orderId=order_id,
                customerName="Guest", paymentMethod="QR_CODE", expectedTotal=110,
                items=[{"categoryId": "Drinks", "itemId": "coffee", "size": "Medium",
                        "quantity": 1, "expectedUnitPrice": 110}],
            )
            try:
                return service.submit(uid=uid, body=body)
            except HTTPException as exc:
                return exc.status_code

        ids = [uuid4(), uuid4()]
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(submit, ids))
        assert sum(isinstance(value, dict) for value in results) == 1
        assert 409 in results
        accepted = next(value for value in results if isinstance(value, dict))
        assert accepted["paymentStatus"] == "CUSTOMER_REPORTED_PAID"
        assert submit(accepted["orderId"])["duplicate"] is True
        after = branch_ref.get()
        assert after["inventory"]["Drinks"]["coffee"]["sizes"]["Medium"]["stock"] == 0
        assert len(after["logs"]) == 1

        entitlement_ref.update({"periodEndAt": 0})
        assert submit(uuid4()) == 403
        assert branch_ref.get() == after
    finally:
        company_ref.delete()
        pointer_ref.delete()
        entitlement_ref.delete()
