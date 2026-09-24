from __future__ import annotations

import importlib.util
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException

from touchorders_core.api.entitlements import FirebaseEntitlementService
from touchorders_core.billing import AI_ALLOWANCE, current_period_start, next_month_at

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "activate_subscription.py"
spec = importlib.util.spec_from_file_location("activate_subscription", SCRIPT)
activation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(activation)


class Ref:
    def __init__(self, root, path=""):
        self.root, self.path = root, path

    def _parts(self):
        return [p for p in self.path.split("/") if p]

    def get(self):
        value = self.root
        for part in self._parts():
            if not isinstance(value, dict):
                return None
            value = value.get(part)
        return value

    def set(self, value):
        parent, key = self._parent()
        parent[key] = value

    def delete(self):
        parent, key = self._parent()
        parent.pop(key, None)

    def _parent(self):
        parent = self.root
        parts = self._parts()
        for part in parts[:-1]:
            parent = parent.setdefault(part, {})
        return parent, parts[-1]

    def child(self, key):
        return Ref(self.root, f"{self.path}/{key}")

    def transaction(self, callback):
        result = callback(self.get())
        if result is None:
            self.delete()
        else:
            self.set(result)
        return result

    def update(self, values):
        for key, value in values.items():
            Ref(self.root, key).set(value)


class Db:
    def __init__(self, root):
        self.root = root

    def reference(self, path=""):
        return Ref(self.root, path)


def fixture():
    now = int(datetime.now().timestamp() * 1000)
    return Db({
        "company-test": {
            "companyProfile": {"ownerUids": {"owner": True}},
            "users": {"owner": {"uid": "owner"}, "manager": {"uid": "manager"}, "staff": {"uid": "staff"}},
            "branches": {"branch-test": {
                "branchProfile": {"ownerUid": "owner", "timezone": "Asia/Manila"},
                "users": {"manager": {"role": "manager"}, "staff": {"role": "staff"}},
            }},
        },
        "billingEntitlements": {"company-test": {"branch-test": {
            "plan": "starter", "subscriptionStatus": "trialing",
            "periodStartAt": now, "periodEndAt": now + 86400000, "trialStartedAt": now,
        }}},
    })


def req(uid="owner", mode="deep", request_id="00000000-0000-4000-8000-000000000001"):
    return dict(uid=uid, company="company-test", branch="branch-test", mode=mode, request_id=request_id)


def test_starter_modes_and_branch_wide_quota(monkeypatch):
    db = fixture()
    service = FirebaseEntitlementService(db)
    monkeypatch.setitem(AI_ALLOWANCE, "starter", 1)
    grant = service.reserve(**req())
    assert grant.plan == "starter"
    with pytest.raises(HTTPException) as duplicate:
        service.reserve(**req())
    assert duplicate.value.status_code == 409
    with pytest.raises(HTTPException) as limit:
        service.reserve(**req(uid="manager", request_id="00000000-0000-4000-8000-000000000002"))
    assert limit.value.status_code == 429
    service.refund(grant, req()["request_id"])
    assert service.reserve(**req(uid="manager", request_id="00000000-0000-4000-8000-000000000002")).plan == "starter"


def test_role_tier_and_expiry_are_checked_before_ai_use():
    db = fixture()
    service = FirebaseEntitlementService(db)
    for request in (req(uid="staff"), req(mode="live")):
        with pytest.raises(HTTPException) as denied:
            service.reserve(**request)
        assert denied.value.status_code == 403
    entitlement = db.reference("billingEntitlements/company-test/branch-test").get()
    entitlement["periodEndAt"] = 1
    with pytest.raises(HTTPException) as expired:
        service.reserve(**req())
    assert expired.value.status_code == 403


def test_calendar_months_restore_anchor_after_short_february():
    zone = ZoneInfo("Asia/Manila")
    jan = int(datetime(2026, 1, 31, 13, 30, tzinfo=zone).timestamp() * 1000)
    feb = next_month_at(jan, "Asia/Manila", 31)
    march = next_month_at(feb, "Asia/Manila", 31)
    assert datetime.fromtimestamp(feb / 1000, zone).day == 28
    assert datetime.fromtimestamp(march / 1000, zone).day == 31
    assert current_period_start({"periodStartAt": jan, "subscriptionStatus": "active"}, feb + 1000, "Asia/Manila") == feb


def test_operator_activation_is_atomic_and_duplicate_reference_is_rejected(monkeypatch):
    db = fixture()
    monkeypatch.setattr(activation.time, "time", lambda: 1790236800)
    result = activation.activate(db, company="company-test", branch="branch-test",
                                 plan="basic", reference="PAID-001", amount_php=750, evidence="provider-123", operator="cashier")
    assert result["amountPhp"] == 750
    entitlement = db.reference("billingEntitlements/company-test/branch-test").get()
    assert entitlement["plan"] == "basic"
    assert entitlement["subscriptionStatus"] == "active"
    assert entitlement["trialStartedAt"] > 0
    with pytest.raises(ValueError, match="already claimed"):
        activation.activate(db, company="company-test", branch="branch-test",
                            plan="premium", reference="PAID-001", amount_php=1750, evidence="provider-123", operator="cashier")
    assert db.reference("billingEntitlements/company-test/branch-test").get() == entitlement


def test_renewal_after_expiry_starts_a_fresh_calendar_month(monkeypatch):
    db = fixture()
    old = db.reference("billingEntitlements/company-test/branch-test").get()
    old.update(plan="basic", subscriptionStatus="active", periodStartAt=1, periodEndAt=2)
    now_seconds = 1790236800
    monkeypatch.setattr(activation.time, "time", lambda: now_seconds)
    activation.activate(db, company="company-test", branch="branch-test",
                        plan="basic", reference="NEW-PAID-002", amount_php=750, evidence="provider-456", operator="cashier")
    current = db.reference("billingEntitlements/company-test/branch-test").get()
    assert current["periodStartAt"] == now_seconds * 1000
    assert current["periodEndAt"] == next_month_at(now_seconds * 1000, "Asia/Manila")


def test_operator_rejects_amount_mismatch_without_claiming_reference():
    db = fixture()
    with pytest.raises(ValueError, match="amount"):
        activation.activate(db, company="company-test", branch="branch-test",
                            plan="premium", reference="WRONG-PAID-003", amount_php=750,
                            evidence="provider-789", operator="cashier")
    assert not db.reference("subscriptionPaymentRefs").get()
