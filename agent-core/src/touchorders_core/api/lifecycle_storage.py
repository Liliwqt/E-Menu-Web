"""Private encrypted lifecycle objects and Gmail notification adapter."""
from __future__ import annotations

import base64
import json
import os
import smtplib
import ssl
from email.message import EmailMessage
from datetime import datetime, timezone

from cryptography.fernet import Fernet
from fastapi import HTTPException


class GmailMailer:
    def __init__(self, address, app_password):
        if address != "touch.support1@gmail.com" or not app_password:
            raise ValueError("Configure the support Gmail and a dedicated app password")
        self.address, self.password = address, app_password

    def send(self, recipient, company, branch, warning_id):
        if "\n" in recipient or "\r" in recipient:
            raise ValueError("Invalid recipient")
        message = EmailMessage()
        message["From"], message["To"] = self.address, recipient
        message["Subject"] = "Touch: inactive branch — download your records or resume activity"
        message["Message-ID"] = f"<touch-{company}-{branch}-{warning_id}@gmail.com>"
        message.set_content(f"Branch {branch} in {company} has been inactive for 12 months. "
            "After this warning is accepted for delivery you have one additional calendar month "
            "to download your records or resume activity. Sign in to the branch to see its exact "
            "deletion date and export your records. Contact touch.support1@gmail.com for help.")
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30, context=ssl.create_default_context()) as smtp:
            smtp.login(self.address, self.password)
            refused = smtp.send_message(message)
            if refused:
                raise RuntimeError("Warning recipient refused")


class PrivateLifecycleStorage:
    def __init__(self, bucket, key):
        self.bucket = bucket
        self.cipher = Fernet(key.encode() if isinstance(key, str) else key)

    def verify_configuration(self):
        self.bucket.reload()
        if not self.bucket.iam_configuration.uniform_bucket_level_access_enabled:
            raise ValueError("Enable uniform bucket access")
        if self.bucket.iam_configuration.public_access_prevention != "enforced":
            raise ValueError("Enforce public access prevention")
        if self.bucket.versioning_enabled:
            raise ValueError("Disable bucket object versioning for bounded retention")
        soft_delete = getattr(self.bucket, "soft_delete_policy", None)
        if soft_delete and soft_delete.retention_duration_seconds:
            raise ValueError("Disable soft delete to avoid extending backup retention")
        rules = list(self.bucket.lifecycle_rules)
        if not any(r.get("action", {}).get("type") == "Delete" and r.get("condition", {}).get("age") == 30
                   and not any(k != "age" for k in r.get("condition", {})) for r in rules):
            raise ValueError("Configure an unconditional 30-day object deletion lifecycle")
        if getattr(self.bucket, "retention_period", None):
            raise ValueError("Bucket retention lock must not prevent expiry")
        policy = self.bucket.get_iam_policy(requested_policy_version=3)
        if any(m in {"allUsers", "allAuthenticatedUsers"} for b in policy.bindings for m in b.get("members", [])):
            raise ValueError("Bucket must not have public IAM access")
        return True

    def put(self, name, content):
        self.verify_configuration()
        blob = self.bucket.blob(name)
        blob.cache_control = "private, no-store"
        blob.upload_from_string(self.cipher.encrypt(content), content_type="application/octet-stream", if_generation_match=0)

    def get(self, name):
        self.verify_configuration()
        blob = self.bucket.blob(name)
        blob.reload()
        age = (datetime.now(timezone.utc) - blob.time_created).total_seconds()
        if age >= (86400 if name.startswith("exports/") else 30 * 86400):
            raise HTTPException(404, "Private object expired")
        return self.cipher.decrypt(blob.download_as_bytes())

    def delete(self, name):
        blob = self.bucket.blob(name)
        if blob.exists():
            blob.reload()
            blob.delete(if_generation_match=blob.generation)

    def expire(self, now):
        for blob in self.bucket.list_blobs():
            age = (datetime.fromtimestamp(now / 1000, timezone.utc) - blob.time_created).total_seconds()
            if age >= (86400 if blob.name.startswith("exports/") else 30 * 86400):
                blob.delete(if_generation_match=blob.generation)

    def backup(self, db, now):
        snapshot = db.reference("/").get() or {}
        snapshot.pop("lifecycleExports", None)
        name = f"backups/{datetime.fromtimestamp(now / 1000, timezone.utc).strftime('%Y-%m-%d')}.json.enc"
        blob = self.bucket.blob(name)
        if not blob.exists():
            self.put(name, json.dumps(snapshot, separators=(",", ":")).encode())
        self.expire(now)
        return name


def restore_snapshot(snapshot, current):
    """Merge current tombstones first and preserve restrictive states/expiry.

    Restore is allowed only during operator maintenance; never restore export
    links, stale Auth cleanup jobs or an older subscription over a current one.
    """
    import copy
    from touchorders_core.api.lifecycle import prune_associations, purge_branch
    result = copy.deepcopy(snapshot)
    tombstones = copy.deepcopy(snapshot.get("deletionTombstones") or {})
    for company, records in (current.get("deletionTombstones") or {}).items():
        tombstones.setdefault(company, {}).update(records)
    result["deletionTombstones"] = tombstones
    for company, records in tombstones.items():
        branches = set(records) - {"_business"}
        if "_business" in records:
            branches.update(((result.get(company) or {}).get("branches") or {}))
        for branch in branches:
            purge_branch(result, company, branch, records.get(branch, records.get("_business", {})).get("deletedAt", 0), "restore-filter")
        if "_business" in records:
            result.pop(company, None)
    for key in ("billingEntitlements", "lifecyclePaymentHolds", "subscriptionPaymentRefs"):
        if key in current:
            result[key] = copy.deepcopy(current[key])
    for company, value in current.items():
        if not company.startswith("company-") or company not in result:
            continue
        if value.get("lifecycle"):
            result[company]["lifecycle"] = copy.deepcopy(value["lifecycle"])
        for branch, record in (value.get("branches") or {}).items():
            target = (result[company].get("branches") or {}).get(branch)
            if target and record.get("lifecycle"):
                target["lifecycle"] = copy.deepcopy(record["lifecycle"])
    result.pop("lifecycleExports", None)
    result["lifecycleAuthCleanup"] = copy.deepcopy(current.get("lifecycleAuthCleanup") or {})
    result["lifecycleMaintenance"] = {"enabled": True}
    # A second tombstone pass strips any entitlement copied from current above.
    for company, records in tombstones.items():
        for branch in records:
            ((result.get("billingEntitlements") or {}).get(company) or {}).pop(branch, None)
    return result


def configured_adapters(db):
    from firebase_admin import storage, auth
    mailer = None
    if os.environ.get("TOUCH_LIFECYCLE_GMAIL_APP_PASSWORD"):
        mailer = GmailMailer("touch.support1@gmail.com", os.environ["TOUCH_LIFECYCLE_GMAIL_APP_PASSWORD"])
    objects = None
    if os.environ.get("TOUCH_LIFECYCLE_BUCKET") and os.environ.get("TOUCH_LIFECYCLE_ENCRYPTION_KEY"):
        objects = PrivateLifecycleStorage(storage.bucket(os.environ["TOUCH_LIFECYCLE_BUCKET"]), os.environ["TOUCH_LIFECYCLE_ENCRYPTION_KEY"])
    return mailer, objects, auth
