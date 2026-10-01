"""Admin-only branch lifecycle. No scheduled deletion is enabled by construction.

Transitions use root transactions so lifecycle, enrollment and billing changes
commit together with operational writes. Callbacks have no external side effects.
"""
from __future__ import annotations

import copy
import csv
import hashlib
import io
import json
import logging
import time
import uuid
import zipfile
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from touchorders_core.billing import next_month_at
from touchorders_core.api.orders import validate_branch_id

DAY = 86_400_000
BLOCKED = {"closing", "deleting", "deleted"}
FINAL_PAYMENT = {"paid", "succeeded", "cancelled", "expired", "failed"}
LOGGER = logging.getLogger(__name__)
PRIVATE_ROOTS = ("billingEntitlements", "subscriptionPayments", "premiumInsights", "aiUsage", "aiRequests", "paymentRefunds")


def utc_ms():
    return int(time.time() * 1000)


def add_months(value, count):
    original = datetime.fromtimestamp(value / 1000, ZoneInfo("Asia/Manila"))
    for _ in range(count):
        value = next_month_at(value, "Asia/Manila", original.day)
    return value


def activity_digest(branch):
    # Derived analytics and processor bookkeeping are deliberately excluded.
    data = {k: branch.get(k) for k in ("categories", "inventory", "logs", "deletedLogs", "users", "kiosks", "inventoryHistory", "menuLogs")}
    def clean(value):
        if isinstance(value, dict):
            return {k: clean(v) for k, v in value.items() if k not in {
                "lastActiveAt", "lastSeenAt", "analyticsProcessed", "inventoryProcessed", "updatedAt", "lastModifiedAt", "available"}}
        if isinstance(value, list):
            return [clean(v) for v in value]
        return value
    return hashlib.sha256(json.dumps(clean(data), sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def branch_state(branch, now):
    return {"status": "active", "lastActivityAt": now, "activityDigest": activity_digest(branch),
            "initializedAt": now, **(branch.get("lifecycle") or {})}


def assert_open(branch):
    if (branch.get("lifecycle") or {}).get("status") in BLOCKED or (branch.get("lifecycle") or {}).get("billingBlocked") is True:
        raise HTTPException(403, "Branch closure is in progress. Existing records and owner export remain available.")


def member_role(root, company, branch, uid):
    business = root.get(company) or {}
    if ((business.get("companyProfile") or {}).get("ownerUids") or {}).get(uid) is True:
        return "owner"
    return (((business.get("branches") or {}).get(branch) or {}).get("users") or {}).get(uid, {}).get("role")


def require_owner(root, company, uid):
    if (((root.get(company) or {}).get("companyProfile") or {}).get("ownerUids") or {}).get(uid) is not True:
        raise HTTPException(403, "Only the business owner can perform this action")


def prune_associations(root, company, branch):
    """Remove references only for this branch, preserving other businesses/branches."""
    business = root.get(company) or {}
    remaining = business.get("branches") or {}
    uids = set((business.get("users") or {}))
    uids.update(uid for uid, account in (root.get("accounts") or {}).items() if account.get("companyId") == company)
    for uid in uids:
        member = (business.get("users") or {}).get(uid) or {}
        for container in (member, member.get("workspace") or {}, ((root.get("users") or {}).get(uid) or {}).get("workspace") or {}):
            for key in ("branches", "branchIds"):
                if isinstance(container.get(key), dict):
                    container[key].pop(branch, None)
            if container.get("branchId") == branch:
                alternatives = [b for b in (container.get("branchIds") or container.get("branches") or {}) if b in remaining]
                container["branchId"] = alternatives[0] if alternatives else ""
        associations = [b for b, value in remaining.items() if uid in (value.get("users") or {})]
        if member_role(root, company, next(iter(remaining), ""), uid) == "owner":
            associations = list(remaining)
        account = (root.get("accounts") or {}).get(uid) or {}
        if account.get("companyId") == company and account.get("activeBranchId") == branch:
            if associations:
                account["activeBranchId"] = associations[0]
            else:
                root["accounts"].pop(uid, None)
        if not associations:
            (business.get("users") or {}).pop(uid, None)
            other_association = any(uid in (v.get("users") or {}) or
                ((v.get("companyProfile") or {}).get("ownerUids") or {}).get(uid) for k, v in root.items()
                if k.startswith("company-") and k != company and isinstance(v, dict))
            if other_association and account.get('companyId') == company:
                for other_id, other in root.items():
                    if not other_id.startswith('company-') or other_id == company or not isinstance(other, dict):
                        continue
                    owned = ((other.get('companyProfile') or {}).get('ownerUids') or {}).get(uid) is True
                    accessible = [b for b, v in (other.get('branches') or {}).items() if owned or uid in (v.get('users') or {})]
                    if accessible:
                        role = 'owner' if owned else other['branches'][accessible[0]]['users'][uid].get('role', 'staff')
                        root.setdefault('accounts', {})[uid] = {'uid': uid, 'companyId': other_id, 'activeBranchId': accessible[0], 'role': role}
                        break
            if not other_association:
                # Persist an outbox before external Auth deletion; retry after interruptions.
                root.setdefault("lifecycleAuthCleanup", {})[uid] = {"state": "pending", "companyId": company}
                (root.get("users") or {}).pop(uid, None)
    for uid, enrollment in list((root.get("kioskEnrollments") or {}).items()):
        if enrollment.get("companyId") == company and enrollment.get("branchId") == branch:
            root["kioskEnrollments"].pop(uid, None)
            (business.get("kiosks") or {}).pop(uid, None)
            for user in (root.get("users") or {}).values():
                (user.get("kiosks") or {}).pop(uid, None)
            for member in (business.get("users") or {}).values():
                (member.get("kiosks") or {}).pop(uid, None)
            root.setdefault("lifecycleAuthCleanup", {})[uid] = {"state": "pending", "companyId": company}


def purge_branch(root, company, branch, now, operator):
    """Called only inside a transaction after locking and reservation reconciliation."""
    business = root.get(company) or {}
    value = (business.get("branches") or {}).get(branch)
    if not value:
        return
    for order_id, order in (value.get("logs") or {}).items():
        if order.get("paymentStatus") == "REFUND_PENDING":
            root.setdefault("lifecyclePaymentHolds", {}).setdefault(company, {}).setdefault(branch, {})[order_id] = {
                "orderId": order_id, "paymentId": order.get("providerPaymentId", ""),
                "amount": order.get("total", order.get("totalAmount", 0)), "status": "unresolved",
                "operator": operator, "reason": "Unresolved refund at deletion", "reviewAt": now + 30 * DAY,
                "createdAt": now,
            }
    # Keep unresolved refunds minimal, never raw customer/provider payloads.
    for order_id, record in (((root.get("paymentRefunds") or {}).get(company) or {}).get(branch) or {}).items():
        if record.get("status") not in {"succeeded", "failed", "cancelled"}:
            root.setdefault("lifecyclePaymentHolds", {}).setdefault(company, {}).setdefault(branch, {})[order_id] = {
                "orderId": order_id, "paymentId": record.get("paymentId", ""), "status": "unresolved",
                "operator": operator, "reason": "Unresolved provider refund", "reviewAt": now + 30 * DAY, "createdAt": now,
            }
    for order_id in (value.get("paymentReservations") or {}):
        for key in ("paymentCheckoutSecrets", "paymentReservationIndex"):
            (root.get(key) or {}).pop(order_id, None)
    for intent_id, record in list((root.get("paymentIntentIndex") or {}).items()):
        if record.get("companyId") == company and record.get("branchId") == branch:
            root["paymentIntentIndex"].pop(intent_id, None)
    for event_id, receipt in list((root.get("paymentWebhookEvents") or {}).items()):
        if receipt.get("companyId") == company and receipt.get("branchId") == branch:
            root["paymentWebhookEvents"].pop(event_id, None)
    # Revoke exports that contain this branch; cleanup retries private object deletion.
    for record in (root.get("lifecycleExports") or {}).values():
        if record.get("companyId") == company and (not record.get("branchId") or record.get("branchId") == branch):
            record.update(expiresAt=0, revokedAt=now)
    ((root.get("aiControls") or {}).get("branches") or {}).pop(f"{company}_{branch}",None)
    business["branches"].pop(branch, None)
    for key in PRIVATE_ROOTS:
        ((root.get(key) or {}).get(company) or {}).pop(branch, None)
    root.setdefault("deletionTombstones", {}).setdefault(company, {})[branch] = {"deletedAt": now}
    prune_associations(root, company, branch)
    if not business.get("branches"):
        (root.get("paymentMerchantConnections") or {}).pop(company, None)
        for key, record in list((root.get("paymentConnectionIndex") or {}).items()):
            if record == company:
                root["paymentConnectionIndex"].pop(key, None)
        root.pop(company, None)
        root.setdefault("deletionTombstones", {}).setdefault(company, {})["_business"] = {"deletedAt": now}


class LifecycleService:
    def __init__(self, db, *, clock=utc_ms, mailer=None, storage=None, auth=None, destructive=False):
        self.db, self.clock, self.mailer, self.storage, self.auth = db, clock, mailer, storage, auth
        self.destructive = destructive

    def _transaction(self, change, lease_id=None):
        started = time.monotonic()
        attempts = 0
        snapshot_bytes = 0
        def apply(current):
            nonlocal attempts, snapshot_bytes
            attempts += 1
            now = self.clock()
            root = copy.deepcopy(current or {})
            snapshot_bytes = len(json.dumps(root, separators=(",", ":")).encode())
            lease = root.get('lifecycleJobStatus') or {}
            if lease_id and (lease.get('leaseId') != lease_id or lease.get('leaseUntil', 0) <= now):
                raise HTTPException(409, 'Lifecycle job lease was lost; retry the job')
            change(root, now)
            return root
        try:
            return self.db.reference("/").transaction(apply)
        finally:
            # Metrics contain sizes/counts only, never business/customer payloads.
            LOGGER.info('lifecycle_transaction bytes=%s attempts=%s duration_ms=%s', snapshot_bytes, attempts,
                        round((time.monotonic() - started)*1000))

    def status(self, uid, company, branch):
        validate_branch_id(company, branch)
        root = self.db.reference("/").get() or {}
        if not member_role(root, company, branch, uid):
            raise HTTPException(403, "Branch membership required")
        value = ((root.get(company) or {}).get("branches") or {}).get(branch)
        if not value:
            raise HTTPException(404, "Branch not found")
        return {**branch_state(value, self.clock()), "companyClosing": (root[company].get("lifecycle") or {}).get("status") == "closing"}

    def activity(self, uid, company, branch, kind="visit"):
        validate_branch_id(company, branch)
        def change(root, now):
            role = member_role(root, company, branch, uid)
            if role not in ({"owner", "manager"} if kind == "visit" else {"owner", "manager", "staff"}):
                raise HTTPException(403, "Activity is not authorized")
            value = ((root.get(company) or {}).get("branches") or {}).get(branch)
            if not value:
                raise HTTPException(404, "Branch not found")
            state = branch_state(value, now)
            if state.get("status") in BLOCKED:
                return
            digest = activity_digest(value)
            if kind == "operation" and digest == state.get("activityDigest"):
                return
            value["lifecycle"] = {"status": "active", "lastActivityAt": now, "activityDigest": digest,
                                  "initializedAt": state.get("initializedAt", now), "billingBlocked": state.get("billingBlocked", False)}
        self._transaction(change)
        return self.status(uid, company, branch)

    def cancel(self, uid, company, branch):
        validate_branch_id(company, branch)
        def change(root, now):
            require_owner(root, company, uid)
            if not ((root[company].get("branches") or {}).get(branch)):
                raise HTTPException(404, "Branch not found")
            entitlement = ((root.get("billingEntitlements") or {}).get(company) or {}).get(branch)
            if not entitlement:
                raise HTTPException(409, "Subscription record missing")
            if entitlement.get("subscriptionStatus") == "cancelled":
                return
            entitlement.update(subscriptionStatus="cancelled", cancelledAt=now, updatedAt=now)
            value = root[company]['branches'][branch]
            value['lifecycle'] = branch_state(value, now)
            value['lifecycle']['billingBlocked'] = True
            root.setdefault("lifecycleAudit", {}).setdefault(company, {}).setdefault(branch, {})[f"cancel-{now}"] = {
                "action": "subscription_cancelled", "at": now, "actorUid": uid}
        self._transaction(change)
        return {"status": "cancelled", "refundIssued": False}

    def close(self, uid, company, branch=None):
        if branch:
            validate_branch_id(company, branch)
        elif not company.startswith("company-"):
            raise HTTPException(400, "Invalid business")
        def change(root, now):
            require_owner(root, company, uid)
            business = root[company]
            branches = business.get("branches") or {}
            targets = [branch] if branch else list(branches)
            if not targets or any(b not in branches for b in targets):
                raise HTTPException(404, "Branch not found")
            for b in targets:
                value = branches[b]
                state = branch_state(value, now)
                if state.get("status") == "deleting":
                    raise HTTPException(409, "Deletion has started")
                if state.get("status") == "closing":
                    if not branch:
                        state["closureScope"] = "business"
                        value["lifecycle"] = state
                    continue
                state.update(status="closing", closeRequestedAt=now, deleteAt=now + 30 * DAY, requestedBy=uid, closureScope="branch" if branch else "business")
                value["lifecycle"] = state
            if not branch:
                business["lifecycle"] = business.get("lifecycle") if (business.get("lifecycle") or {}).get("status") == "closing" else {"status": "closing", "deleteAt": now + 30 * DAY}
            # Branch lifecycle is checked atomically by checkout, so retain enrollment
            # state for recovery instead of silently re-enabling revoked devices.
        self._transaction(change)
        return {"status": "closing"}

    def recover(self, uid, company, branch=None):
        def change(root, now):
            require_owner(root, company, uid)
            business = root[company]
            if branch and (business.get("lifecycle") or {}).get("status") == "closing":
                raise HTTPException(409, "Recover the whole business together")
            targets = [branch] if branch else list(business.get("branches") or {})
            for b in targets:
                value = (business.get("branches") or {}).get(b)
                if not value:
                    raise HTTPException(404, "Branch not found")
                state = branch_state(value, now)
                if state.get("status") == "deleting" or (state.get("status") == "closing" and now >= state.get("deleteAt", 0)):
                    raise HTTPException(409, "Recovery period has ended")
                value["lifecycle"] = {"status": "active", "lastActivityAt": now, "activityDigest": activity_digest(value),
                                      "initializedAt": state.get("initializedAt", now), "billingBlocked": state.get("billingBlocked", False)}
            if not branch:
                business["lifecycle"] = {"status": "active"}
        self._transaction(change)
        return {"status": "active", "subscriptionExtended": False}

    def export(self, uid, company, branch=None):
        if not self.storage:
            raise HTTPException(503, "Private export storage is not configured")
        root = self.db.reference("/").get() or {}
        require_owner(root, company, uid)
        branches = (root[company].get("branches") or {})
        selected = {branch: branches[branch]} if branch in branches else branches if branch is None else None
        if selected is None:
            raise HTTPException(404, "Branch not found")
        data = {"companyId": company, "companyProfile": root[company].get("companyProfile"), "branches": {}}
        for b, value in selected.items():
            data["branches"][b] = {k: copy.deepcopy(value.get(k)) for k in (
                "branchProfile", "categories", "inventory", "logs", "deletedLogs", "users", "kiosks", "lifecycle")}
            for key in ("billingEntitlements", "subscriptionPayments", "premiumInsights", "lifecycleAudit"):
                data["branches"][b][key] = ((root.get(key) or {}).get(company) or {}).get(b)
        # A strict denylist is applied even within allowlisted datasets.
        forbidden = {"password", "pin", "pinHash", "token", "secret", "privateKey", "webhookSecret", "clientKey",
                     "verificationEvidence", "requestFingerprint", "providerPayload", "qrImage", "providerPaymentId"}
        def scrub(value):
            if isinstance(value, dict):
                return {k: scrub(v) for k, v in value.items() if k not in forbidden and not k.lower().startswith("pin") and not k.lower().endswith("pin") and not any(
                    word in k.lower() for word in ("password", "secret", "token", "credential", "privatekey"))}
            return [scrub(v) for v in value] if isinstance(value, list) else value
        data = scrub(data)
        raw = json.dumps(data, ensure_ascii=False, indent=2)
        if len(raw.encode()) > 50_000_000:
            raise HTTPException(413, "Export exceeds the safe size limit; export individual branches")
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("business.json", raw)
            archive.writestr("manifest.json", json.dumps({"formatVersion": 1, "createdAt": self.clock(),
                "companyId": company, "branchIds": list(selected), "excluded": sorted(forbidden)}))
            for b, value in data["branches"].items():
                for kind in ("logs", "deletedLogs", "categories", "inventory", "users", "kiosks", "subscriptionPayments"):
                    rows = value.get(kind) or {}
                    csv_file = io.StringIO()
                    writer = csv.writer(csv_file)
                    columns = sorted({k for record in rows.values() if isinstance(record, dict) for k in record})
                    writer.writerow(["recordId", *columns])
                    for record_id, record in rows.items():
                        record = record if isinstance(record, dict) else {"value": record}
                        cells = [str(record_id)] + [json.dumps(record.get(k), ensure_ascii=False) if isinstance(record.get(k), (dict, list))
                            else str(record.get(k, "")) for k in columns]
                        writer.writerow(["'" + c if c.startswith(("=", "+", "-", "@")) else c for c in cells])
                    archive.writestr(f"{b}/{kind}.csv", csv_file.getvalue())
        content = buffer.getvalue()
        if len(content) > 50_000_000:
            raise HTTPException(413, "Export exceeds the safe size limit; export individual branches")
        export_id = str(uuid.uuid4())
        self.storage.put(f"exports/{export_id}", content)
        self.db.reference(f"lifecycleExports/{export_id}").set({"uid": uid, "companyId": company,
            "branchId": branch or "", "branchIds": list(selected), "expiresAt": self.clock() + DAY})
        return {"exportId": export_id, "expiresAt": self.clock() + DAY, "status": "ready"}

    def download(self, uid, export_id):
        if not self.storage:
            raise HTTPException(503, "Export storage unavailable")
        if not isinstance(export_id, str) or not all(c in "0123456789abcdef-" for c in export_id):
            raise HTTPException(400, "Invalid export identifier")
        record = self.db.reference(f"lifecycleExports/{export_id}").get() or {}
        if record.get("uid") != uid or record.get("expiresAt", 0) <= self.clock():
            raise HTTPException(404, "Export unavailable or expired")
        root = self.db.reference("/").get() or {}
        require_owner(root, record["companyId"], uid)
        branches = (root[record["companyId"]].get("branches") or {})
        if any(branch not in branches for branch in record.get("branchIds", [record.get("branchId")]) if branch):
            raise HTTPException(404, "Export contains deleted records")
        return self.storage.get(f"exports/{export_id}")

    def run(self, *, company=None, branch=None, dry_run=True, operator="scheduled-job"):
        if dry_run:
            return self._run(company=company, branch=branch, dry_run=True, operator=operator)
        lease_id = str(uuid.uuid4())
        now = self.clock()
        def claim(current):
            current = copy.deepcopy(current or {})
            if current.get('leaseUntil', 0) > now:
                return current
            current.update(leaseId=lease_id, leaseUntil=now + 15 * 60_000, startedAt=now, operator=operator)
            return current
        lease = self.db.reference('lifecycleJobStatus').transaction(claim)
        if lease.get('leaseId') != lease_id:
            raise HTTPException(409, 'Another lifecycle job is running')
        try:
            return self._run(company=company, branch=branch, dry_run=False, operator=operator, lease_id=lease_id)
        finally:
            def release(current):
                if current and current.get('leaseId') == lease_id:
                    current = copy.deepcopy(current)
                    current['leaseUntil'] = 0
                return current
            self.db.reference('lifecycleJobStatus').transaction(release)

    def _run(self, *, company=None, branch=None, dry_run=True, operator="scheduled-job", lease_id=None):
        now = self.clock()
        snapshot = self.db.reference("/").get() or {}
        report = []
        preview = copy.deepcopy(snapshot)
        for c, business in snapshot.items():
            if not c.startswith("company-") or (company and c != company):
                continue
            for b, value in (business.get("branches") or {}).items():
                if branch and b != branch:
                    continue
                state = branch_state(value, now)
                due = now >= add_months(state["lastActivityAt"], 12)
                deletion_due = state['status'] in {'closing','inactivity_grace','deleting'} and now >= state.get('deleteAt', now+1)
                pending = sum(r.get('status') not in FINAL_PAYMENT for r in (value.get('paymentReservations') or {}).values())
                entry = {"companyId": c, "branchId": b, "status": state["status"],
                         "warningDue": due, "deleteAt": state.get("deleteAt"), "deletionDue": deletion_due,
                         "pendingReservations": pending}
                if deletion_due and not pending:
                    before_cleanup = set(preview.get('lifecycleAuthCleanup') or {})
                    purge_branch(preview, c, b, now, operator)
                    entry['deletionManifest'] = {
                        'branchPath': f'{c}/branches/{b}',
                        'recordCounts': {k:len(value.get(k) or {}) for k in ('categories','inventory','logs','deletedLogs','users','kiosks')},
                        'managedAccountCleanup': sorted(set(preview.get('lifecycleAuthCleanup') or {}) - before_cleanup),
                        'businessRemoved': c not in preview,
                        'paymentHolds': len(((preview.get('lifecyclePaymentHolds') or {}).get(c) or {}).get(b) or {}),
                        'privateDataPaths': [f'{key}/{c}/{b}' for key in PRIVATE_ROOTS],
                    }
                report.append(entry)
                if dry_run:
                    continue
                def heartbeat(current):
                    if not current or current.get('leaseId') != lease_id or current.get('leaseUntil', 0) <= self.clock():
                        raise HTTPException(409, 'Lifecycle job lease was lost')
                    current = copy.deepcopy(current)
                    current.update(leaseUntil=self.clock() + 15*60_000, checkpoint={'companyId':c,'branchId':b,'at':self.clock()})
                    return current
                self.db.reference('lifecycleJobStatus').transaction(heartbeat)
                self._advance(c, b, operator, lease_id)
        if not dry_run:
            self._clean_exports_and_auth()
            self.db.reference('lifecycleJobStatus/lastCompletedAt').set(self.clock())
        return report

    def _advance(self, company, branch, operator, lease_id=None):
        def prepare(root, now):
            value = ((root.get(company) or {}).get("branches") or {}).get(branch)
            if not value:
                return
            state = branch_state(value, now)
            value["lifecycle"] = state
            digest = activity_digest(value)
            if state["status"] not in BLOCKED and digest != state.get("activityDigest"):
                value["lifecycle"] = {"status": "active", "lastActivityAt": now, "activityDigest": digest,
                                      "initializedAt": state.get("initializedAt", now), "billingBlocked": state.get("billingBlocked", False)}
                return
            if state["status"] == "active" and now >= add_months(state["lastActivityAt"], 12):
                state.update(status="warning_pending", warningId=str(state["lastActivityAt"]), attempts=0)
        self._transaction(prepare, lease_id)
        value = self.db.reference(f"{company}/branches/{branch}").get() or {}
        state = value.get("lifecycle") or {}
        if state.get("status") == "warning_pending" and self.mailer:
            warning_lease_id = str(uuid.uuid4())
            def lease(current):
                current = copy.deepcopy(current or {})
                if current.get("status") != "warning_pending" or current.get("leaseUntil", 0) > self.clock() or current.get("attempts", 0) >= 5:
                    return current
                current.update(leaseId=warning_lease_id, leaseUntil=self.clock() + 10 * 60_000,
                               attempts=current.get("attempts", 0) + 1)
                return current
            claimed = self.db.reference(f"{company}/branches/{branch}/lifecycle").transaction(lease)
            if claimed.get("leaseId") == warning_lease_id:
                emails = self._owner_emails(company)
                try:
                    if not emails:
                        raise RuntimeError("No owner email address available")
                    for email in emails:
                        self.mailer.send(email, company, branch, claimed["warningId"])
                except Exception as error:
                    LOGGER.warning('lifecycle_warning_failed error_type=%s', type(error).__name__)
                    def failed(current):
                        if current and current.get('leaseId') == warning_lease_id:
                            current = copy.deepcopy(current)
                            current['warningDeliveryFailed'] = True
                        return current
                    self.db.reference(f'{company}/branches/{branch}/lifecycle').transaction(failed)
                    return
                def accepted(root, now):
                    branch_value = ((root.get(company) or {}).get("branches") or {}).get(branch) or {}
                    current = branch_value.get("lifecycle") or {}
                    if current.get("leaseId") == warning_lease_id and current.get("status") == "warning_pending":
                        current.update(status="inactivity_grace", warningAcceptedAt=now, deleteAt=add_months(now, 1))
                        current.pop("leaseUntil", None)
                        current.pop("warningDeliveryFailed", None)
                self._transaction(accepted, lease_id)
        def lock_or_purge(root, now):
            value = ((root.get(company) or {}).get("branches") or {}).get(branch)
            if not value:
                return
            state = value.get("lifecycle") or {}
            if state.get("status") not in {"inactivity_grace", "closing", "deleting"} or now < state.get("deleteAt", now + 1):
                return
            if not self.destructive:
                return
            if state["status"] == "inactivity_grace" and activity_digest(value) != state.get("activityDigest"):
                value["lifecycle"] = {"status": "active", "lastActivityAt": now, "activityDigest": activity_digest(value)}
                return
            state.update(status="deleting", deletionStartedAt=state.get("deletionStartedAt", now))
            reservations = value.get("paymentReservations") or {}
            if any(r.get("status") not in FINAL_PAYMENT for r in reservations.values()):
                state["blockedReason"] = "Payment reconciliation required"
                return
            purge_branch(root, company, branch, now, operator)
        self._transaction(lock_or_purge, lease_id)

    def _owner_emails(self, company):
        business = self.db.reference(company).get() or {}
        result = []
        for uid in (business.get("companyProfile") or {}).get("ownerUids") or {}:
            record = (business.get("users") or {}).get(uid) or {}
            if not record.get("email") and self.auth:
                try:
                    record = {"email": self.auth.get_user(uid).email}
                except Exception:
                    continue
            if record.get("email"):
                result.append(record["email"])
        return sorted(set(result))

    def _clean_exports_and_auth(self):
        from touchorders_core.api.insight_retention import purge_insights
        purge_insights(self.db,self.clock())
        for key, record in (self.db.reference("lifecycleExports").get() or {}).items():
            if record.get("expiresAt", 0) <= self.clock() and self.storage:
                self.storage.delete(f"exports/{key}")
                self.db.reference(f"lifecycleExports/{key}").delete()
        for company, branches in (self.db.reference("lifecyclePaymentHolds").get() or {}).items():
            for branch, holds in branches.items():
                for order_id, record in holds.items():
                    if record.get("status") == "resolved" and record.get("purgeAt", self.clock() + 1) <= self.clock():
                        self.db.reference(f"lifecyclePaymentHolds/{company}/{branch}/{order_id}").delete()
                    elif record.get("reviewAt", self.clock() + 1) <= self.clock():
                        self.db.reference(f"lifecyclePaymentHolds/{company}/{branch}/{order_id}/reviewOverdue").set(True)
        if not self.auth:
            return
        for uid in (self.db.reference("lifecycleAuthCleanup").get() or {}):
            root = self.db.reference("/").get() or {}
            # Recheck associations after deletion, before revocation/removal.
            if any(uid in (v.get("users") or {}) or ((v.get("companyProfile") or {}).get("ownerUids") or {}).get(uid)
                   for c, v in root.items() if c.startswith("company-") and isinstance(v, dict)):
                self.db.reference(f"lifecycleAuthCleanup/{uid}").delete()
                continue
            try:
                self.auth.revoke_refresh_tokens(uid)
                self.auth.delete_user(uid)
            except Exception as exc:
                if exc.__class__.__name__ != "UserNotFoundError":
                    LOGGER.warning('lifecycle_auth_cleanup_retry error_type=%s', type(exc).__name__)
                    continue
            self.db.reference(f"lifecycleAuthCleanup/{uid}").delete()

    def resolve_hold(self, company, branch, order_id, operator, reason, *, release=False):
        validate_branch_id(company, branch)
        if not operator.strip() or not reason.strip() or "/" in order_id:
            raise ValueError("Operator, reason and valid order ID required")
        record = self.db.reference(f"lifecyclePaymentHolds/{company}/{branch}/{order_id}")
        def change(current):
            if not current:
                raise ValueError("Hold not found")
            current = copy.deepcopy(current)
            current.update(operator=operator, reason=reason, reviewAt=self.clock() + 30 * DAY)
            if release:
                current.update(status="resolved", purgeAt=self.clock() + 30 * DAY)
            return current
        return record.transaction(change)
