"""Private operator command for a PayMongo linked merchant account.

This records a provider-issued account ID and webhook secret after the operator has
verified the merchant in PayMongo. It does not create or approve provider accounts.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

_COMPANY = re.compile(r"^company-[a-z0-9-]+$")
_PROVIDER_ID = re.compile(r"^[A-Za-z0-9_-]{3,160}$")


def configure_merchant(db, *, company: str, account_id: str, webhook_secret: str,
                       email: str, operator: str, connection_id: str | None = None) -> dict:
    if not _COMPANY.fullmatch(company):
        raise ValueError("Invalid company ID")
    if not account_id.startswith("org_") or not _PROVIDER_ID.fullmatch(account_id):
        raise ValueError("PayMongo linked account ID must start with org_")
    if not (16 <= len(webhook_secret) <= 512):
        raise ValueError("Webhook secret must be between 16 and 512 characters")
    if not email.strip() or "@" not in email or len(email) > 160:
        raise ValueError("A valid merchant email is required")
    if not operator.strip() or len(operator) > 160:
        raise ValueError("A valid operator identifier is required")
    profile = db.reference(f"{company}/companyProfile").get() or {}
    if not profile.get("ownerUids"):
        raise ValueError("Company profile and owner are required")

    current = db.reference(f"paymentMerchantConnections/{company}").get() or {}
    old_connection_id = current.get("connectionId")
    connection_id = connection_id or secrets.token_urlsafe(24)
    if not _PROVIDER_ID.fullmatch(connection_id):
        raise ValueError("Invalid webhook connection ID")
    now = int(time.time() * 1000)
    record = {
        "provider": "paymongo", "status": "ready", "accountId": account_id,
        "connectionId": connection_id, "webhookSecret": webhook_secret,
        "email": email.strip(), "configuredBy": operator.strip(),
        "createdAt": current.get("createdAt") or now, "updatedAt": now,
    }
    changes = {
        f"paymentMerchantConnections/{company}": record,
        f"paymentConnectionIndex/{connection_id}": company,
    }
    if old_connection_id and old_connection_id != connection_id:
        changes[f"paymentConnectionIndex/{old_connection_id}"] = None
    db.reference().update(changes)
    return {
        "companyId": company, "status": "ready", "accountId": account_id,
        "connectionId": connection_id,
        "webhookPath": f"/api/payments/paymongo/webhook/{connection_id}",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Configure a verified PayMongo linked merchant")
    parser.add_argument("--company", required=True)
    parser.add_argument("--account-id", required=True, help="Provider-issued linked Account-ID (org_...)")
    parser.add_argument("--webhook-secret", required=True, help="Secret shown once by PayMongo")
    parser.add_argument("--email", required=True)
    parser.add_argument("--operator", required=True)
    parser.add_argument("--connection-id", help="Stable opaque webhook URL segment; generated when omitted")
    args = parser.parse_args()
    database_url = os.environ.get("FIREBASE_DATABASE_URL")
    if not database_url:
        parser.error("FIREBASE_DATABASE_URL is required")

    import firebase_admin
    from firebase_admin import credentials, db

    credential_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    credential = credentials.Certificate(json.loads(credential_json)) if credential_json else None
    firebase_admin.initialize_app(credential, {"databaseURL": database_url})
    result = configure_merchant(
        db, company=args.company, account_id=args.account_id,
        webhook_secret=args.webhook_secret, email=args.email,
        operator=args.operator, connection_id=args.connection_id,
    )
    print(json.dumps(result))


if __name__ == "__main__":
    main()
