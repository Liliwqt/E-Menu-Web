"""Selected-branch allowlists. No raw records or identities cross the provider boundary."""

from __future__ import annotations
import json, math, re
from datetime import datetime
from statistics import mean, median, pstdev
from zoneinfo import ZoneInfo
from collections import Counter
from itertools import combinations
from touchorders_core.observability.privacy import safe_label

DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def number(value):
    try:
        n = float(value)
        return n if math.isfinite(n) else 0
    except (TypeError, ValueError):
        return 0


def metrics(value, fields=("orders", "revenue", "averageOrderValue")):
    return {k: number((value or {}).get(k)) for k in fields}


def patterns(daily, hourly, products, inventory, baskets):
    out = []

    def add(key, text, confidence):
        out.append(dict(key=key, text=text, confidence=confidence))

    days = sorted(hourly, reverse=True)[:14]
    opens = []
    closes = []
    byhour = [0] * 24
    for day in days:
        active = sorted(int(h) for h, v in hourly[day].items() if v["orders"] > 0)
        if active:
            opens.append(active[0])
            closes.append(active[-1])
        for h, v in hourly[day].items():
            byhour[int(h)] += v["revenue"]
    if len(opens) >= 4:
        opens.sort()
        closes.sort()
        conf = min(
            92,
            45 + len(opens) * 4 - (opens[-1] - opens[0] + closes[-1] - closes[0]) * 3,
        )
        if conf >= 40:
            add(
                "operating-hours",
                f"Recorded order activity typically spans {opens[len(opens)//4]}:00–{closes[len(closes)*3//4]}:00 over {len(opens)} active days.",
                round(conf),
            )
    total = sum(byhour)
    if len(days) >= 4 and total > 0:
        start = max(range(23), key=lambda h: byhour[h] + byhour[h + 1])
        share = round((byhour[start] + byhour[start + 1]) / total * 100)
        if share >= 20:
            add(
                "peak-window",
                f"{start}:00–{start+2}:00 accounts for {share}% of recorded revenue over {len(days)} days.",
                min(90, 40 + len(days) * 3 + min(20, share - 20)),
            )
    dow = [[] for _ in range(7)]
    for day, v in daily.items():
        if v["revenue"] > 0:
            dow[datetime.fromisoformat(day).weekday()].append(v["revenue"])
    avgs = {i: mean(v) for i, v in enumerate(dow) if len(v) >= 2}
    if len(avgs) >= 4:
        baseline = mean(avgs.values())
        best = max(avgs, key=avgs.get)
        if baseline > 0 and avgs[best] > baseline * 1.12:
            add(
                "best-weekday",
                f'{["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"][best]} average revenue ₱{avgs[best]:.2f}, {round((avgs[best]/baseline-1)*100)}% above typical sampled days ({len(dow[best])} samples).',
                min(88, 45 + len(dow[best]) * 8),
            )
        weekend = dow[5] + dow[6]
        weekday = sum(dow[:5], [])
        if len(weekend) >= 2 and len(weekday) >= 4 and mean(weekday) > 0:
            change = (mean(weekend) / mean(weekday) - 1) * 100
            if abs(change) >= 12:
                add(
                    "weekend-effect",
                    f'Weekend revenue is {abs(round(change))}% {"higher" if change>0 else "lower"} than weekdays.',
                    min(85, 40 + len(weekend) * 6),
                )
    if len(baskets) >= 10:
        counts = Counter(n for basket in baskets for n in basket)
        pairs = Counter(
            pair for basket in baskets for pair in combinations(sorted(basket), 2)
        )
        candidates = [
            (
                count * (count * len(baskets) / (counts[a] * counts[b])),
                a,
                b,
                count,
                count * len(baskets) / (counts[a] * counts[b]),
            )
            for (a, b), count in pairs.items()
            if count >= 3 and count * len(baskets) / (counts[a] * counts[b]) > 1.4
        ]
        if candidates:
            _, a, b, count, lift = max(candidates)
            add(
                "product-pair",
                f"{a} and {b}: {count} shared orders, {lift:.1f}× expected co-occurrence; a potential bundle.",
                min(85, 35 + count * 8),
            )
    candidates = []
    for item in inventory:
        product = next(
            (p for p in products if p["name"].lower() == item["name"].lower()), None
        )
        velocity = (product["quantitySold"] / max(1, len(daily))) if product else 0
        if velocity >= 0.5 and item["stock"] > 0 and item["stock"] / velocity <= 10:
            candidates.append((velocity, item["name"], item["stock"] / velocity))
    if candidates:
        velocity, name, cadence = max(candidates)
        add(
            "restock-cadence",
            f"{name}: ~{velocity:.1f} units/day; current stock covers ~{max(1,round(cadence))} days.",
            70,
        )
    entries = sorted(daily.items())
    positive = [v["revenue"] for _, v in entries if v["revenue"] > 0]
    if len(positive) >= 8:
        prior = positive[-15:-1]
        sd = pstdev(prior)
        baseline = mean(prior)
        if sd > 0 and baseline > 0 and abs((positive[-1] - baseline) / sd) >= 1.8:
            add(
                "anomaly",
                f"Latest positive-revenue day: ₱{positive[-1]:.2f} versus recent mean ₱{baseline:.2f}.",
                min(85, 50 + round(abs((positive[-1] - baseline) / sd) * 10)),
            )
    values = [v["revenue"] for _, v in entries]
    if len(values) >= 12 and mean(values[-14:-7]) > 0:
        change = (mean(values[-7:]) / mean(values[-14:-7]) - 1) * 100
        if abs(change) >= 8:
            add(
                "momentum",
                f"Last seven recorded days average ₱{mean(values[-7:]):.2f}; {round(change)}% versus prior sampled week.",
                75,
            )
    return sorted(out, key=lambda p: -p["confidence"])


def build_context(db, grant, mode, *, now_ms, memory=()):
    base = f"{grant.company}/branches/{grant.branch}"
    # Explicit reads only. Never read a company/root snapshot.
    summary = db.reference(base + "/analytics/summary").get() or {}
    product_rows = db.reference(base + "/analytics/products").get() or {}
    daily_raw = db.reference(base + "/analytics/daily").get() or {}
    hourly_raw = db.reference(base + "/analytics/hourly").get() or {}
    categories = db.reference(base + "/categories").get() or {}

    def norm(text):
        return re.sub(r"[ _-]+", " ", str(text).strip().casefold())

    active = {}
    inv = []
    raw_inv = (
        (db.reference(base + "/inventory").get() or {})
        if grant.plan == "premium"
        else {}
    )
    for category, items in categories.items():
        for item_id, item in (items or {}).items():
            if (
                not isinstance(item, dict)
                or not item.get("name")
                or item_id.startswith("_")
            ):
                continue
            label = safe_label(item["name"])
            active[item_id] = label
            active[norm(label)] = label
            sizes = ((raw_inv.get(category) or {}).get(item_id) or {}).get("sizes") or {
                "Medium": {"currentStock": 1}
            }
            if grant.plan == "premium":
                for size, value in sizes.items():
                    parent = (raw_inv.get(category) or {}).get(item_id) or {}
                    inv.append(
                        dict(
                            name=label,
                            size=safe_label(size, "Size"),
                            stock=number(
                                (value or {}).get(
                                    "stock", (value or {}).get("currentStock", 1)
                                )
                            ),
                            warningLevel=number(
                                (value or {}).get(
                                    "warningLevel", parent.get("warningLevel", 10)
                                )
                            ),
                            criticalLevel=number(
                                (value or {}).get(
                                    "criticalLevel", parent.get("criticalLevel", 5)
                                )
                            ),
                            available=item.get("available") is not False,
                        )
                    )
    products = []
    for key, p in product_rows.items():
        label = safe_label(p.get("name") or key)
        if key in active or norm(label) in active:
            products.append(
                dict(
                    name=label, **metrics(p, ("quantitySold", "revenue", "orderCount"))
                )
            )
    products.sort(key=lambda p: -p["quantitySold"])
    inv.sort(key=lambda p: p["stock"])
    daily = {}
    for key, value in daily_raw.items():
        if not DATE.fullmatch(key):
            continue
        try:
            datetime.fromisoformat(key)
        except ValueError:
            continue
        daily[key] = metrics(value)
    hourly = {
        day: {
            h: metrics(v, ("orders", "revenue"))
            for h, v in (hours or {}).items()
            if h.isdigit() and 0 <= int(h) < 24
        }
        for day, hours in hourly_raw.items()
        if day in daily
    }
    profile = db.reference(base + "/branchProfile/timezone").get() or "Asia/Manila"
    try:
        zone = ZoneInfo(profile)
    except (ValueError, KeyError):
        zone = ZoneInfo("Asia/Manila")
    now = datetime.fromtimestamp(now_ms / 1000, zone)
    today = now.date().isoformat()
    week = now.isocalendar()[:2]
    week_rows = [
        v
        for k, v in daily.items()
        if datetime.fromisoformat(k).isocalendar()[:2] == week
    ]
    month_rows = [v for k, v in daily.items() if k.startswith(today[:7])]

    def totals(rows):
        return dict(
            orders=sum(v["orders"] for v in rows),
            revenue=sum(v["revenue"] for v in rows),
        )

    baskets = []
    sampled = False
    if grant.plan == "premium":
        # Pair detector projects names only; identities, order IDs and payment data are never returned.
        logs = db.reference(base + "/logs").get() or {}
        exclusions = db.reference(base + "/analyticsExclusions").get() or {}
        ordered = sorted(
            logs.items(), key=lambda kv: str((kv[1] or {}).get("timestamp") or "")
        )
        sampled = len(ordered) > 2000
        for key, log in ordered[-2000:]:
            if (
                log.get("analyticsExcluded") is True
                or (exclusions.get(str(log.get("orderId") or key)) or {}).get(
                    "excluded"
                )
                is True
            ):
                continue
            items = log.get("items") or []
            items = items.values() if isinstance(items, dict) else items
            basket = {
                safe_label(i.get("name"))
                for i in items
                if isinstance(i, dict)
                and i.get("name")
                and norm(safe_label(i["name"])) in active
            }
            if basket:
                baskets.append(basket)
        del logs, ordered
    full = mode in ("deep", "executive")
    compact = mode in ("live", "realtime")
    n = 14 if full else 3 if compact else 7
    context = dict(
        asOf=now.isoformat(),
        manager="Manager",
        branch="Current branch",
        summary={
            **metrics(summary, ("totalOrders", "totalRevenue", "averageOrderValue")),
            "bestSellingItem": (products[0]["name"] if products else None),
            "leastSellingItem": (products[-1]["name"] if products else None),
        },
        today=metrics(daily.get(today)),
        week=totals(week_rows),
        month=totals(month_rows),
        statistics={
            f: dict(
                mean=mean([v[f] for v in daily.values()]) if daily else 0,
                median=median([v[f] for v in daily.values()]) if daily else 0,
            )
            for f in ("orders", "revenue")
        },
        products=products[: 12 if full else 6 if compact else 10],
        slowerProducts=products[-3:] if full and len(products) > 15 else [],
        daily={k: daily[k] for k in sorted(daily, reverse=True)[:n]},
        hourly={
            k: hourly[k]
            for k in sorted(hourly, reverse=True)[: 7 if full else 1 if compact else 5]
        },
        detectedPatterns=patterns(daily, hourly, products, inv, baskets),
        limitations=["No customer views, abandoned-cart or service-time observations."],
        contextTruncated=sampled,
    )
    if grant.plan == "premium":
        context.update(
            inventory=inv[: 20 if full else 8 if compact else 15], insights=list(memory)
        )
    if full:
        for field, limit in (("weekly", 8), ("monthly", 6)):
            raw = db.reference(base + "/analytics/" + field).get() or {}
            context[field] = {
                k: metrics(raw[k], ("orders", "revenue"))
                for k in sorted(raw, reverse=True)[:limit]
                if re.fullmatch(r"\d{4}-(?:W\d{2}|\d{2})", k)
            }

    def size():
        return len(json.dumps(context, ensure_ascii=False))

    # Totals are immutable; prune optional rows only, disclose bounded sampling.
    while size() > 26000:
        changed = False
        for key in (
            "insights",
            "inventory",
            "slowerProducts",
            "products",
            "detectedPatterns",
            "hourly",
            "daily",
            "weekly",
            "monthly",
        ):
            rows = context.get(key)
            if rows:
                if isinstance(rows, list):
                    rows.pop()
                else:
                    rows.pop(next(reversed(rows)))
                changed = True
                context["contextTruncated"] = True
                break
        if not changed:
            raise ValueError("context_size")
    if context["contextTruncated"]:
        context["limitations"].append(
            "Optional context was bounded or sampled; overall totals are unchanged."
        )
    return context
