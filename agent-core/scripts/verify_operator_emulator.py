"""Run with FIREBASE_DATABASE_EMULATOR_HOST set by emulators:exec."""
import os
import sys
import time

import firebase_admin
from firebase_admin import db

sys.path.insert(0, os.path.dirname(__file__))
from activate_subscription import activate

assert os.environ.get("FIREBASE_DATABASE_EMULATOR_HOST"), "Refusing to run outside the database emulator"
firebase_admin.initialize_app(options={
    "databaseURL": "https://demo-menu-kiosk.firebaseio.com",
    "projectId": "demo-menu-kiosk",
})
company, branch = "company-operator-test", "branch-operator-test"
now = int(time.time() * 1000)
db.reference("/").set({
    company: {"branches": {branch: {"branchProfile": {"ownerUid": "owner", "timezone": "Asia/Manila"}}}},
    "billingEntitlements": {company: {branch: {
        "companyId": company, "branchId": branch, "ownerUid": "owner", "plan": "starter",
        "subscriptionStatus": "trialing", "periodStartAt": now,
        "periodEndAt": now + 14 * 86400000, "trialStartedAt": now,
    }}},
})
first = activate(db, company=company, branch=branch, plan="basic", reference="EMU-001",
                 amount_php=750, evidence="emulator-verified-001", operator="test-operator")
record = db.reference(f"billingEntitlements/{company}/{branch}").get()
assert record["plan"] == "basic" and record["periodEndAt"] == first["periodEndAt"]
assert len(db.reference(f"subscriptionPayments/{company}/{branch}").get()) == 1
try:
    activate(db, company=company, branch=branch, plan="basic", reference="EMU-001",
             amount_php=750, evidence="emulator-verified-001", operator="test-operator")
except ValueError as exc:
    assert "already claimed" in str(exc)
else:
    raise AssertionError("Duplicate payment reference was accepted")
renewal = activate(db, company=company, branch=branch, plan="basic", reference="EMU-002",
                   amount_php=750, evidence="emulator-verified-002", operator="test-operator")
assert renewal["periodEndAt"] > first["periodEndAt"]
changed = activate(db, company=company, branch=branch, plan="premium", reference="EMU-003",
                   amount_php=1750, evidence="emulator-verified-003", operator="test-operator")
assert changed["plan"] == "premium"
assert db.reference(f"billingEntitlements/{company}/{branch}").get()["periodStartAt"] >= now
assert len(db.reference(f"subscriptionPayments/{company}/{branch}").get()) == 3
print("PASS operator activation, renewal, immediate tier change, audit and duplicate-reference denial")
