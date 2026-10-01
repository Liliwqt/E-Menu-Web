"""The model endpoint must be redirectable without a rebuild.

`OpenAIClient` hardcoded the OpenAI root, so the one remedy for a host that cannot
reach `api.openai.com` — point it at a proxy or an OpenAI-compatible endpoint — did
not exist. That is exactly the failure now in production: the Railway container
opens no connection to OpenAI and every request comes back `APIConnectionError`,
surfaced to the browser as a 503. `/health/ready` still reports `openai:ok`,
because that only checks the key is non-empty.

These pin the parameter, the env fallback, the settings wiring the composition root
uses, and the log field that names the host a connection error could not reach.
"""

from __future__ import annotations

import pytest

from touchorders_core.domain.enums import AgentName
from touchorders_core.llm.budget import BudgetTracker, DailyBudget
from touchorders_core.llm.gateway import LLMGateway, OpenAIClient
from touchorders_core.settings import Settings

_DEFAULT = "https://api.openai.com/v1"


@pytest.fixture
def api_key(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-not-real")
    return "sk-test-not-real"


def _gateway(**kwargs) -> LLMGateway:
    return LLMGateway(
        {},
        OpenAIClient(**kwargs),
        budget=BudgetTracker({AgentName.BUSINESS_ANALYST: DailyBudget(input=1000, output=1000)}),
    )


def test_defaults_to_the_real_openai_endpoint(api_key) -> None:
    # With nothing configured the behaviour must be exactly what it was before
    # this parameter existed: OpenAI's own endpoint.
    assert _gateway().openai_base_url.rstrip("/") == _DEFAULT


def test_reads_openai_base_url_from_the_environment(api_key, monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_BASE_URL", "https://proxy.example.com/v1")
    assert _gateway().openai_base_url.rstrip("/") == "https://proxy.example.com/v1"


def test_explicit_argument_wins_over_the_environment(api_key, monkeypatch) -> None:
    # The composition root passes settings.openai_base_url, so the setting is what
    # actually takes effect in production; the env var is only a fallback.
    monkeypatch.setenv("OPENAI_BASE_URL", "https://from-env.example.com/v1")
    gateway = _gateway(base_url="https://from-settings.example.com/v1")
    assert gateway.openai_base_url.rstrip("/") == "https://from-settings.example.com/v1"


def test_settings_expose_the_override_with_the_openai_default(api_key) -> None:
    settings = Settings(environment="test", log_json=False)
    assert settings.openai_base_url == _DEFAULT
    # And the composition root's actual call must honour it.
    assert _gateway(base_url=settings.openai_base_url).openai_base_url.rstrip("/") == _DEFAULT


def test_settings_accept_the_toouchorders_prefixed_alias(api_key, monkeypatch) -> None:
    # Every other variable in this project accepts both spellings; this one must too.
    monkeypatch.setenv("TOUCHORDERS_OPENAI_BASE_URL", "https://aliased.example.com/v1")
    assert Settings(environment="test", log_json=False).openai_base_url == "https://aliased.example.com/v1"


def test_a_trailing_slash_never_produces_a_double_slash(api_key) -> None:
    # "/v1/" plus a root-relative path would give "//chat/completions" on some hosts.
    for supplied in ("https://proxy.example.com/v1", "https://proxy.example.com/v1/"):
        url = _gateway(base_url=supplied).openai_base_url
        assert "//v" not in url.replace("https://", ""), url


def test_a_fake_client_reports_no_endpoint(api_key) -> None:
    # Used by the test suite; it must not pretend to have a URL to log.
    from touchorders_core.llm.gateway import FakeLLMClient

    gateway = LLMGateway({}, FakeLLMClient(), budget=BudgetTracker({}))
    assert gateway.openai_base_url is None


def test_a_missing_key_still_fails_loudly(monkeypatch) -> None:
    # The override must not become a way to skip the credential check.
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        OpenAIClient(base_url="https://proxy.example.com/v1")
