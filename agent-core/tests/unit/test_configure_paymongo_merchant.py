"""Operator merchant configuration keeps webhook secrets server-side."""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "configure_paymongo_merchant.py"
spec = importlib.util.spec_from_file_location("configure_paymongo_merchant", SCRIPT)
module = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(module)


class Reference:
    def __init__(self, db, path): self.db, self.path = db, path
    def get(self): return self.db.values.get(self.path)
    def update(self, changes): self.db.changes.update(changes)


class Database:
    def __init__(self):
        self.values = {"company-demo/companyProfile": {"ownerUids": {"owner": True}}}
        self.changes = {}
    def reference(self, path=""): return Reference(self, path)


def test_configure_merchant_writes_connection_and_returns_no_secret():
    db = Database()
    result = module.configure_merchant(
        db, company="company-demo", account_id="org_demo",
        webhook_secret="whsec_very_secret_value", email="owner@example.com",
        operator="operator@example.com", connection_id="public-hook-id",
    )
    record = db.changes["paymentMerchantConnections/company-demo"]
    assert record["webhookSecret"] == "whsec_very_secret_value"
    assert db.changes["paymentConnectionIndex/public-hook-id"] == "company-demo"
    assert "secret" not in result and result["webhookPath"].endswith("/public-hook-id")


def test_configure_merchant_rejects_missing_company_owner():
    db = Database(); db.values.clear()
    with pytest.raises(ValueError, match="owner"):
        module.configure_merchant(
            db, company="company-demo", account_id="org_demo",
            webhook_secret="whsec_very_secret_value", email="owner@example.com",
            operator="operator@example.com",
        )
