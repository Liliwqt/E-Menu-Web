"""Trusted Android checkout against the branch's current menu and inventory."""
from __future__ import annotations

import copy
import json
import re
import time
from collections import defaultdict
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from fastapi import HTTPException

from touchorders_core.observability.logging import get_logger

logger = get_logger(__name__)

_ID = re.compile(r"^(?:company|branch)-[a-z0-9-]+$")
_SEGMENT = re.compile(r"^[^.#$\[\]/]+$")
_ACTIVE = {"trialing", "active"}
_PLANS = {"basic", "starter", "premium"}


def _money(value) -> Decimal:
    try:
        number = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise HTTPException(409, "Current menu price is invalid") from exc
    if not number.is_finite() or number < 0:
        raise HTTPException(409, "Current menu price is invalid")
    return number.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _stock(value) -> int:
    try:
        number = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise HTTPException(409, "Inventory stock is invalid") from exc
    if not number.is_finite() or number < 0 or number != number.to_integral_value():
        raise HTTPException(409, "Inventory stock is invalid")
    return int(number)


def validate_branch_id(company: str, branch: str) -> None:
    if not _ID.fullmatch(company) or not _ID.fullmatch(branch):
        raise HTTPException(400, "Invalid branch")


def price_order(current: dict, body) -> tuple[list[dict], Decimal, dict[tuple[str, str, str], int]]:
    """Reprice an untrusted device cart from the current menu."""
    categories = current.get("categories") or {}
    stock_changes: dict[tuple[str, str, str], int] = defaultdict(int)
    lines: list[dict] = []
    total = Decimal("0.00")
    for item in body.items:
        category, item_id, size = item.categoryId, item.itemId, item.size
        if not _SEGMENT.fullmatch(category) or not _SEGMENT.fullmatch(item_id) or (size and not _SEGMENT.fullmatch(size)):
            raise HTTPException(400, "Invalid item identifier")
        menu_item = (categories.get(category) or {}).get(item_id)
        if not isinstance(menu_item, dict) or not menu_item.get("name"):
            raise HTTPException(409, "An item is no longer on the menu")
        if menu_item.get("available") is False or menu_item.get("manualUnavailable") is True:
            raise HTTPException(409, "An item is unavailable")
        sizes = menu_item.get("sizes") or {}
        if sizes:
            if size not in sizes:
                raise HTTPException(409, "An item size changed")
            size_value = sizes[size]
            modifier = size_value.get("priceModifier", 0) if isinstance(size_value, dict) else size_value
        elif size:
            raise HTTPException(409, "An item size changed")
        else:
            modifier = 0
        unit = _money(menu_item.get("price")) + _money(modifier)
        if unit < 0 or unit != _money(item.expectedUnitPrice):
            raise HTTPException(409, "An item price changed; refresh the menu")
        subtotal = unit * item.quantity
        total += subtotal
        lines.append({"name": str(menu_item["name"])[:120], "size": size, "quantity": item.quantity,
                      "price": float(unit), "subtotal": float(subtotal)})
        stock_changes[(category, item_id, size or "Medium")] += item.quantity
    if total > Decimal("1000000.00") or total != _money(body.expectedTotal):
        raise HTTPException(409, "Order total changed; review the cart")
    return lines, total, stock_changes


def decrement_inventory(branch: dict, stock_changes: dict[tuple[str, str, str], int]) -> None:
    inventory = branch.setdefault("inventory", {})
    for (category, item_id, size), quantity in stock_changes.items():
        inventory_item = (inventory.get(category) or {}).get(item_id)
        if inventory_item is None:
            continue
        record = (inventory_item.get("sizes") or {}).get(size)
        if record is None:
            raise HTTPException(409, "Selected size is not tracked in inventory")
        stock = _stock(record.get("stock", record.get("currentStock"))) if isinstance(record, dict) else _stock(record)
        if stock < quantity:
            raise HTTPException(409, "Insufficient inventory stock")
        if isinstance(record, dict):
            record["stock"] = stock - quantity
            if "currentStock" in record:
                record["currentStock"] = stock - quantity
        else:
            inventory_item["sizes"][size] = stock - quantity


def restore_inventory(branch: dict, stock_changes: list[dict]) -> None:
    inventory = branch.setdefault("inventory", {})
    for change in stock_changes:
        inventory_item = (inventory.get(change["categoryId"]) or {}).get(change["itemId"])
        if inventory_item is None:
            continue
        size = change["size"]
        record = (inventory_item.get("sizes") or {}).get(size)
        if record is None:
            continue
        quantity = int(change["quantity"])
        stock = _stock(record.get("stock", record.get("currentStock"))) if isinstance(record, dict) else _stock(record)
        if isinstance(record, dict):
            record["stock"] = stock + quantity
            if "currentStock" in record:
                record["currentStock"] = stock + quantity
        else:
            inventory_item["sizes"][size] = stock + quantity


class FirebaseOrderService:
    def __init__(self, database):
        self.db = database

    def check_external_access(self, uid: str, company: str, branch: str) -> None:
        if (self.db.reference("lifecycleMaintenance/enabled").get() is True
                or (self.db.reference(f"{company}/branches/{branch}/lifecycle/status").get() in {"closing", "deleting", "deleted"})):
            raise HTTPException(403, "Branch closure or maintenance is in progress. Ordering is paused.")
        pointer = self.db.reference(f"kioskEnrollments/{uid}").get() or {}
        if (pointer.get("companyId") != company or pointer.get("branchId") != branch
                or pointer.get("isActive") is not True):
            raise HTTPException(403, "Device registration is inactive or belongs to another branch")
        entitlement = self.db.reference(f"billingEntitlements/{company}/{branch}").get() or {}
        if (entitlement.get("plan") not in _PLANS
                or entitlement.get("subscriptionStatus") not in _ACTIVE
                or int(entitlement.get("periodEndAt") or 0) <= int(time.time() * 1000)):
            raise HTTPException(403, "Branch plan expired. Ordering is paused until the owner renews.")

    def ready(self) -> bool:
        # A small real RTDB read, independent of OpenAI and without branch data.
        self.db.reference("__touchorders_readiness__").get()
        return True

    def submit(self, *, uid: str, body) -> dict:
        company, branch = body.companyId, body.branchId
        validate_branch_id(company, branch)
        self.check_external_access(uid, company, branch)
        outcome = {"duplicate": False}
        attempts = 0
        path = f"{company}/branches/{branch}"

        def update_branch(current):
            nonlocal attempts
            attempts += 1
            # The Admin SDK retries this callback on contention. Recheck the
            # entitlement and root enrollment on every attempt, close to commit.
            self.check_external_access(uid, company, branch)
            if not isinstance(current, dict):
                raise HTTPException(404, "Branch was not found")
            from touchorders_core.api.lifecycle import assert_open
            assert_open(current)
            branch_bytes = len(json.dumps(current, separators=(",", ":")).encode("utf-8"))
            if branch_bytes > 1_000_000:
                logger.warning("order_branch_transaction_large", bytes=branch_bytes)
            kiosk = (current.get("kiosks") or {}).get(uid) or {}
            if kiosk.get("isActive") is not True:
                raise HTTPException(403, "Device registration is inactive")
            logs = current.get("logs") or {}
            existing = logs.get(str(body.orderId))
            if existing is not None:
                if existing.get("submittedByUid") != uid:
                    raise HTTPException(409, "Order ID is already in use")
                outcome["duplicate"] = True
                outcome["order"] = existing
                # Returning the identical branch is safe for idempotence; the
                # transaction makes no ledger or stock change.
                return current

            lines, total, stock_changes = price_order(current, body)
            next_branch = copy.deepcopy(current)
            if next_branch.get("lifecycle"):
                next_branch["lifecycle"]["lastActivityAt"] = int(time.time() * 1000)
                if next_branch["lifecycle"].get("status") not in {"closing", "deleting"}:
                    next_branch["lifecycle"]["status"] = "active"
                    next_branch["lifecycle"].pop("deleteAt", None)
            decrement_inventory(next_branch, stock_changes)

            if body.paymentMethod != "COUNTER":
                raise HTTPException(400, "QR Ph orders must use the verified payment checkout")
            order = {
                "orderId": str(body.orderId), "submittedByUid": uid,
                "orderNumber": str(body.orderId)[:8].upper(),
                "customerName": body.customerName, "items": lines,
                "total": float(total), "paymentMethod": "COUNTER",
                "paymentStatus": "PAY_AT_COUNTER",
                "timestamp": int(time.time() * 1000), "inventoryProcessed": True,
                "inventoryProcessedAt": int(time.time() * 1000), "orderSource": "android_kiosk",
            }
            next_branch.setdefault("logs", {})[str(body.orderId)] = order
            outcome["duplicate"] = False
            outcome["order"] = order
            return next_branch

        self.db.reference(path).transaction(update_branch)
        if attempts > 1:
            logger.warning("order_transaction_retried", attempts=attempts)
        order = outcome["order"]
        return {
            "orderId": order["orderId"], "orderNumber": order["orderNumber"],
            "total": order["total"], "paymentStatus": order["paymentStatus"],
            "duplicate": outcome["duplicate"],
        }
