"""Bounded exception classification keeps diagnostics without logging arbitrary messages."""

import socket, ssl
import httpx
import pytest
from touchorders_core.llm.gateway import describe_transport_failure as describe


def chained(cause):
    inner = httpx.ConnectError("Bearer TOKEN_CANARY")
    inner.__cause__ = cause
    outer = RuntimeError("sk-proj-SECRET_CANARY")
    outer.__cause__ = inner
    return outer


@pytest.mark.parametrize(
    "cause,category",
    [
        (OSError(101, "private data"), "network_unreachable"),
        (socket.gaierror(-2, "private data"), "dns"),
        (OSError(-2, "private data"), "dns"),
        (OSError(111, "private data"), "connection_refused"),
        (ssl.SSLError("private data"), "tls"),
        (httpx.LocalProtocolError("Bearer SECRET"), "invalid_header"),
        (httpx.ReadTimeout("private data"), "timeout"),
        (ValueError("private data"), "unknown"),
    ],
)
def test_categories_do_not_contain_exception_values(cause, category):
    assert describe(chained(cause)) == category


def test_cycle_and_depth_are_bounded():
    a = RuntimeError("private")
    b = RuntimeError("private")
    a.__cause__ = b
    b.__cause__ = a
    assert describe(a) == "unknown"
    assert describe(chained(OSError(101, "private")), max_depth=1) == "unknown"


def test_empty_message_is_not_an_empty_diagnostic():
    assert describe(OSError()) == "unknown"
