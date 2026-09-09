"""Shared pure-domain primitives."""

from __future__ import annotations

import secrets
import time
from datetime import UTC, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


def utc_now() -> datetime:
    """Return a timezone-aware UTC timestamp."""

    return datetime.now(UTC)


def uuid7() -> UUID:
    """Generate a UUIDv7 without a third-party runtime dependency."""

    milliseconds = int(time.time() * 1_000) & ((1 << 48) - 1)
    random_a = secrets.randbits(12)
    random_b = secrets.randbits(62)
    value = (milliseconds << 80) | (0x7 << 76) | (random_a << 64) | (0b10 << 62) | random_b
    return UUID(int=value)


class DomainModel(BaseModel):
    """Strict Pydantic base used for every cross-component contract."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)
