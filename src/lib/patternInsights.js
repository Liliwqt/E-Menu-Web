/**
 * Deterministic operational pattern detection (V2).
 *
 * Analyzes the branch's existing history (analytics + order logs — no new
 * reads, no schema changes) and surfaces recurring operational patterns:
 * operating hours, peak windows, weekday effects, product pairings,
 * sell-through cadence, anomalies and trends.
 *
 * Output feeds two consumers:
 *  1. The dashboard "Detected Patterns" section (visible evidence-based cards).
 *  2. The AI prompts (as a DETECTED PATTERNS section), so every AI mode grounds
 *     its narrative in real, pre-computed patterns instead of guessing.
 *
 * Every insight carries: text (what + why + evidence) and confidence (0–100).
 */

import { formatCurrency } from './statisticsUtils';
import { formatHourLabel } from './executiveMetrics';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parseKey(dateKey) {
  return new Date(`${dateKey}T00:00:00`);
}

function mean(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

/** Operating hours: earliest/latest hours with activity, consistent across days. */
function detectOperatingHours(hourly = {}) {
  const days = Object.entries(hourly).sort(([a], [b]) => b.localeCompare(a)).slice(0, 14);
  const opens = [];
  const closes = [];
  for (const [, hours] of days) {
    const active = Object.entries(hours || {})
      .filter(([, d]) => Number(d.orders || 0) > 0)
      .map(([h]) => parseInt(h, 10))
      .sort((a, b) => a - b);
    if (active.length > 0) {
      opens.push(active[0]);
      closes.push(active[active.length - 1]);
    }
  }
  if (opens.length < 4) return null;

  opens.sort((a, b) => a - b);
  closes.sort((a, b) => a - b);
  const openTypical = opens[Math.floor(opens.length * 0.25)];
  const closeTypical = closes[Math.floor(closes.length * 0.75)];
  const openSpread = opens[opens.length - 1] - opens[0];
  const closeSpread = closes[closes.length - 1] - closes[0];
  const confidence = Math.min(92, 45 + opens.length * 4 - (openSpread + closeSpread) * 3);
  if (confidence < 40) return null;

  return {
    key: 'operating-hours',
    tag: 'Operating rhythm',
    text: `Order activity consistently runs from about ${formatHourLabel(openTypical)} to ${formatHourLabel(closeTypical)} — across the last ${opens.length} active days there is no measurable customer activity outside that window.`,
    confidence: Math.round(confidence),
  };
}

/** Peak revenue window and its share of daily revenue. */
function detectPeakWindow(hourly = {}) {
  const days = Object.entries(hourly).sort(([a], [b]) => b.localeCompare(a)).slice(0, 14);
  if (days.length < 4) return null;

  const hourRevenue = Array(24).fill(0);
  let total = 0;
  for (const [, hours] of days) {
    for (const [h, d] of Object.entries(hours || {})) {
      const hour = parseInt(h, 10);
      const rev = Number(d.revenue || 0);
      if (hour >= 0 && hour <= 23) { hourRevenue[hour] += rev; total += rev; }
    }
  }
  if (total <= 0) return null;

  // Best contiguous 2-hour window.
  let bestStart = 0;
  let bestSum = 0;
  for (let h = 0; h < 23; h += 1) {
    const sum = hourRevenue[h] + hourRevenue[h + 1];
    if (sum > bestSum) { bestSum = sum; bestStart = h; }
  }
  const share = Math.round((bestSum / total) * 100);
  if (share < 20) return null;

  return {
    key: 'peak-window',
    tag: 'Peak revenue window',
    text: `The ${formatHourLabel(bestStart)}–${formatHourLabel(bestStart + 2)} window generates about ${share}% of daily revenue (${days.length}-day sample). Staffing and prep should be fully ready before ${formatHourLabel(bestStart)}.`,
    confidence: Math.min(90, 40 + days.length * 3 + Math.min(20, share - 20)),
  };
}

/** Weekday effects: strongest day + weekend vs weekday delta. */
function detectWeekdayPatterns(daily = {}) {
  const byDow = Array.from({ length: 7 }, () => []);
  Object.entries(daily).forEach(([key, d]) => {
    const rev = Number(d.revenue || 0);
    if (rev > 0) byDow[parseKey(key).getDay()].push(rev);
  });

  const out = [];
  const avgs = byDow.map((list) => (list.length >= 2 ? mean(list) : null));
  const known = avgs.filter((v) => v !== null);
  if (known.length >= 4) {
    const overall = mean(known);
    let bestDow = -1;
    avgs.forEach((v, i) => { if (v !== null && (bestDow === -1 || v > avgs[bestDow])) bestDow = i; });
    if (bestDow >= 0 && overall > 0 && avgs[bestDow] > overall * 1.12) {
      const lift = Math.round(((avgs[bestDow] - overall) / overall) * 100);
      out.push({
        key: 'best-weekday',
        tag: 'Weekly pattern',
        text: `${WEEKDAYS[bestDow]}s consistently produce your highest revenue — averaging ${formatCurrency(avgs[bestDow])}, about ${lift}% above your typical day (${byDow[bestDow].length} ${WEEKDAYS[bestDow]}s sampled).`,
        confidence: Math.min(88, 45 + byDow[bestDow].length * 8),
      });
    }

    const weekendVals = [...byDow[0], ...byDow[6]];
    const weekdayVals = [1, 2, 3, 4, 5].flatMap((i) => byDow[i]);
    if (weekendVals.length >= 2 && weekdayVals.length >= 4) {
      const diff = ((mean(weekendVals) - mean(weekdayVals)) / mean(weekdayVals)) * 100;
      if (Math.abs(diff) >= 12) {
        out.push({
          key: 'weekend-effect',
          tag: 'Weekly pattern',
          text: diff > 0
            ? `Weekend sales run about ${Math.round(diff)}% higher than weekdays — plan stock and staffing up for Saturday and Sunday.`
            : `Weekends run about ${Math.round(Math.abs(diff))}% quieter than weekdays — a weekend promotion could lift underused capacity.`,
          confidence: Math.min(85, 40 + weekendVals.length * 6),
        });
      }
    }
  }
  return out;
}

/** Frequently paired products (co-occurrence within the same order). */
function detectProductPairs(logs = []) {
  const pairCounts = new Map();
  const itemCounts = new Map();
  let orders = 0;

  for (const log of logs) {
    if (log?.analyticsExcluded === true) continue;
    const items = log?.items ? (Array.isArray(log.items) ? log.items : Object.values(log.items)) : [];
    const names = [...new Set(items.map((i) => String(i.name || '').trim()).filter(Boolean))];
    if (names.length === 0) continue;
    orders += 1;
    names.forEach((n) => itemCounts.set(n, (itemCounts.get(n) || 0) + 1));
    for (let a = 0; a < names.length; a += 1) {
      for (let b = a + 1; b < names.length; b += 1) {
        const pairKey = [names[a], names[b]].sort().join('|');
        pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
      }
    }
  }
  if (orders < 10) return null;

  let best = null;
  pairCounts.forEach((count, pairKey) => {
    if (count < 3) return;
    const [a, b] = pairKey.split('|');
    const expected = ((itemCounts.get(a) || 0) * (itemCounts.get(b) || 0)) / orders;
    const lift = expected > 0 ? count / expected : 0;
    if (lift > 1.4 && (!best || count * lift > best.count * best.lift)) {
      best = { a, b, count, lift };
    }
  });
  if (!best) return null;

  return {
    key: 'product-pair',
    tag: 'Purchasing habit',
    text: `${best.a} and ${best.b} are ordered together far more often than chance predicts (${best.count} shared orders, ${best.lift.toFixed(1)}× the expected rate) — a natural bundle or combo candidate.`,
    confidence: Math.min(85, 35 + best.count * 8),
  };
}

/** Sell-through cadence for the fastest mover with tracked stock. */
function detectRestockCadence(inventory = {}, products = {}, daily = {}) {
  const dayCount = Math.max(1, Object.keys(daily).length);
  let best = null;
  for (const item of Object.values(inventory)) {
    const name = String(item.productName || '').trim();
    if (!name) continue;
    const product = Object.values(products).find(
      (p) => String(p.name || '').trim().toLowerCase() === name.toLowerCase()
    );
    const velocity = product ? Number(product.quantitySold || 0) / dayCount : 0;
    const stock = Number(item.stock ?? item.currentStock ?? 0);
    if (velocity >= 0.5 && stock > 0) {
      const cadence = stock / velocity;
      if (cadence <= 10 && (!best || velocity > best.velocity)) {
        best = { name, cadence, velocity };
      }
    }
  }
  if (!best) return null;

  return {
    key: 'restock-cadence',
    tag: 'Inventory consumption',
    text: `${best.name} sells through its current stock roughly every ${Math.max(1, Math.round(best.cadence))} day${Math.round(best.cadence) === 1 ? '' : 's'} at the present pace (~${best.velocity.toFixed(1)} sold/day) — align your reorder cycle to that cadence.`,
    confidence: 70,
  };
}

/** Sales anomaly: most recent completed day vs trailing norm. */
function detectAnomaly(daily = {}) {
  const entries = Object.entries(daily)
    .filter(([, d]) => Number(d.revenue || 0) > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  if (entries.length < 8) return null;

  const values = entries.map(([, d]) => Number(d.revenue || 0));
  const last = values[values.length - 1];
  const prior = values.slice(-15, -1);
  const m = mean(prior);
  const sd = Math.sqrt(mean(prior.map((v) => (v - m) ** 2)));
  if (sd <= 0 || m <= 0) return null;
  const z = (last - m) / sd;
  if (Math.abs(z) < 1.8) return null;

  const lastLabel = parseKey(entries[entries.length - 1][0]).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  return {
    key: 'anomaly',
    tag: 'Sales anomaly',
    text: z > 0
      ? `${lastLabel} was unusually strong: ${formatCurrency(last)} vs a ${formatCurrency(m)} recent norm (+${Math.round(((last - m) / m) * 100)}%). Check what drove it — weather, an event, or a promotion worth repeating.`
      : `${lastLabel} was unusually weak: ${formatCurrency(last)} vs a ${formatCurrency(m)} recent norm (${Math.round(((last - m) / m) * 100)}%). Worth reviewing staffing, stockouts, or external factors that day.`,
    confidence: Math.min(85, 50 + Math.round(Math.abs(z) * 10)),
  };
}

/** Momentum: last 7 days vs the 7 before. */
function detectMomentum(daily = {}) {
  const entries = Object.entries(daily).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length < 10) return null;
  const values = entries.map(([, d]) => Number(d.revenue || 0));
  const recent = values.slice(-7);
  const prior = values.slice(-14, -7);
  if (prior.length < 5) return null;
  const recentAvg = mean(recent);
  const priorAvg = mean(prior);
  if (priorAvg <= 0) return null;
  const change = ((recentAvg - priorAvg) / priorAvg) * 100;
  if (Math.abs(change) < 8) return null;

  return {
    key: 'momentum',
    tag: change > 0 ? 'Performance improvement' : 'Performance decline',
    text: change > 0
      ? `Revenue is trending up: the last 7 days averaged ${formatCurrency(recentAvg)}/day, ${Math.round(change)}% above the prior week. Whatever changed recently is working — identify and protect it.`
      : `Revenue is softening: the last 7 days averaged ${formatCurrency(recentAvg)}/day, ${Math.round(Math.abs(change))}% below the prior week. Review product availability, peak-hour staffing and recent menu changes.`,
    confidence: 75,
  };
}

/**
 * Run every detector. Returns [{ key, tag, text, confidence }] sorted by confidence.
 */
export function detectPatterns({ analytics = {}, logs = [], inventory = {} } = {}) {
  const daily = analytics.daily || {};
  const hourly = analytics.hourly || {};
  const products = analytics.products || {};

  const insights = [
    detectOperatingHours(hourly),
    detectPeakWindow(hourly),
    ...detectWeekdayPatterns(daily),
    detectProductPairs(logs),
    detectRestockCadence(inventory, products, daily),
    detectAnomaly(daily),
    detectMomentum(daily),
  ].filter(Boolean);

  return insights.sort((a, b) => b.confidence - a.confidence);
}
