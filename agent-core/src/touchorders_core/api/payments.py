"""Verified QR Ph checkout, stock reservations, and PayMongo settlement."""
from __future__ import annotations

import base64
import copy
import hashlib
import hmac
import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException

from touchorders_core.api.orders import (
    FirebaseOrderService,
    _money,
    decrement_inventory,
    price_order,
    restore_inventory,
    validate_branch_id,
)

RESERVATION_MS = 5 * 60 * 1000
FINAL_STATES = {"paid", "expired", "cancelled", "failed", "refunded"}


@dataclass(frozen=True)
class PayMongoCheckout:
    intent_id: str
    payment_method_id: str
    qr_image: str
    expires_at: int
    status: str = "awaiting_payment"


class PayMongoClient:
    """Small server-only PayMongo client. Secret keys never reach either client app."""

    def __init__(self, secret_key: str, base_url: str = "https://api.paymongo.com/v1") -> None:
        self.secret_key = secret_key
        self.base_url = base_url.rstrip("/")

    def _request(self, method: str, path: str, *, account_id: str, payload: dict | None = None,
                 idempotency_key: str | None = None) -> dict:
        body = json.dumps(payload).encode() if payload is not None else None
        request = urllib.request.Request(self.base_url + path, data=body, method=method)
        request.add_header("Authorization", "Basic " + base64.b64encode((self.secret_key + ":").encode()).decode())
        request.add_header("Accept", "application/json")
        request.add_header("Content-Type", "application/json")
        request.add_header("Account-ID", account_id)
        if idempotency_key:
            request.add_header("Idempotency-Key", idempotency_key)
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                return json.loads(response.read().decode())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")[:500]
            raise RuntimeError(f"PayMongo rejected the request ({exc.code}): {detail}") from exc
        except (OSError, ValueError) as exc:
            raise RuntimeError("PayMongo is temporarily unavailable") from exc

    def create_qr_checkout(self, *, account_id: str, order_id: str, amount_centavos: int,
                           description: str, expires_at: int, metadata: dict[str, str],
                           attempt: int = 1) -> PayMongoCheckout:
        key_suffix = f"{order_id}-{attempt}"
        intent = self._request("POST", "/payment_intents", account_id=account_id,
            idempotency_key=f"touchorders-intent-{key_suffix}", payload={"data": {"attributes": {
                "amount": amount_centavos, "payment_method_allowed": ["qrph"], "currency": "PHP",
                "description": description, "metadata": metadata,
            }}})
        intent_id = intent["data"]["id"]
        client_key = (intent.get("data", {}).get("attributes") or {}).get("client_key")
        if not client_key:
            raise RuntimeError("PayMongo did not return a Payment Intent client key")
        method = self._request("POST", "/payment_methods", account_id=account_id,
            idempotency_key=f"touchorders-method-{key_suffix}", payload={"data": {"attributes": {
                "type": "qrph", "expiry_seconds": RESERVATION_MS // 1000,
            }}})
        method_id = method["data"]["id"]
        attached = self._request("POST", f"/payment_intents/{intent_id}/attach", account_id=account_id,
            idempotency_key=f"touchorders-attach-{key_suffix}",
            payload={"data": {"attributes": {"payment_method": method_id, "client_key": client_key}}})
        attributes = attached.get("data", {}).get("attributes", {})
        action = attributes.get("next_action") or {}
        code = action.get("code") or {}
        qr_image = code.get("image_url") or action.get("image_url") or action.get("qr_code_url")
        if not qr_image:
            raise RuntimeError("PayMongo did not return a QR Ph image")
        return PayMongoCheckout(intent_id, method_id, str(qr_image), expires_at)

    def retrieve_intent(self, *, account_id: str, intent_id: str) -> dict:
        return self._request("GET", f"/payment_intents/{intent_id}", account_id=account_id)

    def create_refund(self, *, account_id: str, payment_id: str, amount_centavos: int,
                      reason: str, idempotency_key: str) -> dict:
        return self._request("POST", "/refunds", account_id=account_id,
            idempotency_key=idempotency_key, payload={"data": {"attributes": {
                "amount": amount_centavos, "payment_id": payment_id, "reason": reason,
            }}})


def verify_paymongo_signature(raw_body: bytes, signature: str, secret: str, *, now_seconds: int | None = None) -> bool:
    parts = dict(part.split("=", 1) for part in signature.split(",") if "=" in part)
    timestamp = parts.get("t")
    try:
        livemode = (json.loads(raw_body).get("data", {}).get("attributes", {}).get("livemode") is True)
    except (UnicodeDecodeError, ValueError, AttributeError):
        return False
    supplied = parts.get("li") if livemode else parts.get("te")
    if not timestamp or not supplied or not timestamp.isdigit():
        return False
    now = int(time.time()) if now_seconds is None else now_seconds
    if abs(now - int(timestamp)) > 300:
        return False
    expected = hmac.new(secret.encode(), timestamp.encode() + b"." + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, supplied)


class FirebasePaymentService:
    def __init__(self, database, order_service: FirebaseOrderService, gateway: PayMongoClient | None,
                 *, linked_accounts_enabled: bool = False) -> None:
        self.db = database
        self.orders = order_service
        self.gateway = gateway
        self.linked_accounts_enabled = linked_accounts_enabled

    def ready(self) -> bool:
        if self.gateway is None:
            raise RuntimeError("PayMongo is not configured")
        self.db.reference("__touchorders_readiness__").get()
        return True

    def _is_owner(self, uid: str, company: str) -> bool:
        return self.db.reference(f"{company}/companyProfile/ownerUids/{uid}").get() is True

    def merchant_status(self, *, uid: str, company: str, branch: str) -> dict:
        validate_branch_id(company, branch)
        if not self._is_owner(uid, company):
            raise HTTPException(403, "Only the business owner can manage payment setup")
        connection = self.db.reference(f"paymentMerchantConnections/{company}").get() or {}
        ready = bool(self.gateway and self.linked_accounts_enabled and connection.get("status") == "ready"
                     and connection.get("accountId"))
        return {
            "provider": "paymongo", "available": ready,
            "status": connection.get("status", "not_connected"),
            "linkedAccountsEnabled": self.linked_accounts_enabled,
            "email": connection.get("email"), "updatedAt": connection.get("updatedAt"),
            "message": None if ready else (
                "QR Ph is unavailable until platform rollout is enabled and a verified linked PayMongo merchant is connected."
            ),
        }

    def request_merchant_onboarding(self, *, uid: str, company: str, branch: str, email: str) -> dict:
        validate_branch_id(company, branch)
        if not self._is_owner(uid, company):
            raise HTTPException(403, "Only the business owner can manage payment setup")
        if not self.linked_accounts_enabled:
            raise HTTPException(503, "Linked PayMongo merchant onboarding is not enabled for this platform rollout yet")
        if self.gateway is None:
            raise HTTPException(503, "PayMongo is not configured")
        # PayMongo's public linked-account invitation API is not generally available yet.
        # Record the owner request without inventing an undocumented provider call.
        now = int(time.time() * 1000)
        record = {"provider": "paymongo", "status": "onboarding_requested", "email": email,
                  "requestedBy": uid, "createdAt": now, "updatedAt": now}
        self.db.reference(f"paymentMerchantConnections/{company}").set(record)
        return self.merchant_status(uid=uid, company=company, branch=branch)

    def _merchant(self, company: str) -> dict:
        connection = self.db.reference(f"paymentMerchantConnections/{company}").get() or {}
        if not self.gateway or not self.linked_accounts_enabled or connection.get("status") != "ready":
            raise HTTPException(503, "Verified QR Ph is not available for this business; use pay at counter")
        if not connection.get("accountId"):
            raise HTTPException(503, "The business payment account is incomplete")
        return connection

    @staticmethod
    def _request_fingerprint(body) -> str:
        data = body.model_dump(mode="json")
        return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

    def start_checkout(self, *, uid: str, body) -> dict:
        company, branch, order_id = body.companyId, body.branchId, str(body.orderId)
        validate_branch_id(company, branch)
        self.orders.check_external_access(uid, company, branch)
        merchant = self._merchant(company)
        path = f"{company}/branches/{branch}"
        fingerprint = self._request_fingerprint(body)
        now = int(time.time() * 1000)
        expires_at = now + RESERVATION_MS
        outcome: dict[str, Any] = {}

        def reserve(current):
            self.orders.check_external_access(uid, company, branch)
            if not isinstance(current, dict):
                raise HTTPException(404, "Branch was not found")
            from touchorders_core.api.lifecycle import assert_open
            assert_open(current)
            kiosk = (current.get("kiosks") or {}).get(uid) or {}
            if kiosk.get("isActive") is not True:
                raise HTTPException(403, "Device registration is inactive")
            existing_order = (current.get("logs") or {}).get(order_id)
            if existing_order:
                if existing_order.get("submittedByUid") != uid:
                    raise HTTPException(409, "Order ID is already in use")
                outcome.update({"paidOrder": existing_order})
                return current
            existing = (current.get("paymentReservations") or {}).get(order_id)
            attempt = 1
            if existing:
                if existing.get("submittedByUid") != uid or existing.get("requestFingerprint") != fingerprint:
                    raise HTTPException(409, "Order ID is already in use")
                if existing.get("status") not in {"expired", "cancelled", "failed"}:
                    outcome.update({"reservation": existing})
                    return current
                attempt = int(existing.get("attempt") or 1) + 1
            lines, total, changes = price_order(current, body)
            if int(total * 100) < 100:
                raise HTTPException(409, "QR Ph requires a minimum order total of ₱1.00")
            next_branch = copy.deepcopy(current)
            decrement_inventory(next_branch, changes)
            reservation = {
                "orderId": order_id, "orderNumber": order_id[:8].upper(), "submittedByUid": uid,
                "customerName": body.customerName, "items": lines, "total": float(total),
                "amountCentavos": int(total * 100), "status": "creating", "createdAt": now,
                "expiresAt": expires_at, "requestFingerprint": fingerprint, "attempt": attempt,
                "stockChanges": [{"categoryId": c, "itemId": i, "size": s, "quantity": q}
                                 for (c, i, s), q in changes.items()],
            }
            next_branch.setdefault("paymentReservations", {})[order_id] = reservation
            outcome["reservation"] = reservation
            return next_branch

        self.db.reference(path).transaction(reserve)
        if "paidOrder" in outcome:
            order = outcome["paidOrder"]
            return {"checkoutId": order_id, "orderId": order_id, "orderNumber": order["orderNumber"],
                    "total": order["total"], "status": "paid", "expiresAt": 0}
        reservation = outcome["reservation"]
        if reservation.get("status") != "creating":
            return self._public_checkout(reservation)
        try:
            # Index before the network call so a process interruption cannot leave
            # reserved stock outside the background expiry sweep.
            self.db.reference(f"paymentReservationIndex/{order_id}").set(
                {"companyId": company, "branchId": branch, "expiresAt": reservation["expiresAt"]})
            checkout = self.gateway.create_qr_checkout(
                account_id=merchant["accountId"], order_id=order_id,
                amount_centavos=reservation["amountCentavos"],
                description=f"Order {reservation['orderNumber']}", expires_at=reservation["expiresAt"],
                metadata={"company_id": company, "branch_id": branch, "order_id": order_id,
                          "attempt": str(reservation.get("attempt", 1))},
                attempt=int(reservation.get("attempt", 1)),
            )
        except Exception:
            self._release(company, branch, order_id, "failed")
            raise
        reservation.update({"status": "awaiting_payment", "providerIntentId": checkout.intent_id,
                            "providerPaymentMethodId": checkout.payment_method_id,
                            "updatedAt": int(time.time() * 1000)})
        try:
            self.db.reference(f"{path}/paymentReservations/{order_id}").set(reservation)
            self.db.reference(f"paymentIntentIndex/{checkout.intent_id}").set(
                {"companyId": company, "branchId": branch, "orderId": order_id})
            # QR payloads can authorize payment, so keep them outside branch-readable data.
            self.db.reference(f"paymentCheckoutSecrets/{order_id}").set(
                {"companyId": company, "branchId": branch, "qrImage": checkout.qr_image,
                 "expiresAt": reservation["expiresAt"]})
        except Exception:
            self._release(company, branch, order_id, "failed")
            raise
        return self._public_checkout(reservation)

    def _public_checkout(self, reservation: dict) -> dict:
        qr_image = None
        if reservation.get("status") == "awaiting_payment":
            secret = self.db.reference(f"paymentCheckoutSecrets/{reservation['orderId']}").get() or {}
            qr_image = secret.get("qrImage")
        return {"checkoutId": reservation["orderId"], "orderId": reservation["orderId"],
                "orderNumber": reservation["orderNumber"], "total": reservation["total"],
                "status": reservation["status"], "expiresAt": reservation.get("expiresAt", 0),
                "qrImage": qr_image}

    @staticmethod
    def _provider_state(payload: dict) -> tuple[str, str | None]:
        data = payload.get("data", {})
        attributes = data.get("attributes", {})
        status = str(attributes.get("status", "")).lower()
        payments = attributes.get("payments") or []
        payment_id = payments[0].get("id") if payments and isinstance(payments[0], dict) else None
        if status in {"succeeded", "paid"}:
            return "paid", payment_id
        if status in {"failed", "cancelled", "expired"}:
            return status, payment_id
        return "awaiting_payment", payment_id

    def checkout_status(self, *, uid: str, company: str, branch: str, order_id: str) -> dict:
        validate_branch_id(company, branch)
        self.orders.check_external_access(uid, company, branch)
        reservation = self.db.reference(f"{company}/branches/{branch}/paymentReservations/{order_id}").get()
        if not isinstance(reservation, dict) or reservation.get("submittedByUid") != uid:
            order = self.db.reference(f"{company}/branches/{branch}/logs/{order_id}").get()
            if isinstance(order, dict) and order.get("submittedByUid") == uid:
                return {"checkoutId": order_id, "orderId": order_id, "orderNumber": order["orderNumber"],
                        "total": order["total"], "status": "paid", "expiresAt": 0}
            raise HTTPException(404, "QR checkout was not found")
        if reservation.get("status") in FINAL_STATES:
            return self._public_checkout(reservation)
        merchant = self._merchant(company)
        intent_id = reservation.get("providerIntentId")
        if intent_id:
            state, payment_id = self._provider_state(
                self.gateway.retrieve_intent(account_id=merchant["accountId"], intent_id=intent_id))
            if state == "paid":
                reservation = self._finalize_paid(company, branch, order_id, payment_id)
            elif state in {"failed", "cancelled", "expired"}:
                reservation = self._release(company, branch, order_id, state)
        if reservation.get("status") not in FINAL_STATES and int(reservation.get("expiresAt", 0)) <= int(time.time() * 1000):
            reservation = self._release(company, branch, order_id, "expired")
        return self._public_checkout(reservation)

    def cancel_checkout(self, *, uid: str, company: str, branch: str, order_id: str) -> dict:
        validate_branch_id(company, branch)
        self.orders.check_external_access(uid, company, branch)
        reservation = self.db.reference(f"{company}/branches/{branch}/paymentReservations/{order_id}").get() or {}
        if reservation.get("submittedByUid") != uid:
            raise HTTPException(404, "QR checkout was not found")
        if reservation.get("status") == "paid":
            raise HTTPException(409, "A paid checkout cannot be cancelled")
        return self._public_checkout(self._release(company, branch, order_id, "cancelled"))

    def _release(self, company: str, branch: str, order_id: str, reason: str) -> dict:
        outcome: dict[str, Any] = {}
        def update(current):
            if not isinstance(current, dict):
                return current
            reservation = (current.get("paymentReservations") or {}).get(order_id)
            if not isinstance(reservation, dict):
                return current
            if reservation.get("status") in FINAL_STATES:
                outcome["reservation"] = reservation
                return current
            next_branch = copy.deepcopy(current)
            next_reservation = next_branch["paymentReservations"][order_id]
            restore_inventory(next_branch, next_reservation.get("stockChanges") or [])
            next_reservation.update({"status": reason, "updatedAt": int(time.time() * 1000)})
            outcome["reservation"] = next_reservation
            return next_branch
        self.db.reference(f"{company}/branches/{branch}").transaction(update)
        reservation = outcome.get("reservation") or {}
        intent_id = reservation.get("providerIntentId")
        if intent_id:
            self.db.reference(f"paymentIntentIndex/{intent_id}").set(None)
        self.db.reference(f"paymentReservationIndex/{order_id}").set(None)
        self.db.reference(f"paymentCheckoutSecrets/{order_id}").set(None)
        return reservation or {"orderId": order_id, "orderNumber": order_id[:8].upper(),
                                              "total": 0, "status": reason}

    def _finalize_paid(self, company: str, branch: str, order_id: str, payment_id: str | None) -> dict:
        outcome: dict[str, Any] = {}
        now = int(time.time() * 1000)
        def update(current):
            if not isinstance(current, dict):
                return current
            reservation = (current.get("paymentReservations") or {}).get(order_id)
            if not isinstance(reservation, dict):
                return current
            if reservation.get("status") == "paid":
                outcome["reservation"] = reservation
                return current
            if reservation.get("status") in {"expired", "cancelled", "failed"}:
                return current
            next_branch = copy.deepcopy(current)
            next_reservation = next_branch["paymentReservations"][order_id]
            next_reservation.update({"status": "paid", "providerPaymentId": payment_id, "paidAt": now,
                                     "updatedAt": now})
            order = {
                "orderId": order_id, "submittedByUid": reservation["submittedByUid"],
                "orderNumber": reservation["orderNumber"], "customerName": reservation["customerName"],
                "items": reservation["items"], "total": reservation["total"],
                "paymentMethod": "QRPH", "paymentStatus": "PAID_CONFIRMED",
                "paymentProvider": "paymongo", "providerPaymentId": payment_id,
                "timestamp": now, "inventoryProcessed": True, "inventoryProcessedAt": reservation["createdAt"],
                "orderSource": "android_kiosk",
            }
            next_branch.setdefault("logs", {})[order_id] = order
            outcome["reservation"] = next_reservation
            return next_branch
        self.db.reference(f"{company}/branches/{branch}").transaction(update)
        if "reservation" not in outcome:
            raise HTTPException(409, "Payment arrived after the reservation closed; contact support")
        intent_id = outcome["reservation"].get("providerIntentId")
        if intent_id:
            self.db.reference(f"paymentIntentIndex/{intent_id}").set(None)
        self.db.reference(f"paymentReservationIndex/{order_id}").set(None)
        self.db.reference(f"paymentCheckoutSecrets/{order_id}").set(None)
        return outcome["reservation"]

    def sweep_expired(self) -> int:
        now = int(time.time() * 1000)
        resolved = 0
        for order_id, entry in (self.db.reference("paymentReservationIndex").get() or {}).items():
            if not isinstance(entry, dict) or int(entry.get("expiresAt") or 0) > now:
                continue
            company, branch = entry["companyId"], entry["branchId"]
            reservation = self.db.reference(f"{company}/branches/{branch}/paymentReservations/{order_id}").get() or {}
            intent_id = reservation.get("providerIntentId")
            merchant = self.db.reference(f"paymentMerchantConnections/{company}").get() or {}
            if intent_id and self.gateway and merchant.get("accountId"):
                state, payment_id = self._provider_state(
                    self.gateway.retrieve_intent(account_id=merchant["accountId"], intent_id=intent_id))
                if state == "paid":
                    self._finalize_paid(company, branch, order_id, payment_id)
                    resolved += 1
                    continue
            self._release(company, branch, order_id, "expired")
            resolved += 1
        return resolved

    def refund_order(self, *, uid: str, company: str, branch: str, order_id: str, reason: str) -> dict:
        validate_branch_id(company, branch)
        if not self._is_owner(uid, company):
            raise HTTPException(403, "Only the business owner can refund a QR Ph payment")
        existing = self.db.reference(f"paymentRefunds/{company}/{branch}/{order_id}").get() or {}
        if existing.get("status") in {"pending", "succeeded"}:
            return existing
        merchant = self._merchant(company)
        order_ref = self.db.reference(f"{company}/branches/{branch}/logs/{order_id}")
        order = order_ref.get() or {}
        if order.get("paymentMethod") != "QRPH" or order.get("paymentStatus") not in {"PAID_CONFIRMED", "REFUND_PENDING"}:
            raise HTTPException(409, "Only a confirmed QR Ph order can be refunded")
        payment_id = order.get("providerPaymentId")
        if not payment_id:
            raise HTTPException(409, "The order has no provider payment reference")
        payload = self.gateway.create_refund(
            account_id=merchant["accountId"], payment_id=payment_id,
            amount_centavos=int(_money(order.get("total")) * 100), reason=reason,
            idempotency_key=f"touchorders-refund-{order_id}",
        )
        data = payload.get("data", {})
        attributes = data.get("attributes", {})
        provider_status = str(attributes.get("status", "pending")).lower()
        if provider_status in {"succeeded", "refunded"}:
            status = "succeeded"
        elif provider_status in {"pending", "processing"}:
            status = "pending"
        else:
            status = "failed"
        now = int(time.time() * 1000)
        record = {"orderId": order_id, "providerRefundId": data.get("id"), "providerPaymentId": payment_id,
                  "amount": order["total"], "status": status, "reason": reason,
                  "requestedBy": uid, "requestedAt": now, "updatedAt": now}
        self.db.reference(f"paymentRefunds/{company}/{branch}/{order_id}").set(record)
        if status in {"succeeded", "pending"}:
            order.update({"paymentStatus": "REFUNDED" if status == "succeeded" else "REFUND_PENDING",
                          "providerRefundId": data.get("id"), "refundUpdatedAt": now})
            order_ref.set(order)
        return record

    def handle_webhook(self, *, connection_id: str, raw_body: bytes, signature: str) -> None:
        company = self.db.reference(f"paymentConnectionIndex/{connection_id}").get()
        if not company:
            raise HTTPException(404, "Unknown payment connection")
        connection = self.db.reference(f"paymentMerchantConnections/{company}").get() or {}
        secret = connection.get("webhookSecret")
        if not secret or not verify_paymongo_signature(raw_body, signature, secret):
            raise HTTPException(401, "Invalid webhook signature")
        event = json.loads(raw_body)
        event_id = event.get("data", {}).get("id") or hashlib.sha256(raw_body).hexdigest()
        event_ref = self.db.reference(f"paymentWebhookEvents/{event_id}")
        if event_ref.get():
            return
        attributes = event.get("data", {}).get("attributes", {})
        event_type = attributes.get("type")
        resource = attributes.get("data") or {}
        intent_id = (resource.get("attributes") or {}).get("payment_intent_id") or resource.get("id")
        index = self.db.reference(f"paymentIntentIndex/{intent_id}").get() or {}
        if index and event_type in {"payment.paid", "payment.failed", "qrph.expired"}:
            if event_type == "payment.paid":
                payment_id = resource.get("id")
                self._finalize_paid(index["companyId"], index["branchId"], index["orderId"], payment_id)
            else:
                self._release(index["companyId"], index["branchId"], index["orderId"],
                              "expired" if event_type == "qrph.expired" else "failed")
        event_ref.set({"receivedAt": int(time.time() * 1000), "type": event_type,
                       "companyId": index.get("companyId", ""), "branchId": index.get("branchId", "")})
