"""Real Firebase transactions: pending limits, branch quota and exactly-once refunds."""

import os, time
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4
import pytest
from fastapi import HTTPException
from touchorders_core.api.entitlements import FirebaseEntitlementService
from touchorders_core.billing import AI_ALLOWANCE

pytestmark = pytest.mark.skipif(
    not os.environ.get("FIREBASE_DATABASE_EMULATOR_HOST"),
    reason="RTDB emulator is not running",
)


def test_ai_claims_with_real_emulator_concurrency(monkeypatch):
    import firebase_admin
    from firebase_admin import db

    if not firebase_admin._apps:
        firebase_admin.initialize_app(
            options={
                "projectId": "demo-menu-kiosk",
                "databaseURL": "https://demo-menu-kiosk-default-rtdb.firebaseio.com",
            }
        )
    suffix = uuid4().hex[:8]
    company = "company-ai-" + suffix
    branch = "branch-ai-" + suffix
    users = ["owner-" + suffix, "manager-" + suffix, "third-" + suffix]
    now = int(time.time() * 1000)
    db.reference(company).set(
        {
            "companyProfile": {"ownerUids": {users[0]: True}},
            "users": {uid: {"uid": uid} for uid in users},
            "branches": {
                branch: {
                    "branchProfile": {"timezone": "Asia/Manila"},
                    "users": {uid: {"role": "manager"} for uid in users[1:]},
                }
            },
        }
    )
    db.reference(f"billingEntitlements/{company}/{branch}").set(
        dict(
            plan="starter",
            subscriptionStatus="active",
            periodStartAt=now,
            periodEndAt=now + 86400000,
        )
    )
    service = FirebaseEntitlementService(db)
    ids = [str(uuid4()) for _ in users]

    def reserve(index):
        try:
            return service.reserve(
                uid=users[index],
                company=company,
                branch=branch,
                mode="deep",
                request_id=ids[index],
                fingerprint="immutable",
            )
        except HTTPException as error:
            return error.status_code

    try:
        with ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(reserve, range(3)))
        assert sum(not isinstance(r, int) for r in results) == 2 and 429 in results
        assert db.reference(f"aiUsage/{company}/{branch}/{now}/count").get() == 2
        for i, result in enumerate(results):
            if not isinstance(result, int):
                service.finish(result, ids[i], users[i], state="failed", refund=True)
        assert db.reference(f"aiUsage/{company}/{branch}/{now}/count").get() == 0
        assert (
            reserve(next(i for i, v in enumerate(results) if not isinstance(v, int)))
            == 409
        )
        monkeypatch.setitem(AI_ALLOWANCE, "starter", 1)
        ids[:] = [str(uuid4()) for _ in users]
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(reserve, range(2)))
        assert sum(not isinstance(r, int) for r in results) == 1 and 429 in results
        winner = next(i for i, v in enumerate(results) if not isinstance(v, int))
        service.finish(
            results[winner], ids[winner], users[1 - winner], state="failed", refund=True
        )
        assert db.reference(f"aiUsage/{company}/{branch}/{now}/count").get() == 1
        service.finish(
            results[winner], ids[winner], users[winner], state="failed", refund=True
        )
        service.finish(
            results[winner], ids[winner], users[winner], state="failed", refund=True
        )
        assert db.reference(f"aiUsage/{company}/{branch}/{now}/count").get() == 0
    finally:
        for path in (
            company,
            f"billingEntitlements/{company}",
            f"aiUsage/{company}",
            f"aiRequests/{company}",
            f"aiControls/branches/{company}_{branch}",
        ):
            db.reference(path).delete()
        from hashlib import sha256

        for uid in users:
            db.reference(
                f"aiControls/actors/{sha256(uid.encode()).hexdigest()}"
            ).delete()
