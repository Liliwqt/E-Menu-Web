"""Server-side branch membership, AI tier and metered usage checks."""

from __future__ import annotations

import re
import time
from touchorders_core.observability.privacy import safe_input
from dataclasses import dataclass

from fastapi import HTTPException

from touchorders_core.billing import (
    AI_ALLOWANCE,
    PREMIUM_MODES,
    STARTER_MODES,
    current_period_start,
)

_ID = re.compile(r"^(?:company|branch)-[a-z0-9-]+$")
_REQUEST = re.compile(r"^[0-9a-f-]{36}$")


@dataclass(frozen=True)
class AiGrant:
    company: str
    branch: str
    plan: str
    period_start: int


class FirebaseEntitlementService:
    def __init__(self, database, *, clock=None):
        self.db = database
        self.clock = clock or (lambda: int(time.time() * 1000))

    def authorize(self, *, uid: str, company: str, branch: str, mode: str) -> AiGrant:
        if not _ID.fullmatch(company) or not _ID.fullmatch(branch):
            raise HTTPException(400, "Invalid branch or request identifier")
        if self.db.reference(
            "lifecycleMaintenance/enabled"
        ).get() is True or self.db.reference(
            f"{company}/branches/{branch}/lifecycle/status"
        ).get() in {
            "closing",
            "deleting",
            "deleted",
        }:
            raise HTTPException(403, "Branch closure or maintenance is in progress")
        lifecycle = (
            self.db.reference(f"{company}/branches/{branch}/lifecycle").get() or {}
        )
        if lifecycle.get("billingBlocked") is True:
            raise HTTPException(403, "Branch billing is blocked")
        if not self.db.reference(f"{company}/branches/{branch}/branchProfile").get():
            raise HTTPException(403, "Branch is unavailable")
        owner = (
            self.db.reference(f"{company}/companyProfile/ownerUids/{uid}").get() is True
        )
        manager = (
            self.db.reference(f"{company}/branches/{branch}/users/{uid}/role").get()
            == "manager"
        )
        member = self.db.reference(f"{company}/users/{uid}").get()
        if not member or not (owner or manager):
            raise HTTPException(
                403, "Branch AI access is restricted to owners and managers"
            )
        if (
            self.db.reference(f"{company}/lifecycle/status").get()
            in {"closing", "deleting", "deleted"}
            or self.db.reference(f"deletionTombstones/{company}/{branch}").get()
        ):
            raise HTTPException(403, "Branch access is unavailable")
        entitlement = self.db.reference(f"billingEntitlements/{company}/{branch}").get()
        now = self.clock()
        if (
            not entitlement
            or entitlement.get("subscriptionStatus") not in ("trialing", "active")
            or int(entitlement.get("periodEndAt") or 0) <= now
        ):
            raise HTTPException(403, "Branch subscription is expired or unavailable")
        plan = entitlement.get("plan")
        modes = (
            PREMIUM_MODES
            if plan == "premium"
            else STARTER_MODES if plan == "starter" else set()
        )
        if mode not in modes:
            raise HTTPException(403, "This AI feature requires a higher plan")
        profile = (
            self.db.reference(f"{company}/branches/{branch}/branchProfile").get() or {}
        )
        period_start = current_period_start(
            entitlement, now, profile.get("timezone") or "Asia/Manila"
        )
        return AiGrant(company, branch, plan, period_start)

    def _control(self, uid, grant, request_id, acquire, *, count_attempt=True):
        from hashlib import sha256

        actor = sha256(uid.encode()).hexdigest()
        scope = f"{grant.company}_{grant.branch}"
        lease_key = actor + "_" + request_id
        now = self.clock()
        denied = {"value": False}

        def change(value):
            denied["value"] = False
            value = value or {"actors": {}, "branches": {}}
            # Controls contain no content. Prune idle entries and expired leases on every claim.
            for root in ("actors", "branches"):
                for key, row in list(value.get(root, {}).items()):
                    row["attempts"] = [
                        at for at in row.get("attempts", []) if at > now - 60000
                    ]
                    row["pending"] = {
                        key: at
                        for key, at in row.get("pending", {}).items()
                        if at > now
                    }
                    if not row["attempts"] and not row["pending"]:
                        value[root].pop(key)
            rows = [
                value.setdefault("actors", {}).setdefault(
                    actor, {"attempts": [], "pending": {}}
                ),
                value.setdefault("branches", {}).setdefault(
                    scope, {"attempts": [], "pending": {}}
                ),
            ]
            if acquire is False:
                for row in rows:
                    row["pending"].pop(lease_key, None)
                return value
            if any(
                (count_attempt and len(row["attempts"]) >= attempts)
                or (acquire and len(row["pending"]) >= pending)
                for row, attempts, pending in zip(rows, (6, 20), (1, 2))
            ):
                denied["value"] = True
                for row, limit in zip(rows, (6, 20)):
                    if count_attempt and len(row["attempts"]) < limit:
                        row["attempts"].append(now)
                return value
            for row in rows:
                if count_attempt:
                    row["attempts"].append(now)
                if acquire:
                    row["pending"][lease_key] = now + 180000
            return value

        self.db.reference("aiControls").transaction(change)
        if denied["value"]:
            raise HTTPException(
                429, "AI is busy; wait before requesting another response"
            )

    def check_attempt(self, uid, grant):
        # Cache hits and duplicate lookups have the same authenticated request limit.
        self._control(uid, grant, "", None)

    def record_cached_request(self, grant, uid, request_id, fingerprint):
        from uuid import uuid4

        token = str(uuid4())
        record = self.db.reference(
            f"aiRequests/{grant.company}/{grant.branch}/{request_id}"
        ).transaction(
            lambda value: value
            or dict(
                uid=uid,
                fingerprint=fingerprint,
                state="completed_cached",
                periodStart=grant.period_start,
                plan=grant.plan,
                at=self.clock(),
                claim=token,
            )
        )
        if record.get("claim") != token:
            raise HTTPException(409, "AI request identifier already used")

    def reserve(
        self,
        *,
        uid,
        company,
        branch,
        mode,
        request_id,
        fingerprint="",
        count_attempt=True,
    ):
        from uuid import UUID

        try:
            if str(UUID(request_id)) != request_id:
                raise ValueError()
        except (ValueError, TypeError):
            raise HTTPException(400, "Invalid request identifier")
        grant = self.authorize(uid=uid, company=company, branch=branch, mode=mode)
        if (
            self.db.reference(f"aiRequests/{company}/{branch}/{request_id}").get()
            or self.db.reference(
                f"aiUsage/{company}/{branch}/{grant.period_start}/requests/{request_id}"
            ).get()
        ):
            raise HTTPException(409, "AI request identifier already used")
        self._control(uid, grant, request_id, True, count_attempt=count_attempt)
        usage = self.db.reference(f"aiUsage/{company}/{branch}/{grant.period_start}")
        claim = {"new": False, "duplicate": False}
        now = self.clock()

        def reserve_value(value):
            claim.update(new=False, duplicate=False)
            value = value or {"count": 0, "requests": {}}
            if request_id in value.get("requests", {}):
                claim["duplicate"] = True
                return value
            if value.get("count", 0) >= AI_ALLOWANCE[grant.plan]:
                return value
            value["count"] = value.get("count", 0) + 1
            value.setdefault("requests", {})[request_id] = dict(
                uid=uid,
                fingerprint=fingerprint,
                state="reserved",
                at=now,
                leaseUntil=now + 180000,
            )
            claim["new"] = True
            return value

        claims = self.db.reference(f"aiRequests/{company}/{branch}/{request_id}")
        token = str(UUID(request_id)) + "_" + str(__import__("uuid").uuid4())
        try:
            record = claims.transaction(
                lambda value: value
                or dict(
                    uid=uid,
                    fingerprint=fingerprint,
                    state="claiming",
                    periodStart=grant.period_start,
                    plan=grant.plan,
                    at=now,
                    leaseUntil=now + 180000,
                    claim=token,
                )
            )
            if record.get("claim") != token:
                raise HTTPException(409, "AI request identifier already used")
            usage.transaction(reserve_value)
            if not claim["new"]:
                raise HTTPException(
                    409 if claim["duplicate"] else 429,
                    (
                        "AI request identifier already used"
                        if claim["duplicate"]
                        else "Branch AI allowance reached for this period"
                    ),
                )
            claims.transaction(
                lambda value: (
                    {**value, "state": "reserved"}
                    if value and value.get("claim") == token
                    else (value or {})
                )
            )
        except BaseException:
            # Even an interrupted claim is immutable: replay cannot start another generation.
            try:
                claims.transaction(
                    lambda value: (
                        {**value, "state": "failed"}
                        if value and value.get("claim") == token
                        else (value or {})
                    )
                )
            finally:
                self._control(uid, grant, request_id, False)
            raise
        return grant

    def finish(self, grant, request_id, uid, *, state="completed", refund=False):
        usage = self.db.reference(
            f"aiUsage/{grant.company}/{grant.branch}/{grant.period_start}"
        )
        owned = {"value": False}

        def change(value):
            owned["value"] = False
            if not value:
                return {}
            row = value.get("requests", {}).get(request_id)
            if not isinstance(row, dict) or row.get("uid") != uid:
                return value
            owned["value"] = True
            if row.get("state") != "reserved":
                return value
            row["state"] = state
            row["finishedAt"] = self.clock()
            if refund:
                value["count"] = max(0, value.get("count", 0) - 1)
            return value

        usage.transaction(change)
        if owned["value"]:
            # Record terminal state across billing periods. A partial finalization never permits replay.
            terminal = usage.child(f"requests/{request_id}").get() or {}
            claim = self.db.reference(
                f"aiRequests/{grant.company}/{grant.branch}/{request_id}"
            )
            claim.transaction(
                lambda value: (
                    {
                        **value,
                        "state": terminal.get("state", "uncertain"),
                        "finishedAt": self.clock(),
                    }
                    if value and value.get("uid") == uid
                    else (value or {})
                )
            )
            self._control(uid, grant, request_id, False)

    def refund(self, grant, request_id):
        row = self.db.reference(
            f"aiUsage/{grant.company}/{grant.branch}/{grant.period_start}/requests/{request_id}"
        ).get()
        if isinstance(row, dict):
            self.finish(grant, request_id, row["uid"], state="failed", refund=True)

    def context(self, grant: AiGrant) -> list[dict]:
        from touchorders_core.api.insight_retention import valid_insight_at

        if grant.plan != "premium":
            return []
        records = (
            self.db.reference(f"premiumInsights/{grant.company}/{grant.branch}").get()
            or {}
        )
        now = self.clock()
        recent = sorted(
            (
                item
                for item in records.values()
                if valid_insight_at(item, now) is not None
            ),
            key=lambda item: int(item.get("at") or 0),
        )[-10:]
        result = []
        for item in recent:
            try:
                text = safe_input(str(item.get("summary") or ""), limit=300)
            except ValueError:
                continue
            if text:
                result.append(
                    dict(
                        at=int(item["at"]),
                        mode=(
                            item.get("mode")
                            if item.get("mode") in PREMIUM_MODES
                            else "insight"
                        ),
                        summary=text,
                    )
                )
        return result

    def remember(
        self, grant: AiGrant, *, mode: str, content: dict, request_id: str
    ) -> None:
        if grant.plan != "premium" or mode not in {"deep", "live", "briefing", "leak"}:
            return
        from touchorders_core.api.insight_retention import valid_insight_at

        insight = content.get("insight")
        text = str(
            (insight.get("message") if isinstance(insight, dict) else insight)
            or content.get("summary")
            or content.get("executiveSummary")
            or (content.get("shiftHandoff") or {}).get("operationalInsight")
            or ""
        ).strip()
        try:
            text = safe_input(text, limit=300)
        except ValueError:
            return
        if not text:
            return
        now = self.clock()
        ref = self.db.reference(f"premiumInsights/{grant.company}/{grant.branch}")

        def update(value):
            value = {
                key: item
                for key, item in (value or {}).items()
                if valid_insight_at(item, now) is not None
            }
            value[request_id] = dict(at=now, mode=mode, summary=text)
            for key in sorted(value, key=lambda k: int(value[k].get("at") or 0))[:-100]:
                value.pop(key)
            return value

        ref.transaction(update)

    def purge_insights(self):
        import os
        from uuid import uuid4
        from touchorders_core.api.insight_retention import purge_insights

        now = self.clock()
        token = str(uuid4())
        ref = self.db.reference("aiControls/retentionLease")
        lease = ref.transaction(
            lambda value: (
                value
                if value and value.get("until", 0) > now
                else dict(token=token, until=now + 600000)
            )
        )
        if lease.get("token") != token:
            return {"skipped": True}
        try:
            result = purge_insights(
                self.db,
                now,
                dry_run=os.environ.get("TOUCHORDERS_AI_RETENTION_APPLY") != "true",
            )
            result["dry_run"] = (
                os.environ.get("TOUCHORDERS_AI_RETENTION_APPLY") != "true"
            )

            # Independent cleanup of expired controls; never changes business data or quotas.
            def prune(value):
                value = value or {}
                for group in ("actors", "branches"):
                    for key, row in list(value.get(group, {}).items()):
                        row["attempts"] = [
                            at for at in row.get("attempts", []) if at > now - 60000
                        ]
                        row["pending"] = {
                            k: at
                            for k, at in row.get("pending", {}).items()
                            if at > now
                        }
                        if not row["attempts"] and not row["pending"]:
                            value[group].pop(key)
                return value

            self.db.reference("aiControls").transaction(prune)
            return result
        finally:
            ref.transaction(
                lambda value: (
                    {} if value and value.get("token") == token else (value or {})
                )
            )
