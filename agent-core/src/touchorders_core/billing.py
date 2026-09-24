"""Branch subscription terms shared by manual activation and AI authorization."""
from __future__ import annotations

import calendar
from datetime import datetime
from zoneinfo import ZoneInfo

PRICES_PHP = {"basic": 750, "starter": 1100, "premium": 1750}
AI_ALLOWANCE = {"starter": 300, "premium": 1000}
STARTER_MODES = {"opschat", "realtime", "leak", "deep"}
PREMIUM_MODES = STARTER_MODES | {"live", "briefing", "executive", "simulation"}


def next_month_at(epoch_ms: int, timezone: str, anchor_day: int | None = None) -> int:
    """Same local wall-clock time next month; restore the anchor after short months."""
    local = datetime.fromtimestamp(epoch_ms / 1000, ZoneInfo(timezone))
    year = local.year + (local.month == 12)
    month = local.month % 12 + 1
    day = min(anchor_day or local.day, calendar.monthrange(year, month)[1])
    return int(local.replace(year=year, month=month, day=day).timestamp() * 1000)


def current_period_start(entitlement: dict, now_ms: int, timezone: str) -> int:
    """Find the calendar-month quota window of a paid entitlement."""
    start = int(entitlement["periodStartAt"])
    if entitlement.get("subscriptionStatus") == "trialing":
        return start
    anchor = datetime.fromtimestamp(start / 1000, ZoneInfo(timezone)).day
    while True:
        following = next_month_at(start, timezone, anchor)
        if following > now_ms:
            return start
        start = following
