"""Exercise the real endpoint, gateway and SDK using a local provider transport."""

import copy
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from touchorders_core.api.ai_schemas import EXAMPLES, OUTPUTS
from touchorders_core.domain.enums import AgentName
from touchorders_core.llm.budget import BudgetTracker, DailyBudget
from touchorders_core.llm.gateway import LLMGateway, OpenAIClient
from test_ai_endpoint import body, send, setup


def provider_app(mode, *, answer="Recorded revenue is ₱1,250 from 24 orders.",
                 finish_reason="stop", refusal=None, content=None):
    result = copy.deepcopy(EXAMPLES[mode])
    if mode == "opschat":
        result.update(answer=answer, keyPoints=[], recommendation="Compare daily sales.")
        result["simulation"] = {key: None for key in result["simulation"]}
    if mode in ("realtime", "live"):
        result["insight"]["priority"] = "LOW"
    calls = []

    def transport(request):
        calls.append(json.loads(request.content))
        return httpx.Response(200, json={
            "id": "chatcmpl-fixture", "object": "chat.completion", "created": 1,
            "model": "gpt-4o-mini",
            "choices": [{"index": 0, "finish_reason": finish_reason,
                         "message": {"role": "assistant", "refusal": refusal,
                                     "content": content if content is not None else json.dumps(result)}}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 40, "total_tokens": 140},
        })

    provider = OpenAIClient(api_key="sk-test-LOCAL_FIXTURE_ONLY")
    provider._client._client = httpx.Client(transport=httpx.MockTransport(transport))
    agent = AgentName.BUSINESS_ANALYST
    gateway = LLMGateway({}, provider, budget=BudgetTracker({agent: DailyBudget(100000, 100000)}))
    app, service, _ = setup("premium", gateway=gateway)
    return app, service, provider, calls


@pytest.mark.parametrize("mode", list(EXAMPLES))
def test_analysis_sends_its_actual_bounded_contract_to_provider(mode):
    app, _, provider, calls = provider_app(mode)
    try:
        with TestClient(app) as client:
            response = send(client, body(mode, **(
                {"question": "How are our sales?"} if mode in ("opschat", "simulation") else {}
            )))
        assert response.status_code == 200, response.text
        wire = calls[0]
        assert wire["response_format"]["type"] == "json_schema"
        contract = wire["response_format"]["json_schema"]
        assert contract["strict"] is True
        assert contract["schema"] == OUTPUTS[mode].model_json_schema()
        assert contract["schema"]["additionalProperties"] is False
        assert wire["store"] is False and "tools" not in wire
        assert len(calls) == 1
    finally:
        provider._client.close()


@pytest.mark.parametrize("finish,refusal,content,reason", [
    ("length", None, '{"answer":"unfinished', "truncated"),
    ("content_filter", None, "{}", "filtered"),
    ("stop", "PRIVATE_REFUSAL_CANARY", "{}", "refused"),
    ("stop", None, "PRIVATE_MALFORMED_CANARY", "invalid_json"),
])
def test_incomplete_or_refused_chat_is_classified_without_response_disclosure(
    monkeypatch, finish, refusal, content, reason
):
    from touchorders_core.api.routes import ai
    events = []
    monkeypatch.setattr(ai.logger, "warning", lambda event, **fields: events.append((event, fields)))
    app, service, provider, calls = provider_app(
        "opschat", finish_reason=finish, refusal=refusal, content=content
    )
    try:
        with TestClient(app) as client:
            response = send(client, body("opschat", question="How are sales?"))
        assert response.status_code == 503
        assert len(calls) == 1  # no paid corrective retry
        failure = next(fields for event, fields in events if event == "ai_failed")
        assert failure["category"] == "validation"
        assert failure["validation_reason"] == reason
        assert "PRIVATE_" not in json.dumps(events) + response.text
        assert not app.state.ai_runtime.completed
        requests = service.db.reference("aiRequests/company-test/branch-test").get()
        assert next(iter(requests.values()))["state"] == "failed"
        budget = app.state.gateway.budget_status(AgentName.BUSINESS_ANALYST)
        assert (budget.input_used, budget.output_used) == (100, 40)
        assert not budget.circuit_open
    finally:
        provider._client.close()


def test_schema_diagnostics_include_only_known_field_names_and_error_codes(monkeypatch):
    from touchorders_core.api.routes import ai
    events = []
    monkeypatch.setattr(ai.logger, "warning", lambda event, **fields: events.append((event, fields)))
    app, _, provider, calls = provider_app("opschat", answer="PRIVATE_ANSWER_CANARY" * 100)
    try:
        with TestClient(app) as client:
            response = send(client, body("opschat", question="How are sales?"))
        assert response.status_code == 503
        failure = next(fields for event, fields in events if event == "ai_failed")
        assert failure["validation_errors"] == [{"field": "answer", "code": "string_too_long"}]
        assert "PRIVATE_ANSWER_CANARY" not in json.dumps(events) + response.text
        assert len(calls) == 1
    finally:
        provider._client.close()


def test_unknown_output_keys_cannot_leak_through_validation_diagnostics():
    from touchorders_core.api.ai_schemas import validate_analysis
    from touchorders_core.api.routes.ai import validation_details
    from pydantic import ValidationError
    result = copy.deepcopy(EXAMPLES["opschat"])
    result["simulation"] = {key: None for key in result["simulation"]}
    result["PRIVATE_CUSTOMER_KEY_CANARY"] = "PRIVATE_VALUE_CANARY"
    with pytest.raises(ValidationError) as rejected:
        validate_analysis("opschat", result)
    details = validation_details("opschat", rejected.value)
    assert details == {"validation_errors": [{"field": "response", "code": "extra_forbidden"}]}
    assert "PRIVATE_" not in json.dumps(details)


def test_received_refusals_do_not_open_the_shared_transport_circuit():
    app, _, provider, calls = provider_app("opschat", refusal="PRIVATE_REFUSAL_CANARY")
    try:
        with TestClient(app) as client:
            for _ in range(5):
                assert send(client, body("opschat", question="How are sales?")).status_code == 503
        budget = app.state.gateway.budget_status(AgentName.BUSINESS_ANALYST)
        assert not budget.circuit_open
        assert len(calls) == 5
        assert (budget.input_used, budget.output_used) == (500, 200)
    finally:
        provider._client.close()
