/**
 * Executive Metrics — pure client-side derivations for the executive dashboard.
 *
 * Everything in this module computes from data that already exists in Firebase
 * ({branchId}/analytics and {branchId}/logs). It performs NO reads or writes of
 * its own, so the production schema and pilot devices are untouched.
 *
 * Honesty rules:
 * - Metrics the platform does not track (waitlist, satisfaction surveys,
 *   dining time) return { tracked: false } instead of invented numbers.
 * - Forecasts are always returned with `isForecast: true` and a confidence
 *   estimate so the UI can label them clearly.
 */

import { formatDateKey, formatWeekKey } from './analyticsApi';
import { calculateMean, calculateGrowthPercentage } from './statisticsUtils';

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function parseDateKey(dateKey) {
  return new Date(`${dateKey}T00:00:00`);
}

function eachDateKey(fromKey, toKey, cap = 366) {
  const keys = [];
  let cursor = parseDateKey(fromKey);
  const end = parseDateKey(toKey);
  while (cursor <= end && keys.length < cap) {
    keys.push(formatDateKey(cursor));
    cursor = addDays(cursor, 1);
  }
  return keys;
}

export function formatPeriodLabel(dateKeys) {
  if (!dateKeys || dateKeys.length === 0) return '—';
  const opts = { month: 'short', day: 'numeric' };
  const first = parseDateKey(dateKeys[0]).toLocaleDateString('en-US', opts);
  if (dateKeys.length === 1) return first;
  const last = parseDateKey(dateKeys[dateKeys.length - 1]).toLocaleDateString('en-US', opts);
  return `${first} – ${last}`;
}

/**
 * Resolve a period selection into concrete date keys plus the matching
 * comparison window (same length, immediately preceding).
 *
 * selection: { type: 'today' | 'yesterday' | 'date' | 'range', date?, from?, to? }
 */
export function resolvePeriod(selection, now = new Date()) {
  const todayKey = formatDateKey(now);
  const type = selection?.type || 'today';

  let dateKeys;
  let label;

  if (type === 'yesterday') {
    dateKeys = [formatDateKey(addDays(now, -1))];
    label = 'Yesterday';
  } else if (type === 'date' && selection.date) {
    dateKeys = [selection.date];
    label = parseDateKey(selection.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  } else if (type === 'range' && selection.from && selection.to) {
    const from = selection.from <= selection.to ? selection.from : selection.to;
    const to = selection.from <= selection.to ? selection.to : selection.from;
    dateKeys = eachDateKey(from, to);
    label = formatPeriodLabel(dateKeys);
  } else {
    dateKeys = [todayKey];
    label = 'Today';
  }

  // Comparison window: previous day for single days, preceding block for ranges.
  const spanDays = dateKeys.length;
  const compareEnd = addDays(parseDateKey(dateKeys[0]), -1);
  const compareStart = addDays(compareEnd, -(spanDays - 1));
  const compareKeys = eachDateKey(formatDateKey(compareStart), formatDateKey(compareEnd));

  // Same window one week earlier (for "vs last week" on single-day views).
  const lastWeekKeys = dateKeys.map((key) => formatDateKey(addDays(parseDateKey(key), -7)));

  return {
    type,
    dateKeys,
    label,
    isToday: type === 'today' || (dateKeys.length === 1 && dateKeys[0] === todayKey),
    compareKeys,
    compareLabel: spanDays === 1 ? 'previous day' : `previous ${spanDays} days`,
    lastWeekKeys,
  };
}

// Core period aggregation

function sumDaily(dailyData = {}, dateKeys = []) {
  let orders = 0;
  let revenue = 0;
  for (const key of dateKeys) {
    orders += Number(dailyData[key]?.orders || 0);
    revenue += Number(dailyData[key]?.revenue || 0);
  }
  return { orders, revenue, averageOrderValue: orders > 0 ? revenue / orders : 0 };
}

function sumHourly(hourlyData = {}, dateKeys = []) {
  const hours = Array(24).fill(0);
  const hourRevenue = Array(24).fill(0);
  for (const key of dateKeys) {
    const day = hourlyData[key];
    if (!day) continue;
    for (const [hourStr, data] of Object.entries(day)) {
      const hour = parseInt(hourStr, 10);
      if (hour >= 0 && hour <= 23) {
        hours[hour] += Number(data.orders || 0);
        hourRevenue[hour] += Number(data.revenue || 0);
      }
    }
  }
  return { hours, hourRevenue };
}

export function formatHourLabel(hour) {
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const display = hour % 12 || 12;
  return `${display}:00 ${suffix}`;
}

/**
 * Peak business window: the contiguous stretch of top-volume hours.
 */
function derivePeakHours(hours) {
  const max = Math.max(...hours);
  if (max <= 0) return null;

  const threshold = max * 0.6;
  let bestStart = hours.indexOf(max);
  let start = bestStart;
  let end = bestStart;
  while (start > 0 && hours[start - 1] >= threshold) start -= 1;
  while (end < 23 && hours[end + 1] >= threshold) end += 1;

  return {
    peakHour: bestStart,
    peakOrders: max,
    windowStart: start,
    windowEnd: end,
    label: start === end
      ? formatHourLabel(start)
      : `${formatHourLabel(start)} – ${formatHourLabel((end + 1) % 24)}`,
  };
}

/**
 * Aggregate one period into the metrics the executive dashboard shows.
 */
export function getPeriodMetrics(analytics = {}, dateKeys = []) {
  const daily = analytics.daily || {};
  const hourly = analytics.hourly || {};

  const totals = sumDaily(daily, dateKeys);
  const { hours, hourRevenue } = sumHourly(hourly, dateKeys);
  const peak = derivePeakHours(hours);

  return {
    ...totals,
    hourlyOrders: hours,
    hourlyRevenue: hourRevenue,
    peak,
  };
}

/**
 * Delta between two aggregates. Returns null when the comparison basis is
 * empty so the UI can say "no comparison data" instead of a fake +100%.
 */
export function getDelta(currentValue, previousValue) {
  const current = Number(currentValue || 0);
  const previous = Number(previousValue || 0);
  if (previous === 0 && current === 0) return { pct: 0, direction: 'flat', available: true };
  if (previous === 0) return { pct: null, direction: current > 0 ? 'up' : 'flat', available: false };
  const pct = calculateGrowthPercentage(current, previous);
  return {
    pct,
    direction: pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'flat',
    available: true,
  };
}

/**
 * Revenue/orders sparkline for the trailing N days ending on the period end.
 */
export function getSparkline(dailyData = {}, endDateKey, days = 7, field = 'revenue') {
  if (!endDateKey) return [];
  const end = parseDateKey(endDateKey);
  const series = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const key = formatDateKey(addDays(end, -i));
    series.push(Number(dailyData[key]?.[field] || 0));
  }
  return series;
}

// Order-log derived stats (per-period products, categories, returns)

function getLogItems(log) {
  if (!log?.items) return [];
  return Array.isArray(log.items) ? log.items : Object.values(log.items);
}

function isCountableLog(log) {
  if (!log || typeof log !== 'object') return false;
  if (log.analyticsExcluded === true) return false;
  const status = String(log.status || '').toLowerCase();
  return !['cancelled', 'canceled', 'void', 'voided', 'refunded', 'deleted'].includes(status);
}

function logDateKey(log) {
  const ts = log.timestamp || log.createdAt;
  if (!ts) return null;
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? null : formatDateKey(date);
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

/**
 * Build a lookup of normalized product name/id → category from the merged
 * menu+inventory feed (see inventoryApi.onMenuAndInventoryChange).
 */
export function buildCategoryIndex(inventory = {}) {
  const index = new Map();
  for (const item of Object.values(inventory)) {
    const category = item?._category;
    if (!category) continue;
    for (const key of [item.productName, item._itemId]) {
      const normalized = normalizeKey(key);
      if (normalized && !index.has(normalized)) index.set(normalized, category);
    }
  }
  return index;
}

/**
 * Per-period product and category performance derived from order logs.
 * Logs are the only place item-level data carries a timestamp, so this is the
 * correct (and only) backward-compatible source for "Popular items today".
 */
export function getPeriodProductStats(logs = [], dateKeys = [], categoryIndex = new Map()) {
  const inPeriod = new Set(dateKeys);
  const products = new Map();
  const categories = new Map();
  let matchedOrders = 0;

  for (const log of logs) {
    if (!isCountableLog(log)) continue;
    const key = logDateKey(log);
    if (!key || !inPeriod.has(key)) continue;
    matchedOrders += 1;

    for (const item of getLogItems(log)) {
      const name = item.name || item.productName || item.itemId || item.id;
      if (!name) continue;
      const qty = Number(item.quantity || 1);
      const revenue = Number(item.subtotal || (Number(item.price || 0) * qty) || 0);
      const pKey = normalizeKey(name);

      const product = products.get(pKey) || { name, quantity: 0, revenue: 0 };
      product.quantity += qty;
      product.revenue += revenue;
      products.set(pKey, product);

      const category = categoryIndex.get(pKey) || categoryIndex.get(normalizeKey(item.itemId || item.id)) || null;
      if (category) {
        const cat = categories.get(category) || { name: category, quantity: 0, revenue: 0 };
        cat.quantity += qty;
        cat.revenue += revenue;
        categories.set(category, cat);
      }
    }
  }

  const rankedProducts = Array.from(products.values()).sort((a, b) => b.quantity - a.quantity);
  const rankedCategories = Array.from(categories.values()).sort((a, b) => b.revenue - a.revenue);

  return {
    matchedOrders,
    topProducts: rankedProducts.slice(0, 5),
    bestCategory: rankedCategories[0] || null,
    worstCategory: rankedCategories.length > 1 ? rankedCategories[rankedCategories.length - 1] : null,
    categories: rankedCategories,
  };
}

// Inventory health

export function getInventoryHealth(inventory = {}) {
  const items = Object.values(inventory);
  if (items.length === 0) {
    return { tracked: false, score: null, critical: [], warning: [], total: 0 };
  }

  const critical = [];
  const warning = [];
  for (const item of items) {
    const stock = Number(item.stock ?? item.currentStock ?? 0);
    const warnAt = Number(item.warningLevel ?? 10);
    const critAt = Number(item.criticalLevel ?? 5);
    const label = `${item.productName || 'Item'}${item._sizeName && item._sizeName !== 'Medium' ? ` (${item._sizeName})` : ''}`;
    if (stock <= critAt) critical.push({ label, stock, unit: item.unit || 'units' });
    else if (stock <= warnAt) warning.push({ label, stock, unit: item.unit || 'units' });
  }

  const healthy = items.length - critical.length - warning.length;
  const score = Math.round(((healthy + warning.length * 0.5) / items.length) * 100);

  return { tracked: true, score, critical, warning, total: items.length };
}

// Business Health Score

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Composite Business Health Score with an explainable breakdown.
 * Components without underlying data are excluded from the composite and
 * flagged so the UI (and the AI) can say why.
 */
export function getBusinessHealthScore({ analytics = {}, periodMetrics, compareMetrics, inventoryHealth, returnRate }) {
  const daily = analytics.daily || {};
  const dailyEntries = Object.entries(daily).sort(([a], [b]) => a.localeCompare(b));
  const recentRevenues = dailyEntries.slice(-14).map(([, d]) => Number(d.revenue || 0));
  const meanRevenue = calculateMean(recentRevenues);

  const components = [];

  // Sales performance: period revenue against the recent daily norm.
  if (meanRevenue > 0 && periodMetrics) {
    const expected = meanRevenue * Math.max(1, periodMetrics.dayCount || 1);
    const ratio = periodMetrics.revenue / expected;
    components.push({
      key: 'sales',
      label: 'Sales Performance',
      score: clampScore(50 + (ratio - 1) * 100 + 25),
      note: ratio >= 1
        ? 'Revenue is running at or above the recent daily norm.'
        : 'Revenue is below the recent daily norm.',
      tracked: true,
    });
  } else {
    components.push({ key: 'sales', label: 'Sales Performance', score: null, tracked: false, note: 'Needs more sales history.' });
  }

  // Inventory management
  if (inventoryHealth?.tracked) {
    components.push({
      key: 'inventory',
      label: 'Inventory Management',
      score: clampScore(inventoryHealth.score),
      note: inventoryHealth.critical.length > 0
        ? `${inventoryHealth.critical.length} item(s) at critical stock.`
        : inventoryHealth.warning.length > 0
          ? `${inventoryHealth.warning.length} item(s) below warning level.`
          : 'Stock levels are healthy.',
      tracked: true,
    });
  } else {
    components.push({ key: 'inventory', label: 'Inventory Management', score: null, tracked: false, note: 'Inventory tracking not configured.' });
  }

  // V2 revision: the customer-loyalty component was removed on pilot feedback —
  // low operational value for SME cafés. The composite now reflects sales,
  // inventory, operational consistency and profitability trend. (returnRate is
  // still accepted for call-site compatibility but no longer scored.)

  // Operational efficiency: order flow consistency across recent days.
  const recentOrders = dailyEntries.slice(-14).map(([, d]) => Number(d.orders || 0));
  if (recentOrders.length >= 3) {
    const mean = calculateMean(recentOrders);
    const variance = calculateMean(recentOrders.map((v) => (v - mean) ** 2));
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
    components.push({
      key: 'operations',
      label: 'Operational Efficiency',
      score: clampScore(100 - cv * 55),
      note: cv < 0.4 ? 'Order volume is consistent day to day.' : 'Order volume swings widely between days.',
      tracked: true,
    });
  } else {
    components.push({ key: 'operations', label: 'Operational Efficiency', score: null, tracked: false, note: 'Needs at least 3 days of history.' });
  }

  // Profitability trend: direction of the recent revenue trend line.
  if (recentRevenues.length >= 4 && meanRevenue > 0) {
    const n = recentRevenues.length;
    let sumX = 0; let sumY = 0; let sumXY = 0; let sumXX = 0;
    recentRevenues.forEach((y, x) => { sumX += x; sumY += y; sumXY += x * y; sumXX += x * x; });
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const slopePct = slope / meanRevenue; // relative daily change
    components.push({
      key: 'profitability',
      label: 'Profitability Trend',
      score: clampScore(70 + slopePct * 600),
      note: slopePct > 0.005 ? 'Revenue trend is rising.' : slopePct < -0.005 ? 'Revenue trend is declining.' : 'Revenue trend is flat.',
      tracked: true,
    });
  } else {
    components.push({ key: 'profitability', label: 'Profitability Trend', score: null, tracked: false, note: 'Needs more revenue history.' });
  }

  const scored = components.filter((c) => c.tracked && c.score !== null);
  const overall = scored.length > 0
    ? clampScore(scored.reduce((sum, c) => sum + c.score, 0) / scored.length)
    : null;

  let status = null;
  if (overall !== null) {
    if (overall >= 80) status = { tone: 'excellent', label: 'Excellent', emoji: '🟢' };
    else if (overall >= 60) status = { tone: 'stable', label: 'Stable', emoji: '🟡' };
    else status = { tone: 'attention', label: 'Needs Attention', emoji: '🔴' };
  }

  return { overall, status, components, scoredCount: scored.length };
}

// Forecasting (always labeled)

/**
 * Tomorrow's revenue forecast: linear trend blended with the same-weekday
 * average. Returns null when there is not enough history to be responsible.
 */
export function forecastTomorrowRevenue(dailyData = {}, now = new Date()) {
  const entries = Object.entries(dailyData)
    .filter(([, d]) => Number(d.revenue || 0) > 0 || Number(d.orders || 0) > 0)
    .sort(([a], [b]) => a.localeCompare(b));

  if (entries.length < 5) return null;

  const revenues = entries.slice(-28).map(([, d]) => Number(d.revenue || 0));
  const n = revenues.length;
  let sumX = 0; let sumY = 0; let sumXY = 0; let sumXX = 0;
  revenues.forEach((y, x) => { sumX += x; sumY += y; sumXY += x * y; sumXX += x * x; });
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  const trendValue = Math.max(0, intercept + slope * n);

  const tomorrow = addDays(now, 1);
  const weekday = tomorrow.getDay();
  const sameWeekday = entries
    .filter(([key]) => parseDateKey(key).getDay() === weekday)
    .slice(-6)
    .map(([, d]) => Number(d.revenue || 0));

  const weekdayAvg = sameWeekday.length > 0 ? calculateMean(sameWeekday) : null;
  const value = weekdayAvg !== null ? trendValue * 0.45 + weekdayAvg * 0.55 : trendValue;

  const confidence = Math.min(90, 30 + entries.length * 2 + (sameWeekday.length >= 3 ? 10 : 0));

  return {
    isForecast: true,
    value,
    weekdayLabel: tomorrow.toLocaleDateString('en-US', { weekday: 'long' }),
    basis: `${entries.length} days of history${sameWeekday.length >= 3 ? `, ${sameWeekday.length} recent ${tomorrow.toLocaleDateString('en-US', { weekday: 'long' })}s` : ''}`,
    confidence,
  };
}

/**
 * Expected busy hours tomorrow from the trailing 14 days of hourly history.
 */
export function forecastBusyHours(hourlyData = {}, now = new Date()) {
  const keys = Object.keys(hourlyData).sort().slice(-14);
  if (keys.length < 3) return null;

  const { hours } = sumHourly(hourlyData, keys);
  const peak = derivePeakHours(hours);
  if (!peak) return null;

  return { isForecast: true, ...peak, basis: `${keys.length} recent days` };
}

/**
 * Likely stock shortages: current stock vs. average daily sales velocity.
 * Uses cumulative product analytics + day count as a conservative velocity.
 */
export function forecastStockShortages(inventory = {}, products = {}, dailyData = {}) {
  const dayCount = Math.max(1, Object.keys(dailyData).length);
  const velocityByName = new Map();
  for (const product of Object.values(products)) {
    const name = normalizeKey(product.name);
    if (!name) continue;
    velocityByName.set(name, Number(product.quantitySold || 0) / dayCount);
  }

  const risks = [];
  for (const item of Object.values(inventory)) {
    const stock = Number(item.stock ?? item.currentStock ?? 0);
    const velocity = velocityByName.get(normalizeKey(item.productName)) || 0;
    if (velocity <= 0) continue;
    const daysLeft = stock / velocity;
    if (daysLeft <= 3) {
      risks.push({
        label: item.productName,
        stock,
        unit: item.unit || 'units',
        daysLeft,
        window: daysLeft <= 1 ? 'within a day' : `~${Math.ceil(daysLeft)} days`,
      });
    }
  }

  risks.sort((a, b) => a.daysLeft - b.daysLeft);
  return risks.length > 0 ? { isForecast: true, risks: risks.slice(0, 6) } : null;
}

// Week aggregates for the presentation experience

export function getWeekComparison(analytics = {}, now = new Date()) {
  const weekly = analytics.weekly || {};
  const thisWeekKey = formatWeekKey(now);
  const lastWeekKey = formatWeekKey(addDays(now, -7));
  return {
    thisWeek: { key: thisWeekKey, ...(weekly[thisWeekKey] || { orders: 0, revenue: 0 }) },
    lastWeek: { key: lastWeekKey, ...(weekly[lastWeekKey] || { orders: 0, revenue: 0 }) },
  };
}

export function getDailySeries(dailyData = {}, endDate, days, field = 'revenue') {
  const series = [];
  const labels = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const key = formatDateKey(addDays(endDate, -i));
    series.push(Number(dailyData[key]?.[field] || 0));
    labels.push(parseDateKey(key).toLocaleDateString('en-US', { weekday: 'short' }));
  }
  return { series, labels };
}
