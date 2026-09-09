"""BFF AI endpoint: authenticated, routed through the gateway, OpenAI-shaped response."""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from touchorders_core.api.app import create_app
from touchorders_core.api.auth import FakeIdentityVerifier
from touchorders_core.domain.enums import AgentName
from touchorders_core.llm.budget import BudgetTracker, DailyBudget
from touchorders_core.llm.gateway import FakeLLMClient, LLMGateway
from touchorders_core.settings import Settings

_ANALYSIS = {
    "mode": "realtime", "greeting": "Evening service looks steady.", "overallHealth": "Good",
    "priorityActions": {"urgent": [], "recommended": ["Prep extra wings before 7pm"], "longTerm": []},
    "closingNote": "Keep pacing the kitchen.",
}


def _settings() -> Settings:
    return Settings(environment="test", log_json=False)


def _gateway() -> LLMGateway:
    client = FakeLLMClient()
    client.register("dashboard_analysis", _ANALYSIS, input_tokens=1200, output_tokens=280)
    budget = BudgetTracker({AgentName.BUSINESS_ANALYST: DailyBudget(input=100_000, output=100_000)})
    return LLMGateway({}, client, budget=budget)


def _body() -> dict:
    return {
        "model": "gpt-4o-mini",
        "messages": [
            {"role": "system", "content": "You are the TouchOrders analyst. Return JSON."},
            {"role": "user", "content": "{\"summary\": {\"revenue\": 1234}}"},
        ],
        "response_format": {"type": "json_object"},
        "max_tokens": 350,
        "temperature": 0.35,
    }


def test_authenticated_request_returns_dashboard_analysis() -> None:
    app = create_app(_settings(), gateway=_gateway(), identity_verifier=FakeIdentityVerifier())
    with TestClient(app) as client:
        response = client.post("/api/ai/chat/completions?auth=test-id-token", json=_body())

    assert response.status_code == 200
    content = response.json()["choices"][0]["message"]["content"]  # the shape the dashboard parses
    assert json.loads(content)["greeting"].startswith("Evening service")


def test_missing_token_is_unauthorized() -> None:
    app = create_app(_settings(), gateway=_gateway(), identity_verifier=FakeIdentityVerifier())
    with TestClient(app) as client:
        response = client.post("/api/ai/chat/completions", json=_body())
    assert response.status_code == 401


def test_forged_token_is_unauthorized() -> None:
    app = create_app(_settings(), gateway=_gateway(), identity_verifier=FakeIdentityVerifier())
    with TestClient(app) as client:
        response = client.post("/api/ai/chat/completions?auth=forged-token", json=_body())
    assert response.status_code == 401


def test_returns_503_when_ai_backend_not_configured() -> None:
    # No gateway injected -> the route degrades to 503 instead of constructing an OpenAI client.
    app = create_app(_settings(), identity_verifier=FakeIdentityVerifier())
    with TestClient(app) as client:
        response = client.post("/api/ai/chat/completions?auth=test-id-token", json=_body())
    assert response.status_code == 503


def test_per_user_daily_quota_returns_429(monkeypatch) -> None:
    from touchorders_core.api.routes import ai as ai_routes

    monkeypatch.setattr(ai_routes, "DAILY_REQUEST_LIMIT", 2)
    ai_routes._daily_usage.clear()
    app = create_app(_settings(), gateway=_gateway(), identity_verifier=FakeIdentityVerifier())
    with TestClient(app) as client:
        for _ in range(2):
            assert client.post("/api/ai/chat/completions?auth=test-id-token", json=_body()).status_code == 200
        response = client.post("/api/ai/chat/completions?auth=test-id-token", json=_body())
    assert response.status_code == 429
    ai_routes._daily_usage.clear()
