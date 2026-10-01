"""SDK retries only confirmed connection-establishment failures; no provider data storage."""

import json
from types import SimpleNamespace
import httpx, pytest
from touchorders_core.llm.gateway import OpenAIClient


def complete(client):
    return client.complete(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "Return JSON."},
            {"role": "user", "content": '{"summary": {"revenue": 1250}}'},
        ],
        response_format={"type": "json_object"},
        read_tool_specs=[],
        max_output_tokens=350,
        temperature=0.35,
    )


@pytest.mark.parametrize(
    "kind,expected_calls",
    [(httpx.ConnectError, 2), (httpx.ReadTimeout, 1), (httpx.ReadError, 1)],
)
def test_retry_is_bounded_and_only_pretransmission(kind, expected_calls):
    client = OpenAIClient(api_key="sk-test-FAKE_CANARY")
    calls = []

    def transport(request):
        calls.append(request)
        raise kind("Transport failed", request=request)

    client._client._client = httpx.Client(transport=httpx.MockTransport(transport))
    with pytest.raises(Exception):
        complete(client)
    assert len(calls) == expected_calls
    assert client._client.max_retries == 0
    payload = json.loads(calls[0].content)
    assert payload["store"] is False and "tools" not in payload
    assert calls[0].extensions["timeout"]["read"] == 30.0
    client._client.close()


def test_embedded_control_characters_never_enter_a_header():
    with pytest.raises(RuntimeError):
        OpenAIClient(api_key="sk-test-FAKE\nCANARY")
