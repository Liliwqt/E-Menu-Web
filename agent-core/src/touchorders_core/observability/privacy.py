"""Small deterministic privacy boundary; never send a matched credential onward."""

from __future__ import annotations

import re

CREDENTIAL = re.compile(
    r"(?:\bsk-[A-Za-z0-9_-]{8,}|\b(?:Bearer\s+)?eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|-----BEGIN[^\n]*PRIVATE KEY-----|(?:password|api[_ -]?key|secret|token|pin)\s*[:=]\s*\S+)",
    re.I,
)
EMAIL = re.compile(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")
PHONE = re.compile(
    r"(?<![\w₱$])(?:\+63[\s().-]*\d(?:[\s().-]*\d){9}|09(?:[\s().-]*\d){9}|\+\d(?:[\s().-]*\d){9,14})(?!\w)"
)
URL_AUTH = re.compile(r"([?&](?:auth|token|key|api_key|secret)=)[^&\s\"']+", re.I)
BEARER = re.compile(r"\bBearer\s+[^\s\"']+", re.I)


def redact_text(text: str) -> str:
    text = re.sub(
        r"-----BEGIN[^\n]*PRIVATE KEY-----.*?(?:-----END[^\n]*PRIVATE KEY-----|$)",
        "[REDACTED_CREDENTIAL]",
        text,
        flags=re.S,
    )
    text = CREDENTIAL.sub("[REDACTED_CREDENTIAL]", text)
    text = URL_AUTH.sub(r"\1[REDACTED]", text)
    text = BEARER.sub("Bearer [REDACTED]", text)
    text = EMAIL.sub("[REDACTED_CONTACT]", text)
    return PHONE.sub("[REDACTED_CONTACT]", text)


def safe_input(text: str, *, limit: int = 2000) -> str:
    if (
        CREDENTIAL.search(text)
        or BEARER.search(text)
        or URL_AUTH.search(text)
        or "-----BEGIN" in text
    ):
        raise ValueError("credential_input")
    return redact_text(text).replace("\x00", "").strip()[:limit]


def safe_label(value: object, fallback: str = "Product") -> str:
    text = str(value or fallback)
    if CREDENTIAL.search(text):
        return fallback
    return " ".join(redact_text(text).split())[:100] or fallback
