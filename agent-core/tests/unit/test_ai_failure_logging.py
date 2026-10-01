"""A 503 from the AI route must say which fault it was, in the logs.

Four unrelated faults all surface as the same 503: an unreadable insights read, an
open circuit breaker, a rejected OpenAI key, and an exhausted balance. OpenAI
raises a distinct exception type for each (`AuthenticationError`, `RateLimitError`,
`APIConnectionError`), so the type is the only thing separating them — and it was
being discarded. `raise HTTPException(...) from exc` keeps the cause inside the
process and nowhere else, so an operator reading the service logs saw five hundred
"AI generation failed" lines with no way to tell a revoked key from a bad model name.

These assert the cause reaches the log, which is what makes the error actionable.
"""

from __future__ import annotations

import json
import logging

from fastapi.testclient import TestClient

from touchorders_core.api.app import create_app
from touchorders_core.api.auth import FakeIdentityVerifier
from touchorders_core.api.routes import ai as ai_route
from touchorders_core.settings import Settings


def _body() -> dict:
    return {
        "companyId": "company-test",
        "branchId": "branch-test",
        "mode": "realtime",
        "requestId": "00000000-0000-4000-8000-000000000001",
        "model": "gpt-4o-mini",
        "messages": [
            {"role": "system", "content": "You are the TouchOrders analyst. Return JSON."},
            {"role": "user", "content": '{"summary": {"revenue": 1234}}'},
        ],
        "response_format": {"type": "json_object"},
        "max_tokens": 350,
        "temperature": 0.35,
    }


class FakeEntitlementService:
    def __init__(self):
        self.requests = []
        self.refunds = []

    def reserve(self, **kwargs):
        self.requests.append(kwargs)
        from touchorders_core.api.entitlements import AiGrant
        return AiGrant(kwargs["company"], kwargs["branch"], "starter", 100)

    def refund(self, grant, request_id):
        self.refunds.append(request_id)

    def context(self, grant):
        return []

    def remember(self, grant, **kwargs):
        pass


def _settings() -> Settings:
    return Settings(environment="test", log_json=False)


def test_generation_failure_logs_the_openai_error_type() -> None:
    """The regression: every 503 was anonymous in the logs."""

    class RateLimitedGateway:
        def analysis_completion(self, **kwargs):
            raise RuntimeError("simulated upstream outage")

    captured: list[dict] = []
    original_error = ai_route.logger.error

    def capture(event, **kwargs):
        captured.append({"event": event, **kwargs})

    ai_route.logger.error = capture
    try:
        app = create_app(
            _settings(),
            gateway=RateLimitedGateway(),
            identity_verifier=FakeIdentityVerifier(),
            entitlement_service=FakeEntitlementService(),
        )
        with TestClient(app) as client:
            response = client.post("/api/ai/chat/completions?auth=test-id-token", json=_body())
    finally:
        ai_route.logger.error = original_error

    assert response.status_code == 503
    assert captured, "a failed generation must be logged, not silently turned into a 503"
    entry = captured[0]
    assert entry["event"] == "ai_generation_failed"
    # The type is the whole point: it is what separates a revoked key from a bad model.
    assert entry["error_type"] == "RuntimeError"
    assert "simulated upstream outage" in entry["error"]
    # Enough context to find the request again, and no customer payload.
    assert entry["branch"] == "branch-test"
    assert entry["mode"] == "realtime"
    assert entry["model"] == "gpt-4o-mini"


def test_context_failure_is_logged_too() -> None:
    """The other anonymous 503: an unreadable insights read."""

    class BrokenContext(FakeEntitlementService):
        def context(self, grant):
            raise OSError("premiumInsights unreadable")

    captured: list[dict] = []
    original_error = ai_route.logger.error
    ai_route.logger.error = lambda event, **kwargs: captured.append({"event": event, **kwargs})

    class WorkingGateway:
        def analysis_completion(self, **kwargs):
            raise AssertionError("must not reach the model when context fails")

    try:
        app = create_app(
            _settings(),
            gateway=WorkingGateway(),
            identity_verifier=FakeIdentityVerifier(),
            entitlement_service=BrokenContext(),
        )
        with TestClient(app) as client:
            response = client.post("/api/ai/chat/completions?auth=test-id-token", json=_body())
    finally:
        ai_route.logger.error = original_error

    assert response.status_code == 503
    assert any(entry["event"] == "ai_context_unavailable" for entry in captured), captured


def test_budget_exhaustion_is_logged_as_a_warning() -> None:
    """429 is a different class of problem (the operator's spend), so it is distinct."""

    class ExhaustedGateway:
        def analysis_completion(self, **kwargs):
            from touchorders_core.llm.budget import BudgetExceeded
            raise BudgetExceeded("daily cap reached")

    captured: list[dict] = []
    original_warning = ai_route.logger.warning
    ai_route.logger.warning = lambda event, **kwargs: captured.append({"event": event, **kwargs})

    try:
        app = create_app(
            _settings(),
            gateway=ExhaustedGateway(),
            identity_verifier=FakeIdentityVerifier(),
            entitlement_service=FakeEntitlementService(),
        )
        with TestClient(app) as client:
            response = client.post("/api/ai/chat/completions?auth=test-id-token", json=_body())
    finally:
        ai_route.logger.warning = original_warning

    assert response.status_code == 429
    assert any(entry["event"] == "ai_budget_exhausted" for entry in captured), captured


def test_the_response_body_still_hides_internals() -> None:
    """Logging the cause must not leak it to the browser.

    The operator needs the exception type in the logs; the reader needs a sentence
    they can act on. The detail stays a fixed, generic string.
    """

    class BrokenGateway:
        def analysis_completion(self, **kwargs):
            raise RuntimeError("sk-proj-SECRETVALUE rejected")

    app = create_app(
        _settings(),
        gateway=BrokenGateway(),
        identity_verifier=FakeIdentityVerifier(),
        entitlement_service=FakeEntitlementService(),
    )
    with TestClient(app) as client:
        response = client.post("/api/ai/chat/completions?auth=test-id-token", json=_body())

    assert response.status_code == 503
    body = response.json()
    assert "SECRETVALUE" not in json.dumps(body)
    assert body["detail"] == "AI generation failed; please try again"
