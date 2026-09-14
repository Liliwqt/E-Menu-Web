import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Banknote, ReceiptText, Gauge, Clock3, Presentation, Sparkles,
  AlertTriangle, PackageOpen, TrendingUp, TrendingDown, CalendarClock, RefreshCw,
  Radio, Sunrise, PieChart, ScanSearch,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useBranchData } from '../context/BranchDataContext';
import AppShell from '../components/layout/AppShell';
import AnimatedNumber from '../components/ui/AnimatedNumber';
import Sparkline from '../components/ui/Sparkline';
import StatDelta from '../components/ui/StatDelta';
import ScoreRing from '../components/ui/ScoreRing';
import { AreaChart, DonutChart, HourHeatStrip, RankedBars } from '../components/ui/charts';
import { formatCurrency } from '../lib/statisticsUtils';
import { formatDateKey } from '../lib/analyticsApi';
import {
  resolvePeriod, getPeriodMetrics, getDelta, getSparkline, buildCategoryIndex,
  getPeriodProductStats, getInventoryHealth, getBusinessHealthScore,
  forecastTomorrowRevenue, forecastBusyHours, forecastStockShortages, formatHourLabel, getDailySeries,
} from '../lib/executiveMetrics';
import { buildRecommendations } from '../lib/recommendations';
import { generateAIAnalysis } from '../lib/aiAnalystService';
import { useAiAccess } from '../hooks/useAiAccess';
import UpgradePrompt from '../components/ui/UpgradePrompt';
import '../styles/dashboard.css';

const ExecutivePresentation = lazy(() => import('../components/ai/ExecutivePresentation'));

const peso = (v) => formatCurrency(v);

/**
 * SLA-style KPI card: value → color-coded trend arrow + % → comparison
 * caption, with the sparkline in normal flow (never overlapping content).
 */
function KpiCard({ icon: Icon, label, value, format, primaryDelta, primaryLabel, secondaryDeltas, spark, sparkColor, note, rise }) {
  const dir = primaryDelta?.direction;
  const trendClass = !primaryDelta?.available || dir === 'flat' ? 'trend-flat' : dir === 'up' ? 'trend-up' : 'trend-down';
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '—';
  const pct = primaryDelta?.pct === null || primaryDelta?.pct === undefined
    ? null
    : `${primaryDelta.pct > 0 ? '+' : ''}${primaryDelta.pct.toFixed(1)}%`;

  return (
    <div className={`card kpi rise ${rise}`}>
      <div className="kpi__top">
        <span className="kpi__label">{label}</span>
        <span className="kpi__icon"><Icon size={17} /></span>
      </div>
      <div className="kpi__value"><AnimatedNumber value={value} format={format} /></div>

      {primaryDelta !== undefined && (
        <div>
          <div className={`kpi__delta ${trendClass}`}>
            {primaryDelta?.available && pct ? (
              <><span aria-hidden="true">{arrow}</span> <span className="num">{pct}</span></>
            ) : (
              <span className="muted" style={{ fontWeight: 550 }}>No comparison data yet</span>
            )}
          </div>
          {primaryDelta?.available && pct && (
            <div className="kpi__deltaCaption">Compared to {primaryLabel || 'yesterday'}</div>
          )}
        </div>
      )}

      {secondaryDeltas?.length > 0 && (
        <div className="kpi__meta">
          {secondaryDeltas.map((d, i) => <StatDelta key={i} delta={d.delta} label={d.label} />)}
        </div>
      )}

      {spark && spark.length > 1 && (
        <div className="kpi__spark">
          <Sparkline fluid data={spark} width={220} height={30} color={sparkColor || 'var(--chart-1)'} />
        </div>
      )}
      {note && (
        <div className="kpi__note">
          <Sparkles size={12} style={{ marginTop: 2, flexShrink: 0, color: 'var(--primary)' }} />
          <span>{note}</span>
        </div>
      )}
    </div>
  );
}

function SectionCard({ title, sub, icon: Icon, children, className = '', action }) {
  return (
    <section className={`card card--pad ${className}`}>
      <div className="flex-between" style={{ marginBottom: 'var(--sp-4)' }}>
        <div>
          <h2 className="card-title">
            {Icon && <Icon size={17} style={{ color: 'var(--primary)' }} />}
            {title}
          </h2>
          {sub && <p className="card-sub">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user, nickname, workspace } = useAuth();
  const {
    branchId, analytics, analyticsLoaded, inventory, logs, aiAnalyticsData, hasOrders,
  } = useBranchData();

  const [insight, setInsight] = useState(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [presentationOpen, setPresentationOpen] = useState(false);
  const aiEnabled = useAiAccess();

  const period = useMemo(() => resolvePeriod({ type: 'today' }), []);

  const view = useMemo(() => {
    if (!analytics) return null;
    const periodMetrics = { ...getPeriodMetrics(analytics, period.dateKeys), dayCount: 1 };
    const compareMetrics = getPeriodMetrics(analytics, period.compareKeys);
    const lastWeekMetrics = getPeriodMetrics(analytics, period.lastWeekKeys);

    const categoryIndex = buildCategoryIndex(inventory);
    const productStats = getPeriodProductStats(logs, period.dateKeys, categoryIndex);
    const last7Keys = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return formatDateKey(d);
    });
    const weekStats = getPeriodProductStats(logs, last7Keys, categoryIndex);
    const inventoryHealth = getInventoryHealth(inventory);
    const health = getBusinessHealthScore({ analytics, periodMetrics, compareMetrics, inventoryHealth });
    const forecast = forecastTomorrowRevenue(analytics.daily);
    const busyForecast = forecastBusyHours(analytics.hourly);
    const shortageForecast = forecastStockShortages(inventory, analytics.products, analytics.daily);

    const revenueSpark = getSparkline(analytics.daily, period.dateKeys[0], 7, 'revenue');
    const ordersSpark = getSparkline(analytics.daily, period.dateKeys[0], 7, 'orders');
    const trend = getDailySeries(analytics.daily, new Date(), 7, 'revenue');

    let revenueNote = '';
    if (periodMetrics.peak && periodMetrics.revenue > 0) {
      const windowRevenue = periodMetrics.hourlyRevenue
        .slice(periodMetrics.peak.windowStart, periodMetrics.peak.windowEnd + 1)
        .reduce((s, v) => s + v, 0);
      const share = Math.round((windowRevenue / periodMetrics.revenue) * 100);
      if (share > 0) revenueNote = `${share}% of today's revenue came from the ${periodMetrics.peak.label} window.`;
    } else {
      revenueNote = 'Revenue updates in real time as orders complete.';
    }

    const recommendations = buildRecommendations({ inventoryHealth, shortageForecast, periodMetrics, productStats: weekStats, forecast });

    // Slow movers this week (needs at least a few products to be meaningful)
    const slowProducts = weekStats.topProducts.length >= 3
      ? [...weekStats.topProducts].sort((a, b) => a.quantity - b.quantity).slice(0, 5)
      : [];

    return {
      periodMetrics,
      compareMetrics,
      revenueDelta: getDelta(periodMetrics.revenue, compareMetrics.revenue),
      revenueWeekDelta: getDelta(periodMetrics.revenue, lastWeekMetrics.revenue),
      ordersDelta: getDelta(periodMetrics.orders, compareMetrics.orders),
      ordersWeekDelta: getDelta(periodMetrics.orders, lastWeekMetrics.orders),
      aovDelta: getDelta(periodMetrics.averageOrderValue, compareMetrics.averageOrderValue),
      productStats,
      weekStats,
      slowProducts,
      inventoryHealth,
      health,
      forecast,
      busyForecast,
      shortageForecast,
      revenueSpark,
      ordersSpark,
      trend,
      revenueNote,
      recommendations,
    };
  }, [analytics, inventory, logs, period]);

  // AI Insight of the Day — served from the 30-minute cache when available.
  useEffect(() => {
    if (!aiEnabled || !hasOrders || !branchId || !analyticsLoaded) return;
    let cancelled = false;
    setInsightLoading(true);
    generateAIAnalysis(aiAnalyticsData, branchId, false, 'realtime')
      .then((result) => { if (!cancelled) setInsight(result); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setInsightLoading(false); });
    return () => { cancelled = true; };
    // Intentionally keyed on branch only: the cache layer handles freshness.
  }, [aiEnabled, branchId, hasOrders, analyticsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshInsight() {
    if (!aiEnabled || insightLoading) return;
    setInsightLoading(true);
    try {
      const result = await generateAIAnalysis(aiAnalyticsData, branchId, true, 'realtime');
      setInsight(result);
    } catch { /* surfaced via stale card */ } finally {
      setInsightLoading(false);
    }
  }

  const displayName = nickname || user?.email?.split('@')[0] || 'Manager';
  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  if (!analyticsLoaded) {
    return (
      <AppShell title="Dashboard">
        <div className="dash__kpis">
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 148, borderRadius: 'var(--r-lg)' }} />)}
        </div>
        <div className="dash__grid2">
          <div className="skeleton" style={{ height: 280, borderRadius: 'var(--r-lg)' }} />
          <div className="skeleton" style={{ height: 280, borderRadius: 'var(--r-lg)' }} />
        </div>
      </AppShell>
    );
  }

  const m = view?.periodMetrics;
  const insightMessage = insight?.insight?.message;
  const insightAction = insight?.insight?.action;
  const insightPriority = insight?.insight?.priority;

  return (
    <AppShell title="Dashboard">
      {/* ── Hero ── */}
      <div className="dash__hero rise">
        <div>
          <h1 className="dash__greeting">{timeGreeting}, {displayName}</h1>
          <p className="dash__date">{dateLabel} · How is the business performing today?</p>
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          {view?.health?.status && (
            <span className={`pill ${view.health.status.tone === 'excellent' ? 'pill--success' : view.health.status.tone === 'stable' ? 'pill--warning' : 'pill--danger'}`} style={{ alignSelf: 'center' }}>
              <span className="pill-dot" />
              Business {view.health.status.label}
            </span>
          )}
          {aiEnabled && (
            <button className="btn btn--primary" onClick={() => setPresentationOpen(true)} disabled={!hasOrders}>
              <Presentation size={16} />
              Executive Presentation
            </button>
          )}
        </div>
      </div>

      {!hasOrders ? (
        <div className="empty rise-2">
          <span className="empty__icon"><ReceiptText size={24} /></span>
          <div className="empty__title">No orders recorded yet</div>
          <p style={{ maxWidth: 380 }}>
            Once the ordering tablet sends its first completed order, your executive
            dashboard, analytics and AI insights will populate automatically.
          </p>
        </div>
      ) : (
        <>
          {/* ── KPI grid ── */}
          <div className="dash__kpis">
            <KpiCard
              rise="rise-1"
              icon={Banknote}
              label="Today's Revenue"
              value={m.revenue}
              format={(v) => peso(v)}
              primaryDelta={view.revenueDelta}
              primaryLabel="yesterday"
              secondaryDeltas={[{ delta: view.revenueWeekDelta, label: 'vs last week' }]}
              spark={view.revenueSpark}
              note={view.revenueNote}
            />
            <KpiCard
              rise="rise-2"
              icon={ReceiptText}
              label="Today's Orders"
              value={m.orders}
              format={(v) => Math.round(v).toLocaleString()}
              primaryDelta={view.ordersDelta}
              primaryLabel="yesterday"
              secondaryDeltas={[{ delta: view.ordersWeekDelta, label: 'vs last week' }]}
              spark={view.ordersSpark}
              sparkColor="var(--chart-2)"
              note={m.peak ? `Busiest at ${formatHourLabel(m.peak.peakHour)} with ${m.peak.peakOrders} orders.` : 'Order flow appears here as the day builds.'}
            />
            <KpiCard
              rise="rise-3"
              icon={Gauge}
              label="Average Order Value"
              value={m.averageOrderValue}
              format={(v) => peso(v)}
              primaryDelta={view.aovDelta}
              primaryLabel="yesterday"
              note={view.productStats.bestCategory ? `${view.productStats.bestCategory.name} is today's top-earning category.` : 'AOV compares your ticket size day over day.'}
            />
            <KpiCard
              rise="rise-4"
              icon={Clock3}
              label="Peak Service Hour"
              value={m.peak ? m.peak.peakHour : 0}
              format={() => (m.peak ? formatHourLabel(m.peak.peakHour) : '—')}
              note={
                m.peak
                  ? `Busy window ${m.peak.label}. Estimated profit today: ${peso(m.revenue * 0.65)} (assumes 65% gross margin).`
                  : `Estimated profit today: ${peso(m.revenue * 0.65)} (assumes 65% gross margin).`
              }
            />
          </div>

          {/* ── AI operations suite ── */}
          {aiEnabled ? (
            <div className="suite rise-2">
              {[
                {
                  icon: Radio,
                  name: 'AI Live Operations Analyst',
                  desc: 'A pulse on service as it happens.',
                  onClick: () => window.dispatchEvent(new CustomEvent('emp:open-ai', { detail: { mode: 'live', userText: 'Give me a live operations update.' } })),
                },
                {
                  icon: Sunrise,
                  name: 'AI Shift Handoff',
                  desc: 'Start the shift fully briefed.',
                  onClick: () => window.dispatchEvent(new CustomEvent('emp:open-ai', { detail: { mode: 'briefing', userText: 'Give me my shift briefing.' } })),
                },
                {
                  icon: PackageOpen,
                  name: 'AI Inventory Intelligence',
                  desc: 'Stock levels, usage and restock radar.',
                  onClick: () => navigate(`/inventory/${branchId}`),
                },
                {
                  icon: TrendingUp,
                  name: 'AI Sales Insights',
                  desc: 'What sold, when, and why.',
                  onClick: () => navigate(`/analytics/${branchId}`),
                },
                {
                  icon: Sparkles,
                  name: 'AI Recommendations',
                  desc: 'Next actions ranked by impact.',
                  onClick: () => window.dispatchEvent(new CustomEvent('emp:open-ai', { detail: { mode: 'opschat', userText: 'What are your top recommended actions right now, ranked by business impact?' } })),
                },
              ].map((mod) => (
                <button key={mod.name} className="suite__card" onClick={mod.onClick}>
                  <span className="suite__icon"><mod.icon size={16} /></span>
                  <span className="suite__name">{mod.name}</span>
                  <span className="suite__desc">{mod.desc}</span>
                </button>
              ))}
            </div>
          ) : (
            <UpgradePrompt
              feature="AI Operations suite"
              description="Unlock the AI Live Analyst, Shift Handoff, Revenue Leak Detection, AI Chat and Smart Recommendations with a 14-day trial of the Subscription plan."
              branchId={branchId}
            />
          )}

          {/* ── Health + trend ── */}
          <div className="dash__grid2">
            <SectionCard title="Business Health" sub="Composite score across five tracked dimensions" icon={Gauge} className="rise-3">
              <div className="health">
                <div className="health__top">
                  <ScoreRing score={view.health.overall} label={view.health.status?.label || 'No data'} />
                  <div className="health__components">
                    {view.health.components.map((c) => (
                      <div className="health__row" key={c.key} title={c.note}>
                        <div className="health__rowHead">
                          <span style={{ color: 'var(--text-2)', fontWeight: 550 }}>{c.label}</span>
                          <span className="num" style={{ color: c.tracked ? 'var(--text-1)' : 'var(--text-3)', fontWeight: 650 }}>
                            {c.tracked ? Math.round(c.score) : '—'}
                          </span>
                        </div>
                        <div className="health__bar">
                          <div
                            className="health__fill"
                            style={{
                              width: c.tracked ? `${c.score}%` : '0%',
                              background: !c.tracked ? 'transparent' : c.score >= 80 ? 'var(--success)' : c.score >= 60 ? 'var(--warning)' : 'var(--danger)',
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="card-sub" style={{ borderTop: '1px dashed var(--border)', paddingTop: 'var(--sp-3)' }}>
                  {view.health.components.filter((c) => c.tracked).map((c) => c.note).join(' ')}
                </p>
              </div>
            </SectionCard>

            <SectionCard
              title="Revenue Trend"
              sub="Last 7 days"
              icon={TrendingUp}
              className="rise-4"
              action={
                <button className="btn btn--ghost btn--sm" onClick={() => navigate(`/analytics/${branchId}`)}>
                  Full analytics
                </button>
              }
            >
              <AreaChart
                height={230}
                data={view.trend.series.map((v, i) => ({ label: view.trend.labels[i], value: v }))}
                formatValue={(v) => peso(v)}
              />
            </SectionCard>
          </div>

          {/* ── AI insight + activity + alerts ── */}
          <div className="dash__grid2--reverse">
            <SectionCard title="Today's Service Rhythm" sub="Orders by hour — the rush window is highlighted" icon={Clock3} className="rise-4">
              <HourHeatStrip
                values={m.hourlyOrders}
                peakStart={m.peak?.windowStart ?? null}
                peakEnd={m.peak?.windowEnd ?? null}
                formatValue={(v) => `${v} orders`}
              />
              {view.busyForecast && (
                <p className="card-sub" style={{ marginTop: 'var(--sp-4)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CalendarClock size={14} style={{ color: 'var(--accent)' }} />
                  AI forecast: expect the rush around {view.busyForecast.label} tomorrow (based on {view.busyForecast.basis}).
                </p>
              )}
            </SectionCard>

            {aiEnabled && <section className="card card--pad insight rise-5">

              <div className="flex-between" style={{ marginBottom: 'var(--sp-3)' }}>
                <h2 className="card-title"><Sparkles size={17} style={{ color: 'var(--primary)' }} /> AI Insight of the Day</h2>
                <div className="flex gap-2">
                  {insightPriority && (
                    <span className={`pill ${insightPriority === 'HIGH' ? 'pill--danger' : insightPriority === 'MEDIUM' ? 'pill--warning' : 'pill--success'}`}>
                      {insightPriority}
                    </span>
                  )}
                  <button className="btn btn--ghost btn--icon btn--sm" onClick={refreshInsight} disabled={insightLoading} aria-label="Refresh insight">
                    <RefreshCw size={15} className={insightLoading ? 'spin' : ''} style={insightLoading ? { animation: 'spin 1s linear infinite' } : undefined} />
                  </button>
                </div>
              </div>
              {insightLoading && !insightMessage ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  <div className="skeleton" style={{ height: 14, width: '92%' }} />
                  <div className="skeleton" style={{ height: 14, width: '78%' }} />
                  <div className="skeleton" style={{ height: 14, width: '55%' }} />
                </div>
              ) : insightMessage ? (
                <>
                  <p style={{ color: 'var(--text-2)', lineHeight: 1.65 }}>{insightMessage}</p>
                  {insightAction && (
                    <p style={{ marginTop: 'var(--sp-3)', fontWeight: 650, color: 'var(--text-1)', fontSize: 'var(--text-sm)', display: 'flex', gap: 8 }}>
                      <span className="pill pill--brand">Next action</span> {insightAction}
                    </p>
                  )}
                </>
              ) : (
                <p className="card-sub">The AI analyst will drop today's most important observation here.</p>
              )}

              {/* Alerts */}
              <div style={{ display: 'grid', gap: 8, marginTop: 'var(--sp-4)' }}>
                {view.inventoryHealth.critical.slice(0, 3).map((item) => (
                  <div className="alert-row" key={item.label}>
                    <AlertTriangle size={15} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                    <span style={{ flex: 1, color: 'var(--text-2)' }}>{item.label}</span>
                    <span className="pill pill--danger num">{item.stock} {item.unit}</span>
                  </div>
                ))}
                {view.inventoryHealth.warning.slice(0, 2).map((item) => (
                  <div className="alert-row" key={item.label}>
                    <PackageOpen size={15} style={{ color: 'var(--warning)', flexShrink: 0 }} />
                    <span style={{ flex: 1, color: 'var(--text-2)' }}>{item.label}</span>
                    <span className="pill pill--warning num">{item.stock} {item.unit}</span>
                  </div>
                ))}
                {view.inventoryHealth.tracked && view.inventoryHealth.critical.length === 0 && view.inventoryHealth.warning.length === 0 && (
                  <div className="alert-row">
                    <PackageOpen size={15} style={{ color: 'var(--success)', flexShrink: 0 }} />
                    <span style={{ flex: 1, color: 'var(--text-2)' }}>Inventory healthy — no low-stock alerts.</span>
                    <span className="pill pill--success num">{view.inventoryHealth.score}%</span>
                  </div>
                )}
              </div>
            </section>}
          </div>

          {/* ── Products + forecast ── */}
          <div className="dash__grid3">
            <SectionCard title="Today's Best Sellers" sub={view.productStats.matchedOrders > 0 ? `${view.productStats.matchedOrders} orders analyzed` : 'Waiting for today’s orders'} icon={TrendingUp} className="rise-5">
              {view.productStats.topProducts.length > 0 ? (
                <RankedBars
                  data={view.productStats.topProducts.map((p) => ({ label: p.name, value: p.quantity, secondary: peso(p.revenue) }))}
                  formatValue={(v) => `${v} sold`}
                />
              ) : (
                <p className="card-sub">Product ranking appears after the first order today.</p>
              )}
            </SectionCard>

            <SectionCard title="Slow Movers (7 days)" sub="Lowest demand this week" icon={TrendingDown} className="rise-5">
              {view.slowProducts.length > 0 ? (
                <RankedBars
                  color="var(--chart-4)"
                  data={view.slowProducts.map((p) => ({ label: p.name, value: p.quantity, secondary: peso(p.revenue) }))}
                  formatValue={(v) => `${v} sold`}
                />
              ) : (
                <p className="card-sub">Needs at least 3 products with sales this week.</p>
              )}
            </SectionCard>

            <SectionCard title="Sales by Category (7 days)" sub="Where this week's revenue comes from" icon={PieChart} className="rise-5">
              {view.weekStats.categories?.length > 0 ? (
                <DonutChart
                  size={140}
                  data={view.weekStats.categories.map((c) => ({ label: c.name, value: Math.round(c.revenue) }))}
                  formatValue={(v) => peso(v)}
                />
              ) : (
                <p className="card-sub">Category mix appears once this week's orders match menu categories.</p>
              )}
            </SectionCard>

            <SectionCard title="Tomorrow's Prep Forecast" sub="AI-generated projection — not a guarantee" icon={CalendarClock} className="rise-6">
              {view.forecast ? (
                <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
                  <div>
                    <div className="kpi__label">Projected revenue · {view.forecast.weekdayLabel}</div>
                    <div className="kpi__value" style={{ marginTop: 6 }}>
                      <AnimatedNumber value={view.forecast.value} format={(v) => peso(v)} />
                    </div>
                  </div>
                  <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                    <span className="pill pill--brand">Forecast</span>
                    <span className="pill pill--neutral num">{view.forecast.confidence}% confidence</span>
                  </div>
                  <p className="card-sub">Based on {view.forecast.basis}.</p>
                  {view.busyForecast && (
                    <p className="card-sub" style={{ borderTop: '1px dashed var(--border)', paddingTop: 'var(--sp-3)' }}>
                      Expected busy window: <strong style={{ color: 'var(--text-1)' }}>{view.busyForecast.label}</strong>
                    </p>
                  )}
                </div>
              ) : (
                <p className="card-sub">Forecasting unlocks after ~5 days of sales history.</p>
              )}
            </SectionCard>
          </div>

          {/* ── Detected operational patterns (deterministic, evidence-based) ── */}
          {aiEnabled && aiAnalyticsData.detectedPatterns?.length > 0 && (
            <SectionCard
              title="Detected Patterns"
              sub="Recurring operational behavior the AI found automatically in your history"
              icon={ScanSearch}
              className="rise-5"
            >
              <div style={{ display: 'grid', gap: 'var(--sp-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
                {aiAnalyticsData.detectedPatterns.slice(0, 6).map((p) => (
                  <div className="rec" key={p.key}>
                    <div className="rec__head">
                      <span className="pill pill--brand">{p.tag}</span>
                      <span className="pill pill--neutral num">{p.confidence}% confidence</span>
                    </div>
                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-2)', lineHeight: 1.6, margin: 0 }}>{p.text}</p>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {/* ── Recommendations ── */}
          {aiEnabled && view.recommendations.length > 0 && (
            <SectionCard title="Smart Recommendations" sub="Ranked by business impact — each with evidence and confidence" icon={Sparkles} className="rise-6">
              <div style={{ display: 'grid', gap: 'var(--sp-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
                {view.recommendations.map((rec, i) => (
                  <div className="rec" key={i}>
                    <div className="rec__head">
                      <span className="rec__title">{rec.title}</span>
                      <span className={`pill ${rec.priority === 'high' ? 'pill--danger' : rec.priority === 'medium' ? 'pill--warning' : 'pill--info'}`}>
                        {rec.priority} priority
                      </span>
                    </div>
                    <div className="rec__detail">
                      <span><b>Problem</b> {rec.problem}</span>
                      <span><b>Evidence</b> {rec.evidence}</span>
                      <span><b>Impact</b> {rec.impact}</span>
                    </div>
                    <div className="flex gap-2" style={{ alignItems: 'center' }}>
                      <span className="pill pill--neutral num">{rec.confidence}% confidence</span>
                      {rec.isForecast && <span className="pill pill--brand">AI forecast</span>}
                      <button
                        type="button"
                        className="rec__why"
                        onClick={() => window.dispatchEvent(new CustomEvent('emp:open-ai', {
                          detail: {
                            mode: 'opschat',
                            userText: `Why this recommendation: "${rec.title}"? Explain it using only these already-computed figures — do not invent or recompute any numbers. Problem: ${rec.problem} Evidence: ${rec.evidence} Expected impact: ${rec.impact} (confidence ${rec.confidence}%). Cover why it exists, the supporting evidence, the likely business impact, and what I should do.`,
                          },
                        }))}
                      >
                        Why?
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}
        </>
      )}

      {aiEnabled && presentationOpen && (
        <Suspense fallback={null}>
          <ExecutivePresentation open={presentationOpen} onClose={() => setPresentationOpen(false)} />
        </Suspense>
      )}
    </AppShell>
  );
}
