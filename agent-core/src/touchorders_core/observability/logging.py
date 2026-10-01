"""Structured, correlation-aware logging for the agent core."""

from __future__ import annotations

import logging
import re
from collections.abc import Mapping
from typing import Any

import structlog

from touchorders_core.observability.privacy import redact_text
from structlog.contextvars import bind_contextvars, clear_contextvars

_OPENAI_KEY_PATTERN = re.compile(r"\bsk-[A-Za-z0-9_-]{8,}\b")
_SENSITIVE_KEYS = frozenset(
    {
        "api_key",
        "authorization",
        "credentials",
        "password",
        "secret",
        "token",
        "private_key",
        "client_secret",
        "webhook_secret",
        "id_token",
        "refresh_token",
        "access_token",
        "pin",
    }
)


def _redact_value(value: Any, *, key: str | None = None) -> Any:
    if key is not None and key.lower() in _SENSITIVE_KEYS:
        return "[REDACTED]"
    if isinstance(value, str):
        return redact_text(_OPENAI_KEY_PATTERN.sub("[REDACTED_OPENAI_KEY]", value))
    if isinstance(value, Mapping):
        return {
            str(item_key): _redact_value(item_value, key=str(item_key))
            for item_key, item_value in value.items()
        }
    if isinstance(value, list):
        return [_redact_value(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_redact_value(item) for item in value)
    return value


def redact_secrets(
    _: Any,
    __: str,
    event_dict: dict[str, Any],
) -> dict[str, Any]:
    """Scrub credentials before a log event leaves the process."""

    return _redact_value(event_dict)


def bind_correlation_context(
    *,
    correlation_id: str | None = None,
    causation_id: str | None = None,
    tenant_id: str | None = None,
) -> None:
    """Bind episode identifiers to the current async context's log events."""

    values = {
        name: value
        for name, value in {
            "correlation_id": correlation_id,
            "causation_id": causation_id,
            "tenant_id": tenant_id,
        }.items()
        if value is not None
    }
    if values:
        bind_contextvars(**values)


def clear_correlation_context() -> None:
    """Clear all context variables after a request, task, or event completes."""

    clear_contextvars()


# Third-party loggers and access logs do not pass through structlog processors.
class SafeLogFilter(logging.Filter):
    def filter(self, record):
        if (
            record.name == "uvicorn.access"
            and isinstance(record.args, tuple)
            and len(record.args) == 5
        ):
            record.args = _redact_value(record.args)
        else:
            record.msg = redact_text(record.getMessage())
            record.args = ()
        if record.exc_info:
            record.msg += " [exception=" + record.exc_info[0].__name__ + "]"
            record.exc_info = None
            record.exc_text = None
        return True


def configure_logging(*, level: str, json_output: bool) -> None:
    """Configure process logging exactly once per composition-root invocation."""

    normalized_level = level.upper()
    numeric_level = logging.getLevelNamesMapping().get(normalized_level)
    if numeric_level is None:
        raise ValueError(f"Unsupported log level: {level}")

    logging.basicConfig(level=numeric_level, format="%(message)s", force=True)
    renderer: structlog.types.Processor
    renderer = (
        structlog.processors.JSONRenderer()
        if json_output
        else structlog.dev.ConsoleRenderer()
    )

    handlers = list(logging.getLogger().handlers)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        handlers.extend(logging.getLogger(name).handlers)
    for handler in handlers:
        if not any(isinstance(f, SafeLogFilter) for f in handler.filters):
            handler.addFilter(SafeLogFilter())
    for noisy in ("httpx", "httpcore", "openai"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.stdlib.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            redact_secrets,
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(numeric_level),
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=False,
    )


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """Return a logger that will include the active correlation context."""

    return structlog.get_logger(name)
