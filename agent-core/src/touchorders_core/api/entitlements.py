"""Server-side branch membership, AI tier and metered usage checks."""
from __future__ import annotations

import re
import time
from dataclasses import dataclass

from fastapi import HTTPException

from touchorders_core.billing import AI_ALLOWANCE, PREMIUM_MODES, STARTER_MODES, current_period_start

_ID = re.compile(r"^(?:company|branch)-[a-z0-9-]+$")
_REQUEST = re.compile(r"^[0-9a-f-]{36}$")


@dataclass(frozen=True)
class AiGrant:
    company: str
    branch: str
    plan: str
    period_start: int


class FirebaseEntitlementService:
    def __init__(self, database):
        self.db = database

    def reserve(self, *, uid: str, company: str, branch: str, mode: str, request_id: str) -> AiGrant:
        if not _ID.fullmatch(company) or not _ID.fullmatch(branch) or not _REQUEST.fullmatch(request_id):
            raise HTTPException(400, "Invalid branch or request identifier")
        owner = self.db.reference(f"{company}/companyProfile/ownerUids/{uid}").get() is True
        manager = self.db.reference(f"{company}/branches/{branch}/users/{uid}/role").get() == "manager"
        member = self.db.reference(f"{company}/users/{uid}").get()
        if not member or not (owner or manager):
            raise HTTPException(403, "Branch AI access is restricted to owners and managers")
        entitlement = self.db.reference(f"billingEntitlements/{company}/{branch}").get()
        now = int(time.time() * 1000)
        if not entitlement or entitlement.get("subscriptionStatus") not in ("trialing", "active") or int(entitlement.get("periodEndAt") or 0) <= now:
            raise HTTPException(403, "Branch subscription is expired or unavailable")
        plan = entitlement.get("plan")
        modes = PREMIUM_MODES if plan == "premium" else STARTER_MODES if plan == "starter" else set()
        if mode not in modes:
            raise HTTPException(403, "This AI feature requires a higher plan")
        profile = self.db.reference(f"{company}/branches/{branch}/branchProfile").get() or {}
        period_start = current_period_start(entitlement, now, profile.get("timezone") or "Asia/Manila")
        usage = self.db.reference(f"aiUsage/{company}/{branch}/{period_start}")
        allowance = AI_ALLOWANCE[plan]
        claim = {"new": False}
        def reserve_value(value):
            claim["new"] = False
            value = value or {"count": 0, "requests": {}}
            if request_id in value.get("requests", {}) or value.get("count", 0) >= allowance:
                return value
            value["count"] = value.get("count", 0) + 1
            value.setdefault("requests", {})[request_id] = uid
            claim["new"] = True
            return value
        result = usage.transaction(reserve_value)
        if not claim["new"]:
            if request_id in result.get("requests", {}):
                raise HTTPException(409, "AI request identifier already used")
            raise HTTPException(429, "Branch AI allowance reached for this period")
        return AiGrant(company, branch, plan, period_start)

    def refund(self, grant: AiGrant, request_id: str) -> None:
        usage = self.db.reference(f"aiUsage/{grant.company}/{grant.branch}/{grant.period_start}")
        def refund_value(value):
            if not value or request_id not in value.get("requests", {}):
                return value
            value["requests"].pop(request_id)
            value["count"] = max(0, value.get("count", 0) - 1)
            return value
        usage.transaction(refund_value)

    def context(self, grant: AiGrant) -> list[str]:
        if grant.plan != "premium":
            return []
        records = self.db.reference(f"premiumInsights/{grant.company}/{grant.branch}").get() or {}
        cutoff = int(time.time() * 1000) - 90 * 86400000
        recent = sorted(
            (item for item in records.values() if int(item.get("at") or 0) >= cutoff),
            key=lambda item: int(item.get("at") or 0),
        )[-10:]
        return [str(item.get("summary") or "")[:300] for item in recent if item.get("summary")]

    def remember(self, grant: AiGrant, *, mode: str, content: dict, request_id: str) -> None:
        if grant.plan != "premium" or mode not in {"deep", "live", "briefing", "leak"}:
            return
        insight = content.get("insight")
        text = str((insight.get("message") if isinstance(insight, dict) else insight)
                   or content.get("overallHealth") or "").strip()[:300]
        text = re.sub(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", "[redacted]", text)
        text = re.sub(r"\+?\d[\d\s().-]{8,}\d", "[redacted]", text)
        if not text:
            return
        path = f"premiumInsights/{grant.company}/{grant.branch}"
        ref = self.db.reference(path)
        now = int(time.time() * 1000)
        cutoff = now - 90 * 86400000
        existing = ref.get() or {}
        old_keys = [key for key, item in existing.items() if int(item.get("at") or 0) < cutoff]
        for key in old_keys:
            ref.child(key).delete()
        ref.child(request_id).set({"at": now, "mode": mode, "summary": text})
        current = ref.get() or {}
        for key, _ in sorted(current.items(), key=lambda kv: int(kv[1].get("at") or 0))[:-100]:
            ref.child(key).delete()
