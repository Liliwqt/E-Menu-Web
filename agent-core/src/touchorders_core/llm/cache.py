"""Response cache (§14.2.3): identical bundle within a TTL is never re-billed.

Analysts are pure functions of their bundle, so a repeated bundle returns the previously validated
output for zero tokens. Entries store the *validated* output keyed by request hash.
"""

from __future__ import annotations

from dataclasses import dataclass

from touchorders_core.domain.common import utc_now
from touchorders_core.domain.enums import AgentName

# Default per-agent TTLs in seconds (§14.2.3). Manager entries are short-lived because its bundle
# embeds volatile state (active plans, READ-tool results).
DEFAULT_TTLS: dict[AgentName, int] = {
    AgentName.REALTIME_ANALYST: 600,
    AgentName.BUSINESS_ANALYST: 3300,
    AgentName.OPERATIONS_MANAGER: 20,
}


@dataclass
class _Entry:
    output: dict
    expires_at: float


class ResponseCache:
    def __init__(self, ttls: dict[AgentName, int] | None = None) -> None:
        self._ttls = ttls or DEFAULT_TTLS
        self._entries: dict[str, _Entry] = {}

    def get(self, request_hash: str) -> dict | None:
        entry = self._entries.get(request_hash)
        if entry is None:
            return None
        if utc_now().timestamp() >= entry.expires_at:
            del self._entries[request_hash]  # lazy expiry
            return None
        return entry.output

    def put(self, request_hash: str, output: dict, agent: AgentName) -> None:
        ttl = self._ttls.get(agent, 60)
        self._entries[request_hash] = _Entry(output=output, expires_at=utc_now().timestamp() + ttl)
