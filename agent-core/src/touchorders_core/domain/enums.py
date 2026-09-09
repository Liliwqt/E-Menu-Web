"""Closed domain vocabularies used by the AI gateway."""

from __future__ import annotations

from enum import StrEnum


class AgentName(StrEnum):
    """The three AI roles OpenAI performs through the gateway. Each carries its own daily token
    budget and ledger dimension; the roles are realized as system prompts sent by the dashboard,
    not as separate backend services."""

    REALTIME_ANALYST = "realtime_analyst"
    BUSINESS_ANALYST = "business_analyst"
    OPERATIONS_MANAGER = "operations_manager"
