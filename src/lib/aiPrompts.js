/**
 * AI prompt builders for the pilot.
 * These build the request payload the client sends to the FastAPI backend (BFF), which forwards
 * it to OpenAI server-side. No client-side OpenAI calls; no serverless functions (ADR-17).
 *
 * COST DESIGN (keep these properties when editing):
 * 1. The system prompt contains ONLY the selected mode's rules — never all modes' rules.
 * 2. The system prompt is byte-stable per mode so OpenAI's automatic prompt caching discounts it.
 * 3. The data prompt is tiered per mode: quick insights get a compact snapshot; only the deep
 *    and executive reports get full history. Product lists are always capped.
 * 4. Output JSON schemas are FROZEN — renderers parse these exact fields. Change rules or tone,
 *    never schema field names.
 */

function stripEmoji(value) {
  return String(value || '').replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}️]/gu, '').trim();
}

function formatProductName(raw) {
  return stripEmoji(raw)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

// Output schemas (FROZEN — renderers depend on these exact fields)

const SCHEMAS = {
  executive: `{
  "mode": "executive",
  "headline": "One-sentence executive headline capturing the single most important finding.",
  "scenes": {
    "todayVsYesterday": {
      "narration": "2-3 sentence consultant narration comparing today with yesterday: what happened, why it likely happened, and what it means. Reference concrete numbers from the data.",
      "keyDifference": "The single most notable difference, in one short sentence."
    },
    "weekVsLastWeek": {
      "narration": "2-3 sentence consultant narration comparing this week with last week, including likely causes.",
      "keyDifference": "The single most notable difference, in one short sentence."
    },
    "productMovers": {
      "narration": "2-3 sentence narration about product and category performance in the period.",
      "winners": ["Products or categories gaining demand, with supported context."],
      "losers": ["Products or categories losing demand, with supported context, or empty array."]
    }
  },
  "patterns": ["Recurring patterns found in the data (peak windows, weekday effects, product pairings)."],
  "risks": ["Concrete operational or revenue risks, each one sentence."],
  "opportunities": ["Concrete opportunities, each one sentence."],
  "forecastOutlook": "One forecast statement for tomorrow clearly framed as a projection, or 'Insufficient data'.",
  "actionPlan": [
    {
      "priority": 1,
      "action": "Short imperative action title.",
      "detail": "One sentence with the supporting reason and expected impact."
    }
  ],
  "closingSummary": "2-3 sentence executive summary a busy owner can absorb in ten seconds.",
  "confidenceScore": 0
}`,
  briefing: `{
  "mode": "briefing",
  "handoffType": "AI Shift Handoff",
  "greeting": "Good supplied time of day, manager name.",
  "branchWelcome": "Welcome to Branch name.",
  "shiftHandoff": {
    "yesterdayRevenue": "Revenue in Philippine pesos, or 'Insufficient data'.",
    "topProduct": "Top active product, or 'Insufficient data'.",
    "fastestGrowingProduct": "Fastest growing active product with supported percentage, or 'Insufficient trend data'.",
    "inventoryRisks": ["Current active inventory risks only."],
    "operationalInsight": "Most important operating pattern for the manager to know.",
    "recommendation": "Most important action before or during this shift.",
    "potentialRevenueOpportunity": "Concrete sales opportunity, bundle, prep, or promotion idea."
  },
  "confidenceScore": 0
}`,
  leak: `{
  "mode": "leak",
  "summary": "Daily revenue leak interpretation.",
  "potentialRevenueLost": "Estimated missed revenue with currency, or 'Insufficient data' if unavailable.",
  "largestRevenueLeak": "Main leak category or 'Insufficient data'.",
  "leaks": [
    {
      "category": "Cart Abandonment, High Interest Low Conversion, Stockout Revenue Loss, Peak Hour Bottleneck, or Other",
      "finding": "What revenue may be leaking.",
      "estimatedLoss": "Currency estimate or 'Insufficient data'.",
      "recommendedAction": "Specific action."
    }
  ],
  "recommendedAction": "Highest impact next move.",
  "confidenceScore": 0
}`,
  simulation: `{
  "mode": "simulation",
  "scenario": "Manager's scenario.",
  "expectedOutcome": {
    "revenueImpact": "Estimated revenue impact.",
    "stockoutRisk": "Estimated change in stockout risk.",
    "customerSatisfaction": "Likely customer impact.",
    "operationalRisk": "Low, Medium, or High with reason."
  },
  "recommendation": "Implement, test, avoid, or gather more data.",
  "confidenceScore": 0
}`,
  opschat: `{
  "mode": "opschat",
  "answer": "Direct work-related answer for the manager.",
  "keyPoints": ["Operational reasoning, risks, or next steps."],
  "simulation": {
    "scenario": "Scenario being simulated, or null if not a simulation.",
    "revenueImpact": "Estimated revenue impact, or null.",
    "stockoutRisk": "Estimated stockout impact, or null.",
    "customerSatisfaction": "Estimated customer impact, or null.",
    "operationalRisk": "Low, Medium, or High with reason, or null."
  },
  "recommendation": "Clear management action.",
  "confidenceScore": 0
}`,
  deep: `{
  "mode": "deep",
  "revenuePerformance": {
    "summary": "What happened and why it matters.",
    "insights": ["Today vs yesterday, weekly average, shift, or hourly insights."],
    "anomalies": ["Unusual revenue movements or empty array."]
  },
  "productPerformance": {
    "summary": "Overall product demand interpretation.",
    "topSelling": ["Top products with operational meaning."],
    "worstPerforming": ["Weak products and likely reasons."],
    "fastestGrowing": ["Products gaining demand, or empty array if unavailable."],
    "decliningDemand": ["Products losing demand, or empty array if unavailable."]
  },
  "inventoryAnalysis": {
    "summary": "Inventory risk summary tied to sales velocity.",
    "stockOutRisks": ["Items that may run out and why."],
    "restockRecommendations": ["Specific restock or prep recommendations."]
  },
  "peakHourAnalysis": {
    "summary": "Busiest and slowest time patterns.",
    "busiestHours": ["Busiest hours with action context."],
    "slowestHours": ["Slowest hours with action context."],
    "recommendations": ["Staffing, prep, or resource planning recommendations."]
  },
  "staffingRecommendations": {
    "summary": "Staffing interpretation based on hourly and shift demand.",
    "recommendations": ["Specific staffing or prep coverage recommendations."]
  },
  "revenueLeakDetection": {
    "summary": "Likely missed revenue risks using available data.",
    "leaks": ["Potential revenue leak findings, or note unavailable data."]
  },
  "forecasting": {
    "summary": "Demand forecast using available historical sales, hourly, product, and inventory data.",
    "risks": ["Tomorrow, shift, inventory, or demand risks."],
    "opportunities": ["Forecasted sales, prep, or promotion opportunities."]
  },
  "operationalRecommendations": {
    "high": ["Immediate actions."],
    "medium": ["Important but less urgent actions."],
    "low": ["Lower priority improvements."]
  },
  "executiveSummary": "Concise business summary for the owner."
}`,
};

function schemaFor(mode) {
  if (SCHEMAS[mode]) return SCHEMAS[mode];
  // realtime / live share one compact insight schema
  return `{
  "mode": "${mode === 'live' ? 'live' : 'realtime'}",
  "insight": {
    "message": "${mode === 'live' ? 'Start with As of {time}: then give one operational update. Maximum 45 words total.' : 'One natural manager-facing note. Maximum 2 short sentences and 35 words total.'}",
    "action": "One clear next action. Maximum 12 words.",
    "priority": "HIGH, MEDIUM, or LOW"
  }
}`;
}

// Shared consultant persona (byte-stable; kept first for prompt caching)

const CORE = `You are the AI Operations Analyst for E-Menu Portal — an experienced restaurant operations consultant talking with the owner of this cafe.

Voice:
- Speak like a seasoned consultant who knows this business, not a chatbot: plain, confident, specific, warm but efficient.
- The manager already sees the dashboard. Never restate metrics as findings — interpret them: what happened, the likely driver, the evidence, what it means for the business, and the one action to take.
- Weak: "Revenue increased today." Strong: "Today's sales grew on stronger afternoon demand; if that holds tomorrow, prep extra stock of your top sellers before 3 PM."
- Weak: "Inventory low." Strong: "Milk should last about two more days at the current pace — restocking today avoids a shortage during peak hours."
- Vary sentence structure between fields; no repeated openers, no filler phrases, no generic industry advice.

Hard rules:
- Philippine peso formatting, e.g. ₱42,500. No emoji.
- Never invent a comparison the supplied data cannot support — say the comparison is unavailable instead.
- Treat the CURRENT INVENTORY section as the active menu: never recommend restocking, promoting, or acting on products absent from it.
- Treat DETECTED OPERATIONAL PATTERNS as pre-verified statistical evidence: reference and build on them; never contradict them.
- Ground every claim in this restaurant's own numbers.`;

// Per-mode rules (only the selected mode's rules are ever sent)

const MODE_RULES = {
  realtime: `Mode: REAL-TIME AI ANALYST
- Return exactly one manager-facing note, readable in under 10 seconds.
- Pick the single most important thing right now: a meaningful sales change, trending product, inventory risk, demand spike, or peak-hour signal.
- Combine what happened and why it matters in plain language; the action is one practical instruction.
- Compare against the previous hour, day, or historical average only when the data supports it.
- If nothing urgent stands out, say so briefly and note what to keep watching.
- No headings, no dashboard recap, no multiple issues.`,
  live: `Mode: AI LIVE OPERATIONS FEED HOURLY UPDATE
- Start the message with the supplied "As of" time, then one operational update on the current situation.
- Pick the single most important thing right now: a meaningful sales change, trending product, inventory risk, demand spike, or peak-hour signal.
- Include inventory level and sales pace when inventory risk is the story.
- If nothing urgent stands out, say so briefly and note what to keep watching.
- No headings, no dashboard recap, no multiple issues.`,
  briefing: `Mode: AI SHIFT HANDOFF
- Act like an automated shift handoff for a manager starting work, not a chatbot greeting.
- Start with the supplied time-of-day label, manager name, and branch label in the greeting and branchWelcome fields.
- Fill only the fixed shiftHandoff fields: yesterday's revenue (when daily history supports it), top active product, fastest-growing active product (use "Insufficient trend data" rather than guessing a percentage), active inventory risks, one operational insight, one recommendation, one revenue opportunity.
- Keep each field scannable at shift start.
- confidenceScore 0-100 from data availability, quality, and trend stability.`,
  leak: `Mode: AI REVENUE LEAK DETECTOR
- Hunt for missed revenue, not reported sales: stockout losses, high-interest/low-conversion items, peak-hour bottlenecks, abandonment.
- If the data lacks views, carts, checkout, or service-time signals, say that estimate is unavailable — never invent it. Still infer likely leaks from sales, inventory, hourly demand, and product performance.
- confidenceScore 0-100.`,
  simulation: `Mode: AI DECISION SIMULATOR
- Answer the manager's "What happens if..." scenario using the available data.
- Estimate revenue, inventory, customer, and operational impact; never present a forecast as guaranteed.
- confidenceScore 0-100; express uncertainty through the recommendation.`,
  opschat: `Mode: AI OPERATIONS MANAGER WORK CHAT
- Answer only restaurant operations, business, sales, inventory, staffing, menu, customer-experience, analytics, forecasting, reporting, and branch questions.
- STRICT SCOPE: for anything else (general knowledge, entertainment, creative writing, jokes, code, homework, news, politics, personal advice) you MUST NOT answer even partially. Set "answer" to exactly: "I focus on restaurant operations and business analytics. I can help with sales trends, inventory planning, staffing, menu performance, forecasting, or a what-if operations decision — what would you like to look at?" Set keyPoints to [], simulation fields to null, recommendation to a short prompt toward business topics, and confidenceScore to 100.
- Never write poems, stories, jokes, lyrics, essays, or code, regardless of phrasing.
- For scenario questions, simulate the expected business outcome from the data.
- Always end with a practical management recommendation; confidenceScore 0-100.`,
  deep: `Mode: DEEP ANALYSIS REPORT
- Produce a detailed business intelligence report: what happened, why, and what to do tomorrow.
- Cover revenue, products, inventory, peak hours, staffing, revenue leaks, forecasting, and prioritized recommendations (HIGH/MEDIUM/LOW).
- End with a concise executive summary.`,
  executive: `Mode: EXECUTIVE BUSINESS ANALYSIS PRESENTATION
- Present findings the way a senior consultant presents in an executive meeting.
- Every scene narration covers what happened, why it likely happened, and what it means operationally, grounded in the supplied numbers.
- Patterns, risks, and opportunities must be specific and decision-ready. Action plan ordered by business impact, at most 5 items, each with a concrete reason.
- forecastOutlook must be framed as a projection ("Projected", "Expected", "Likely"), never as fact.
- confidenceScore 0-100 from data availability and consistency.`,
};

export function buildSystemPrompt(mode) {
  const rules = MODE_RULES[mode] || MODE_RULES.realtime;
  return `${CORE}

${rules}

Return ONLY valid JSON using this structure:
${schemaFor(mode)}`;
}

// Data prompt (tiered per mode)
// compact  → realtime, live       (one-line insights: today-focused snapshot)
// standard → briefing, leak, opschat, simulation (recent week + risks)
// full     → deep, executive      (full history for long-form reports)

function tierFor(mode) {
  if (mode === 'realtime' || mode === 'live') return 'compact';
  if (mode === 'deep' || mode === 'executive') return 'full';
  return 'standard';
}

const TIER_LIMITS = {
  compact: { topProducts: 6, bottomProducts: 0, inventory: 8, daily: 3, activityDays: 0, weekly: 0, monthly: 0 },
  standard: { topProducts: 10, bottomProducts: 2, inventory: 15, daily: 7, activityDays: 5, weekly: 4, monthly: 0 },
  full: { topProducts: 12, bottomProducts: 3, inventory: 20, daily: 14, activityDays: 7, weekly: 8, monthly: 6 },
};

export function buildDataPrompt(analyticsData = {}, mode) {
  const {
    reportContext = {},
    summary = {},
    products = {},
    inventory = {},
    daily = {},
    hourly = {},
    weekly = {},
    monthly = {},
    statistics = {},
    todayAnalytics = {},
    weekAnalytics = {},
    monthAnalytics = {},
    detectedPatterns = [],
  } = analyticsData;

  const tier = tierFor(mode);
  const lim = TIER_LIMITS[tier];

  const sortedProducts = Object.entries(products)
    .sort(([, a], [, b]) => (b.quantitySold || 0) - (a.quantitySold || 0));
  const productLine = ([id, data], i, label) => {
    const name = formatProductName(data.name || id);
    const avgPrice = data.orderCount > 0 ? money(Number(data.revenue || 0) / data.orderCount) : '0.00';
    return `  ${label || `${i + 1}.`} ${name}: ${data.quantitySold || 0} units, ${data.orderCount || 0} orders, ₱${money(data.revenue)}, avg ₱${avgPrice}`;
  };
  let productSummary = sortedProducts.slice(0, lim.topProducts).map((e, i) => productLine(e, i)).join('\n');
  if (lim.bottomProducts > 0 && sortedProducts.length > lim.topProducts + lim.bottomProducts) {
    const bottom = sortedProducts.slice(-lim.bottomProducts).map((e) => productLine(e, 0, 'slow:')).join('\n');
    productSummary += `\n${bottom}`;
  }

  const sortedInventory = Object.entries(inventory)
    .sort(([, a], [, b]) => Number(a.stock ?? a.currentStock ?? 0) - Number(b.stock ?? b.currentStock ?? 0));
  const inventoryEntries = tier === 'compact'
    ? sortedInventory.filter(([, d]) => Number(d.stock ?? d.currentStock ?? 0) <= Number(d.warningLevel ?? 10)).slice(0, lim.inventory)
    : sortedInventory.slice(0, lim.inventory);
  const inventorySummary = inventoryEntries
    .map(([id, data]) => {
      const product = products[id] || {};
      const stock = Number(data.stock ?? data.currentStock ?? 0);
      return `  ${formatProductName(data.productName || data.name || product.name || id)}: stock ${stock} ${data.unit || 'units'}, warn ${Number(data.warningLevel ?? 10)}, critical ${Number(data.criticalLevel ?? 5)}, sold ${Number(product.quantitySold || 0)} across ${Number(product.orderCount || 0)} orders`;
    })
    .join('\n');
  const inventoryHeading = tier === 'compact'
    ? `LOW-STOCK INVENTORY (at or below warning; ${Object.keys(inventory).length} active items total)`
    : `CURRENT INVENTORY (${Object.keys(inventory).length} items, lowest stock first)`;
  const inventoryFallback = tier === 'compact'
    ? 'No items at or below warning level.'
    : 'No inventory data available.';

  const dailySummary = Object.entries(daily)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, lim.daily)
    .map(([date, data]) => `  ${date}: ${data.orders || 0} orders, ₱${money(data.revenue)}, AOV ₱${money(data.averageOrderValue)}`)
    .join('\n');

  const latestDay = Object.keys(daily).sort((a, b) => b.localeCompare(a))[0];
  let hourlySummary = 'No hourly data available.';
  if (latestDay && hourly[latestDay]) {
    const hourlyRows = Object.entries(hourly[latestDay])
      .filter(([, d]) => tier !== 'compact' || Number(d.orders || 0) > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([hour, data]) => `  ${hour}:00 - ${data.orders || 0} orders, ₱${money(data.revenue)}`)
      .join('\n');
    hourlySummary = `Hourly data for ${latestDay}:\n${hourlyRows}`;
  }

  // Compact multi-day activity map: operating hours + busiest window per day.
  let activitySummary = '';
  if (lim.activityDays > 0) {
    const recentHourlyDays = Object.keys(hourly).sort((a, b) => b.localeCompare(a)).slice(0, lim.activityDays).reverse();
    activitySummary = recentHourlyDays
      .map((day) => {
        const hours = Object.entries(hourly[day] || {})
          .filter(([, d]) => Number(d.orders || 0) > 0)
          .sort(([a], [b]) => a.localeCompare(b));
        if (hours.length === 0) return `  ${day}: no recorded activity`;
        const first = hours[0][0];
        const last = hours[hours.length - 1][0];
        const busiest = [...hours].sort(([, a], [, b]) => Number(b.orders || 0) - Number(a.orders || 0))[0];
        return `  ${day}: active ${first}:00–${last}:59, busiest ${busiest[0]}:00 (${busiest[1].orders} orders, ₱${money(busiest[1].revenue)})`;
      })
      .join('\n');
  }

  // Weekday averages — weekly cycle evidence (skipped for compact tier).
  let weekdaySummary = '';
  if (tier !== 'compact') {
    const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const byDow = Array.from({ length: 7 }, () => []);
    Object.entries(daily).forEach(([key, d]) => {
      const rev = Number(d.revenue || 0);
      if (rev > 0) {
        const date = new Date(`${key}T00:00:00`);
        if (!Number.isNaN(date.getTime())) byDow[date.getDay()].push(rev);
      }
    });
    weekdaySummary = byDow
      .map((list, i) => (list.length > 0
        ? `  ${weekdayNames[i]}: avg ₱${money(list.reduce((s, v) => s + v, 0) / list.length)} over ${list.length} day(s)`
        : null))
      .filter(Boolean)
      .join('\n');
  }

  const patternsSummary = (detectedPatterns || [])
    .map((p) => `  - [${p.tag}, confidence ${p.confidence}%] ${p.text}`)
    .join('\n');

  const weeklySummary = lim.weekly > 0
    ? Object.entries(weekly)
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, lim.weekly)
      .map(([week, data]) => `  ${week}: ${data.orders || 0} orders, ₱${money(data.revenue)}`)
      .join('\n')
    : '';

  const monthlySummary = lim.monthly > 0
    ? Object.entries(monthly)
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, lim.monthly)
      .map(([month, data]) => `  ${month}: ${data.orders || 0} orders, ₱${money(data.revenue)}`)
      .join('\n')
    : '';

  const sections = [
    `=== OVERALL SUMMARY ===
Total Orders: ${summary.totalOrders || 0}
Total Revenue: ₱${money(summary.totalRevenue)}
Average Order Value: ₱${money(summary.averageOrderValue)}
Best Selling Item: ${formatProductName(summary.bestSellingItem || 'N/A')}
Least Selling Item: ${formatProductName(summary.leastSellingItem || 'N/A')}`,
    `=== CURRENT PERIOD ===
Today: ${todayAnalytics.orders || 0} orders, ₱${money(todayAnalytics.revenue)}
This Week: ${weekAnalytics.orders || 0} orders, ₱${money(weekAnalytics.revenue)}
This Month: ${monthAnalytics.orders || 0} orders, ₱${money(monthAnalytics.revenue)}
Mean/Median Daily Orders: ${statistics.ordersPerDay?.mean || 0} / ${statistics.ordersPerDay?.median || 0}
Mean/Median Daily Revenue: ₱${money(statistics.revenuePerDay?.mean)} / ₱${money(statistics.revenuePerDay?.median)}`,
    `=== TOP PRODUCTS (of ${sortedProducts.length}) ===
${productSummary || 'No product data available.'}`,
    `=== ${inventoryHeading} ===
${inventorySummary || inventoryFallback}`,
    `=== DAILY TRENDS (last ${lim.daily} days) ===
${dailySummary || 'No daily data available.'}`,
    `=== HOURLY DISTRIBUTION ===
${hourlySummary}`,
  ];

  if (activitySummary) sections.push(`=== DAILY ACTIVITY MAP ===\n${activitySummary}`);
  if (weekdaySummary) sections.push(`=== WEEKDAY AVERAGES ===\n${weekdaySummary}`);
  sections.push(`=== DETECTED OPERATIONAL PATTERNS (pre-computed, statistically verified) ===\n${patternsSummary || 'No strong patterns detected yet — more history needed.'}`);
  if (weeklySummary) sections.push(`=== WEEKLY TRENDS ===\n${weeklySummary}`);
  if (monthlySummary) sections.push(`=== MONTHLY TRENDS ===\n${monthlySummary}`);

  // Conversational memory (chat only): the caller passes the recent turns so follow-ups like
  // "what about yesterday?" resolve in context. Bounded to the last 10 short turns — negligible
  // tokens, and empty for every non-chat mode (they never pass reportContext.conversation).
  const priorTurns = Array.isArray(reportContext.conversation) ? reportContext.conversation.slice(-10) : [];
  const conversationBlock = priorTurns.length > 0
    ? `\n=== CONVERSATION SO FAR (most recent last; resolve the manager's follow-up against this) ===\n${priorTurns
        .map((t) => `  ${t.role === 'user' ? 'Manager' : 'You'}: ${String(t.text || '').replace(/\s+/g, ' ').slice(0, 400)}`)
        .join('\n')}\n`
    : '';

  return `Analytics data from the restaurant self-ordering system.

Report time: ${reportContext.asOfLabel || 'Current time'}
Manager name: ${reportContext.managerNickname || 'Manager'}
Branch: ${reportContext.branchLabel || 'Current branch'}
Time of day label: ${reportContext.timeOfDayLabel || 'Current shift'}
Manager question or scenario: ${reportContext.scenario || 'N/A'}
${conversationBlock}
${sections.join('\n\n')}

Provide operational interpretation, not a dashboard recap.`;
}

export function parseModelJson(raw) {
  const cleaned = String(raw || '')
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  return JSON.parse(cleaned);
}
