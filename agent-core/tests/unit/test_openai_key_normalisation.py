"""A pasted credential must be usable without hand-editing the dashboard.

`OPENAI_API_KEY` was pasted into Railway with a trailing newline. httpx refuses to
send a header containing control characters, so the request never left the
container:

    LocalProtocolError: Illegal header value b'Bearer sk-...\\n'

wrapped by the SDK as `APIConnectionError: Connection error.` — which reads
*exactly* like a blocked network, and was misdiagnosed as Railway being unable to
reach OpenAI. Verified against the real endpoint: a clean key returns
`401 Incorrect API key` (a real answer), while the same key plus a newline, a
carriage return, or a trailing space raises the header error and sends nothing.

`build_app` already stripped the variable, but then called `OpenAIClient()` without
passing the cleaned value, so the client re-read the raw string from the
environment and the strip was discarded. These pin both halves: the client
normalises whatever it is given, and the composition root passes the value it
cleaned rather than relying on the client to re-read it.
"""

from __future__ import annotations

import inspect

import pytest

from touchorders_core.llm.budget import BudgetTracker
from touchorders_core.llm.gateway import LLMGateway, OpenAIClient
from touchorders_core import main as composition_root

# The exact forms a dashboard paste produces. All are invisible in the UI.
PASTED_VARIANTS = {
    "trailing newline": "sk-live-abc\n",
    "crlf": "sk-live-abc\r\n",
    "trailing space": "sk-live-abc ",
    "leading and trailing": "  sk-live-abc  ",
    "tab": "sk-live-abc\t",
}

_CLEAN = "sk-live-abc"


def _sent_key(env_value: str | None) -> str:
    client = OpenAIClient(api_key=env_value)
    return client._client.api_key


def test_a_trailing_newline_does_not_reach_the_header() -> None:
    # The regression: this value produced "Illegal header value" and no request.
    for label, pasted in PASTED_VARIANTS.items():
        assert _sent_key(pasted) == _CLEAN, f"{label}: {_sent_key(pasted)!r}"


def test_a_clean_key_is_untouched() -> None:
    # Must not silently alter a legitimate key.
    assert _sent_key(_CLEAN) == _CLEAN


def test_the_environment_value_is_stripped_too() -> None:
    # Not just the explicit argument: this is the path production actually takes.
    import os

    for label, pasted in PASTED_VARIANTS.items():
        os.environ["OPENAI_API_KEY"] = pasted
        try:
            assert _sent_key(None) == _CLEAN, f"{label}"
        finally:
            os.environ.pop("OPENAI_API_KEY", None)


def test_a_whitespace_only_key_is_rejected_as_absent() -> None:
    # "\n" is not a key. It must fail the credential check rather than being sent.
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        OpenAIClient(api_key="   \n  ")


def test_a_missing_key_still_fails_loudly(monkeypatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        OpenAIClient()


def test_the_composition_root_passes_the_key_it_stripped() -> None:
    """The strip only helps if the cleaned value is the one actually used.

    The original called `OpenAIClient(base_url=...)` with no key, so the client
    re-read the raw environment variable and the root's `.strip()` was discarded.
    """
    source = inspect.getsource(composition_root.build_app)
    assert "OpenAIClient(api_key=openai_key" in source, (
        "build_app must pass its stripped key explicitly, otherwise the client "
        "re-reads the raw variable and any pasted whitespace is sent"
    )


def test_the_base_url_is_stripped_as_well() -> None:
    # Same paste hazard, same defensive strip.
    import os

    os.environ["OPENAI_API_KEY"] = _CLEAN
    try:
        client = OpenAIClient(base_url="https://proxy.example.com/v1\n")
        url = str(client._client.base_url)
        assert "\n" not in url and " " not in url, repr(url)
    finally:
        os.environ.pop("OPENAI_API_KEY", None)


def test_a_gateway_built_from_a_pasted_key_sends_the_clean_one() -> None:
    gateway = LLMGateway({}, OpenAIClient(api_key=_CLEAN + "\n"), budget=BudgetTracker({}))
    assert gateway._client._client.api_key == _CLEAN
