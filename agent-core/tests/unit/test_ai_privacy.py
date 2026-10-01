import copy, json
from uuid import uuid4
import pytest
from fastapi import HTTPException
from touchorders_core.api.ai_context import build_context, patterns
from touchorders_core.api.ai_schemas import validate_analysis
from touchorders_core.api.insight_retention import purge_insights
from touchorders_core.observability.privacy import safe_input, safe_label, redact_text
from test_ai_endpoint import setup, body, send, Gateway
from test_billing import req
from fastapi.testclient import TestClient


def test_contacts_are_redacted_without_changing_money():
    text = safe_input("₱1250.00 customer@example.com +639171234567 09171234567")
    assert "₱1250.00" in text and "@" not in text and "9171234567" not in text
    assert safe_label("sk-proj-SECRET_CANARY") == "Product"


@pytest.mark.parametrize(
    "secret",
    [
        "sk-proj-SECRET_CANARY",
        "password=secret",
        "token: secret",
        "-----BEGIN PRIVATE KEY-----",
        "eyJabcdef.abcdef.abcdef",
        "https://x.test/?auth=secret",
    ],
)
def test_secret_inputs_never_cross_boundary(secret):
    with pytest.raises(ValueError):
        safe_input(secret)


@pytest.mark.parametrize("plan", ["basic", "starter", "premium"])
def test_context_drops_private_fields_and_preserves_totals(plan):
    app, service, _ = setup(plan)
    if plan == "basic":
        with pytest.raises(HTTPException):
            service.authorize(**{k: v for k, v in req().items() if k != "request_id"})
        return
    grant = service.authorize(**{k: v for k, v in req().items() if k != "request_id"})
    context = build_context(service.db, grant, "deep", now_ms=service.clock())
    text = json.dumps(context)
    assert (
        context["summary"]["totalRevenue"] == 1250
        and context["summary"]["totalOrders"] == 24
    )
    for canary in (
        "PRIVATE_CUSTOMER",
        "PRIVATE_UID",
        "private@example",
        "CANARY",
        "pin",
    ):
        assert canary not in text
    assert ("inventory" in context) == (plan == "premium")


def test_insight_retention_independent_dry_run_and_concurrent_safe():
    _, service, _ = setup("premium")
    now = service.clock()
    path = "premiumInsights/company-test/branch-test"
    service.db.reference(path).set(
        {str(i): dict(at=now - 101 + i, summary="Safe summary") for i in range(101)}
        | {"old": dict(at=now - 91 * 86400000, summary="expired")}
    )
    preview = purge_insights(
        service.db, now, dry_run=True, company="company-test", branch="branch-test"
    )
    assert preview["removed"] == 2 and len(service.db.reference(path).get()) == 102
    assert purge_insights(service.db, now)["removed"] == 2
    assert len(service.db.reference(path).get()) == 100
    assert purge_insights(service.db, now)["removed"] == 0
    assert not service.db.reference("deletionTombstones").get()


def test_memory_dated_and_credential_summaries_omitted():
    _, service, _ = setup("premium")
    grant = service.authorize(**{k: v for k, v in req().items() if k != "request_id"})
    now = service.clock()
    service.db.reference("premiumInsights/company-test/branch-test").set(
        {
            "safe": dict(at=now, summary="Contact customer@example.com"),
            "secret": dict(at=now, summary="sk-proj-SECRET_CANARY"),
            "expired": dict(at=1, summary="old"),
            "future": dict(at=now + 86400000, summary="future"),
            "invalid": dict(at="not a timestamp", summary="invalid"),
        }
    )
    context = service.context(grant)
    assert (
        len(context) == 1
        and context[0]["at"] == now
        and "@" not in context[0]["summary"]
    )
    service.remember(
        grant,
        mode="deep",
        content={"executiveSummary": "Sales improved."},
        request_id=str(uuid4()),
    )
    assert len(service.context(grant)) == 2


def test_pending_concurrency_and_stale_reservation_never_refund_ambiguously():
    _, service, _ = setup()
    one = req()
    service.reserve(**one, fingerprint="immutable")
    with pytest.raises(HTTPException) as limit:
        service.reserve(**req(request_id=str(uuid4())))
    assert limit.value.status_code == 429
    initial = service.clock()
    service.clock = lambda: initial + 181000
    with pytest.raises(HTTPException) as duplicate:
        service.reserve(**one, fingerprint="changed")
    assert duplicate.value.status_code == 409
    service.reserve(**req(request_id=str(uuid4())))
    usage = next(
        iter(service.db.reference("aiUsage/company-test/branch-test").get().values())
    )
    assert usage["count"] == 2


def test_attempt_rate_limit_survives_refunds():
    _, service, _ = setup()
    for _ in range(6):
        request = req(request_id=str(uuid4()))
        grant = service.reserve(**request)
        service.refund(grant, request["request_id"])
    with pytest.raises(HTTPException) as limited:
        service.reserve(**req(request_id=str(uuid4())))
    assert limited.value.status_code == 429


def test_invalid_model_output_is_rejected_and_never_cached():
    class BadGateway(Gateway):
        def analysis_completion(self, **kwargs):
            self.calls.append(kwargs)
            return (
                {
                    "mode": "realtime",
                    "insight": {"message": "bad", "action": "act", "priority": "LOW"},
                    "unexpected": "secret",
                },
                10,
                10,
            )

    gateway = BadGateway()
    app, service, _ = setup(gateway=gateway)
    with TestClient(app) as client:
        assert send(client).status_code == 503
        assert send(client).status_code == 503
    assert len(gateway.calls) == 2
    assert (
        next(
            iter(
                service.db.reference("aiUsage/company-test/branch-test").get().values()
            )
        )["count"]
        == 0
    )


def test_patterns_do_not_use_excluded_or_inactive_products():
    _, service, _ = setup("premium")
    base = "company-test/branches/branch-test"
    service.db.reference(base + "/logs").set(
        {
            str(i): {
                "orderId": str(i),
                "customerName": "PRIVATE_CUSTOMER",
                "items": [{"name": "Coffee"}, {"name": "Removed item"}],
            }
            for i in range(12)
        }
    )
    service.db.reference(base + "/analyticsExclusions").set({"0": {"excluded": True}})
    grant = service.authorize(**{k: v for k, v in req().items() if k != "request_id"})
    context = build_context(service.db, grant, "deep", now_ms=service.clock())
    assert "Removed item" not in json.dumps(
        context
    ) and "PRIVATE_CUSTOMER" not in json.dumps(context)


def test_request_id_cannot_be_replayed_after_a_new_subscription_period():
    _, service, _ = setup()
    request = req()
    grant = service.reserve(**request, fingerprint="immutable")
    service.finish(grant, request["request_id"], request["uid"])
    entitlement = service.db.reference(
        "billingEntitlements/company-test/branch-test"
    ).get()
    entitlement["periodStartAt"] += 1000
    with pytest.raises(HTTPException) as duplicate:
        service.reserve(**request, fingerprint="immutable")
    assert duplicate.value.status_code == 409
    assert (
        service.db.reference(
            f'aiRequests/company-test/branch-test/{request["request_id"]}'
        ).get()["state"]
        == "completed"
    )


def test_wrong_actor_cannot_release_a_pending_slot_or_refund_quota():
    _, service, _ = setup()
    request = req()
    grant = service.reserve(**request)
    service.finish(grant, request["request_id"], "manager", state="failed", refund=True)
    with pytest.raises(HTTPException) as pending:
        service.reserve(**req(request_id=str(uuid4())))
    assert pending.value.status_code == 429
    assert (
        service.db.reference(
            f"aiUsage/company-test/branch-test/{grant.period_start}/count"
        ).get()
        == 1
    )


def test_retention_worker_defaults_to_dry_run_without_deleting_business_records(
    monkeypatch,
):
    monkeypatch.delenv("TOUCHORDERS_AI_RETENTION_APPLY", raising=False)
    _, service, _ = setup("premium")
    path = "premiumInsights/company-test/branch-test"
    service.db.reference(path).set({"expired": dict(at=1, summary="Old summary")})
    assert service.purge_insights()["removed"] == 1
    assert service.db.reference(path).get()
    monkeypatch.setenv("TOUCHORDERS_AI_RETENTION_APPLY", "true")
    assert service.purge_insights()["removed"] == 1
    assert service.db.reference(path).get() == {}
    assert service.db.reference("company-test/branches/branch-test").get()
