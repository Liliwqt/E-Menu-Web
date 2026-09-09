/**
 * Deterministic smart-recommendation engine (V2).
 *
 * Generates executive recommendations ranked by business impact from data
 * that already exists client-side — no AI cost, no new database reads.
 * Every recommendation carries: problem, evidence, expected impact, confidence.
 */

import { formatCurrency } from './statisticsUtils';
import { formatHourLabel } from './executiveMetrics';

export function buildRecommendations({ inventoryHealth, shortageForecast, periodMetrics, productStats, forecast }) {
  const recs = [];

  // 1. Critical stock — highest impact: lost sales are immediate.
  if (inventoryHealth?.tracked && inventoryHealth.critical.length > 0) {
    const names = inventoryHealth.critical.slice(0, 3).map((i) => i.label).join(', ');
    recs.push({
      priority: 'high',
      title: `Restock ${inventoryHealth.critical.length === 1 ? inventoryHealth.critical[0].label : `${inventoryHealth.critical.length} critical items`}`,
      problem: 'Items at or below critical stock level can sell out mid-service.',
      evidence: `${names} ${inventoryHealth.critical.length === 1 ? 'is' : 'are'} at critical level right now.`,
      impact: 'Prevents direct lost sales and menu items auto-disabling.',
      confidence: 95,
    });
  }

  // 2. Predicted shortages within ~3 days.
  if (shortageForecast?.risks?.length > 0) {
    const first = shortageForecast.risks[0];
    recs.push({
      priority: shortageForecast.risks.some((r) => r.daysLeft <= 1) ? 'high' : 'medium',
      title: `Order ahead: ${first.label}${shortageForecast.risks.length > 1 ? ` +${shortageForecast.risks.length - 1} more` : ''}`,
      problem: 'Current sales velocity will exhaust stock soon.',
      evidence: `${first.label} has ${first.stock} ${first.unit} left — projected to run out ${first.window}.`,
      impact: 'Keeps best-selling items available through the forecast window.',
      confidence: 70,
      isForecast: true,
    });
  }

  // 3. Staffing around the peak window.
  if (periodMetrics?.peak && periodMetrics.peak.peakOrders >= 3) {
    const { peak } = periodMetrics;
    recs.push({
      priority: 'medium',
      title: `Staff up before ${formatHourLabel(peak.windowStart)}`,
      problem: 'Order volume concentrates in a narrow window.',
      evidence: `Peak of ${peak.peakOrders} orders at ${formatHourLabel(peak.peakHour)}; busy window ${peak.label}.`,
      impact: 'Shorter queues and faster service through the rush.',
      confidence: 80,
    });
  }

  // 4. Promote the slowest mover.
  const slow = productStats?.topProducts?.length >= 3
    ? [...productStats.topProducts].sort((a, b) => a.quantity - b.quantity)[0]
    : null;
  if (slow && slow.quantity > 0) {
    recs.push({
      priority: 'low',
      title: `Promote ${slow.name}`,
      problem: 'Demand is lagging behind the rest of the menu.',
      evidence: `Only ${slow.quantity} sold in the selected period (${formatCurrency(slow.revenue)} revenue).`,
      impact: 'A feature or bundle can lift attachment without new inventory.',
      confidence: 55,
    });
  }

  // 5. Prep for the forecast day.
  if (forecast?.value > 0) {
    recs.push({
      priority: 'low',
      title: `Prep for ${forecast.weekdayLabel}`,
      problem: 'Tomorrow’s demand should be planned tonight.',
      evidence: `Projected ${formatCurrency(forecast.value)} revenue (${forecast.confidence}% confidence, ${forecast.basis}).`,
      impact: 'Right-sized prep reduces waste and stockouts.',
      confidence: forecast.confidence,
      isForecast: true,
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  return recs.sort((a, b) => order[a.priority] - order[b.priority]);
}
