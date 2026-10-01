"""Independent, transaction-safe Premium summary retention. No business deletion."""


def valid_insight_at(item, now):
    if not isinstance(item, dict):
        return None
    at = item.get("at")
    if isinstance(at, bool) or not isinstance(at, (int, float)):
        return None
    return int(at) if now - 90 * 86400000 < at <= now else None


def purge_insights(db, now, *, dry_run=False, company=None, branch=None):
    root = (
        "premiumInsights"
        + (f"/{company}" if company else "")
        + (f"/{branch}" if branch else "")
    )
    data = db.reference(root).get() or {}
    groups = (
        {company: {branch: data}} if branch else {company: data} if company else data
    )
    counts = {"branches": 0, "removed": 0}
    for c, branches in groups.items():
        for b, records in branches.items():
            counts["branches"] += 1

            def clean(value):
                value = value or {}
                kept = {
                    k: v
                    for k, v in value.items()
                    if valid_insight_at(v, now) is not None
                }
                keys = sorted(kept, key=lambda k: int(kept[k].get("at") or 0))[-100:]
                return {k: kept[k] for k in keys}

            before = len(records)
            after = (
                clean(records)
                if dry_run
                else db.reference(f"premiumInsights/{c}/{b}").transaction(clean)
            )
            counts["removed"] += max(0, before - len(after))
    return counts
