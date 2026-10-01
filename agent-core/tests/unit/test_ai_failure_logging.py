"""Failures retain actionable categories, never provider text, tokens or customer data."""

import json, socket
import httpx
import pytest
from fastapi.testclient import TestClient
from touchorders_core.api.routes import ai
from touchorders_core.llm.budget import BudgetExceeded
from test_ai_endpoint import setup, send, body, Gateway

CANARY = "sk-proj-DO_NOT_PUBLISH_CANARY customer@example.com +639171234567 Bearer private-token"


def test_failure_logs_and_body_hide_provider_content(monkeypatch):
    gateway = Gateway()
    gateway.error = RuntimeError(CANARY)
    app, service, _ = setup(gateway=gateway)
    events = []
    monkeypatch.setattr(
        ai.logger,
        "warning",
        lambda event, **fields: events.append(dict(event=event, **fields)),
    )
    with TestClient(app) as client:
        response = send(client)
    assert response.status_code == 503
    assert events[0]["category"] == "unknown"
    assert events[0]["request_id"] and events[0]["mode"] == "realtime"
    for content in (json.dumps(events), response.text):
        for secret in (
            "DO_NOT_PUBLISH",
            "customer@example",
            "639171234567",
            "private-token",
        ):
            assert secret not in content
    usage = service.db.reference("aiUsage/company-test/branch-test").get()
    assert (
        next(iter(next(iter(usage.values()))["requests"].values()))["state"]
        == "uncertain"
    )


def test_context_failure_refunds_only_its_own_claim(monkeypatch):
    app, service, gateway = setup()
    monkeypatch.setattr(
        service, "context", lambda grant: (_ for _ in ()).throw(RuntimeError(CANARY))
    )
    with TestClient(app) as client:
        data = body()
        response = send(client, data)
        assert response.status_code == 503 and not gateway.calls
        assert send(client, data).status_code == 409
    usage = next(
        iter(service.db.reference("aiUsage/company-test/branch-test").get().values())
    )
    assert (
        usage["count"] == 0
        and usage["requests"][data["requestId"]]["state"] == "failed"
    )


def test_budget_exhaustion_is_safe_and_refunds(monkeypatch):
    gateway = Gateway()
    gateway.error = BudgetExceeded(CANARY)
    app, service, _ = setup(gateway=gateway)
    events = []
    monkeypatch.setattr(
        ai.logger,
        "warning",
        lambda event, **fields: events.append(dict(event=event, **fields)),
    )

    with TestClient(app) as client:
        response = send(client)
    assert response.status_code == 429 and events[0]["category"] == "budget"
    assert (
        next(
            iter(
                service.db.reference("aiUsage/company-test/branch-test").get().values()
            )
        )["count"]
        == 0
    )


@pytest.mark.parametrize(
    "kind,refunded",
    [(httpx.ConnectError, True), (httpx.ReadError, False), (httpx.ReadTimeout, False)],
)
def test_only_confirmed_pretransmission_failure_refunds(kind, refunded):
    gateway = Gateway()
    gateway.error = RuntimeError("Provider transport failed")
    gateway.error.__cause__ = kind("Transport failed")
    app, service, _ = setup(gateway=gateway)
    with TestClient(app) as client:
        assert send(client).status_code == 503
    usage = next(
        iter(service.db.reference("aiUsage/company-test/branch-test").get().values())
    )
    assert usage["count"] == (0 if refunded else 1)
    assert next(iter(usage["requests"].values()))["state"] == (
        "failed" if refunded else "uncertain"
    )


def test_standard_access_and_exception_logs_are_scrubbed(capsys):
    import logging
    from touchorders_core.observability.logging import configure_logging

    configure_logging(level="INFO", json_output=True)
    logging.getLogger("uvicorn.access").warning(
        "POST /api/ai/analysis?auth=%s Bearer %s", "TOKEN_CANARY", "TOKEN_CANARY"
    )
    try:
        raise RuntimeError(CANARY)
    except RuntimeError:
        logging.getLogger("openai").exception("Provider failed")
    content = capsys.readouterr().err
    assert "TOKEN_CANARY" not in content and "DO_NOT_PUBLISH" not in content
    assert "[REDACTED]" in content


def test_uvicorn_access_formatter_keeps_its_structured_arguments():
    import logging
    from uvicorn.logging import AccessFormatter
    from touchorders_core.observability.logging import configure_logging

    logger = logging.getLogger("uvicorn.access")
    handler = logging.StreamHandler()
    handler.setFormatter(
        AccessFormatter(
            "%(client_addr)s - %(request_line)s %(status_code)s", use_colors=False
        )
    )
    logger.addHandler(handler)
    try:
        configure_logging(level="INFO", json_output=True)
        record = logging.LogRecord(
            "uvicorn.access",
            logging.INFO,
            __file__,
            1,
            '%s - "%s %s HTTP/%s" %d',
            (
                "127.0.0.1:4321",
                "POST",
                "/api/ai/analysis?auth=TOKEN_CANARY",
                "1.1",
                400,
            ),
            None,
        )
        for filter in handler.filters:
            filter.filter(record)
        rendered = handler.format(record)
        assert (
            "TOKEN_CANARY" not in rendered
            and "[REDACTED]" in rendered
            and "400" in rendered
        )
    finally:
        logger.removeHandler(handler)
