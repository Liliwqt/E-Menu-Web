"""A connection failure must log why, not just that it happened.

The SDK raises `openai.APIConnectionError("Connection error.")` for every distinct
underlying fault. The reason is only in the chained cause — an `httpx.ConnectError`
wrapping an `OSError` — and it separates cases that need different fixes:

    [Errno 101] Network is unreachable   -> no egress from the host at all
    [Errno -2] Name or service not known  -> DNS
    [Errno 111] Connection refused         -> reachable, but nothing is listening

All three log identically as `error: Connection error.`, which is why the current
production failure could be narrowed only to "Railway cannot reach OpenAI" and not
one step further. `describe_transport_failure` walks the chain so the OS reason
survives into the log line.
"""

from __future__ import annotations

import httpx

from touchorders_core.llm.gateway import describe_transport_failure as describe


def _chained(message: str, cause: BaseException) -> BaseException:
    """The shape the OpenAI SDK produces: wrapper -> httpx error -> OSError."""
    try:
        raise cause
    except BaseException as inner:
        try:
            raise httpx.ConnectError("Connection error.") from inner
        except httpx.ConnectError as connect:
            try:
                raise RuntimeError(message) from connect
            except RuntimeError as outer:
                return outer


def test_recovers_the_os_reason_from_the_cause_chain() -> None:
    exc = _chained("Connection error.", OSError(101, "Network is unreachable"))
    chain = describe(exc)
    assert "Network is unreachable" in chain, chain
    assert "ConnectError" in chain, chain


def test_names_each_underlying_cause_separately() -> None:
    # These three are the whole diagnosis, and each needs a different operator action.
    cases = {
        OSError(101, "Network is unreachable"): "Network is unreachable",
        OSError(-2, "Name or service not known"): "Name or service not known",
        OSError(111, "Connection refused"): "Connection refused",
    }
    reasons = set()
    for cause, expected in cases.items():
        chain = describe(_chained("Connection error.", cause))
        assert expected in chain, f"{expected!r} lost from {chain!r}"
        reasons.add(expected)
    # And they must not collapse into one indistinguishable line.
    assert len(reasons) == 3


def test_keeps_the_exception_types_in_order() -> None:
    chain = describe(_chained("Connection error.", OSError(101, "Network is unreachable")))
    assert chain.index("APIConnectionError" if "APIConnectionError" in chain else "RuntimeError") == 0
    assert "ConnectError" in chain
    assert "<-" in chain, "the chain must be readable as a sequence"


def test_survives_an_exception_with_no_cause() -> None:
    # A plain error still logs something true.
    chain = describe(ValueError("bad model name"))
    assert "ValueError" in chain
    assert "bad model name" in chain


def test_survives_an_exception_with_an_empty_message() -> None:
    chain = describe(OSError())
    assert isinstance(chain, str)
    assert chain.strip(), "must never be empty, or the log field is useless"


def test_terminates_on_a_self_referential_cause_chain() -> None:
    # A cycle would otherwise loop forever on an error path — the worst place to hang.
    a = RuntimeError("a")
    b = RuntimeError("b")
    a.__cause__ = b
    b.__cause__ = a
    chain = describe(a, max_depth=6)
    assert isinstance(chain, str) and chain


def test_respects_the_depth_limit() -> None:
    exc = _chained("Connection error.", OSError(101, "Network is unreachable"))
    assert len(describe(exc, max_depth=1).split(" <- ")) == 1


def test_does_not_swallow_the_message_when_there_is_no_chain() -> None:
    # A non-transport failure must still say what was wrong.
    chain = describe(RuntimeError("AI generation failed; please try again"))
    assert "AI generation failed" in chain
