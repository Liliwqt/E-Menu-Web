"""Private payment-activation command. Never bundle this script or credentials in hosting.

Example:
 FIREBASE_DATABASE_URL=... FIREBASE_SERVICE_ACCOUNT_JSON=... \
 python agent-core/scripts/activate_subscription.py --company company-... \
 --branch branch-... --plan basic --reference RECEIPT-123 --amount-php 750 \
 --evidence PROVIDER-TRANSACTION-ID --operator operator-name
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from touchorders_core.billing import PRICES_PHP, next_month_at  # noqa: E402


def activate(db, *, company: str, branch: str, plan: str, reference: str,
             amount_php: int, evidence: str, operator: str) -> dict:
    if not re.fullmatch(r"company-[a-z0-9-]+", company):
        raise ValueError("Invalid company ID")
    if not re.fullmatch(r"branch-[a-z0-9-]+", branch):
        raise ValueError("Invalid branch ID")
    if plan not in PRICES_PHP or not reference.strip() or not operator.strip() or not evidence.strip():
        raise ValueError("A valid plan, payment reference, verification evidence, and operator are required")
    if amount_php != PRICES_PHP[plan]:
        raise ValueError("Verified payment amount does not match the selected plan")
    if len(reference.strip()) > 160 or len(evidence.strip()) > 160:
        raise ValueError("Payment reference and evidence must each be at most 160 characters")
    reference = reference.strip()
    key = hashlib.sha256(reference.encode()).hexdigest()
    claim = db.reference(f"subscriptionPaymentRefs/{key}")
    attempt = str(uuid.uuid4())
    existing = claim.transaction(lambda value: value or {
        "attempt": attempt, "companyId": company, "branchId": branch,
        "plan": plan, "state": "pending",
    })
    if existing["attempt"] != attempt:
        raise ValueError("Payment reference already claimed; inspect the existing payment before retrying")

    try:
        profile = db.reference(f"{company}/branches/{branch}/branchProfile").get()
        previous = db.reference(f"billingEntitlements/{company}/{branch}").get()
        if not profile or not previous:
            raise ValueError("Branch profile and original trial entitlement are required")
        timezone = profile.get("timezone") or "Asia/Manila"
        ZoneInfo(timezone)
        now = int(time.time() * 1000)
        same_paid_tier = (previous.get("subscriptionStatus") == "active"
                          and previous.get("plan") == plan
                          and int(previous.get("periodEndAt") or 0) > now)
        if same_paid_tier:
            start = int(previous["periodStartAt"])
            base = max(now, int(previous["periodEndAt"]))
            anchor = datetime.fromtimestamp(start / 1000, ZoneInfo(timezone)).day
        else:
            start = now
            base = now
            anchor = datetime.fromtimestamp(now / 1000, ZoneInfo(timezone)).day
        end = next_month_at(base, timezone, anchor)
        entitlement = {
            "companyId": company, "branchId": branch, "ownerUid": profile["ownerUid"],
            "plan": plan, "subscriptionStatus": "active", "periodStartAt": start,
            "periodEndAt": end, "trialStartedAt": previous["trialStartedAt"],
            "updatedAt": now,
        }
        payment = {
            "reference": reference, "amountPhp": PRICES_PHP[plan], "plan": plan,
            "verifiedAt": now, "operator": operator.strip(),
            "verificationEvidence": evidence.strip(),
            "periodEndAt": end,
        }
        # Payment, entitlement and claim are one server-authorized RTDB update.
        db.reference().update({
            f"billingEntitlements/{company}/{branch}": entitlement,
            f"subscriptionPayments/{company}/{branch}/{key}": payment,
            f"subscriptionPaymentRefs/{key}/state": "processed",
        })
        return {"plan": plan, "amountPhp": PRICES_PHP[plan], "periodEndAt": end}
    except Exception:
        # Keep the reference reserved after an uncertain server failure. The operator
        # must inspect entitlement and payment state before any manual retry.
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description="Activate a verified branch subscription payment")
    parser.add_argument("--company", required=True)
    parser.add_argument("--branch", required=True)
    parser.add_argument("--plan", choices=PRICES_PHP, required=True)
    parser.add_argument("--reference", required=True)
    parser.add_argument("--amount-php", type=int, required=True, help="Amount independently checked in the payment provider")
    parser.add_argument("--evidence", required=True, help="Provider transaction ID or internal verification record")
    parser.add_argument("--operator", required=True)
    args = parser.parse_args()
    url = os.environ.get("FIREBASE_DATABASE_URL")
    if not url:
        parser.error("FIREBASE_DATABASE_URL is required")
    import firebase_admin
    from firebase_admin import credentials, db

    credential_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    credential = credentials.Certificate(json.loads(credential_json)) if credential_json else None
    firebase_admin.initialize_app(credential, {"databaseURL": url})
    result = activate(db, company=args.company, branch=args.branch, plan=args.plan,
                      reference=args.reference, amount_php=args.amount_php,
                      evidence=args.evidence, operator=args.operator)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
