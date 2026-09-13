import { lazy, Suspense, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Banknote, ReceiptText, Gauge, TrendingUp, Clock3, PieChart, Sigma,
  Sparkles, Presentation, FileText, History, Layers,
} from 'lucide-react';
import AppShell from '../components/layout/AppShell';
import AnimatedNumber from '../components/ui/AnimatedNumber';
import StatDelta from '../components/ui/StatDelta';
import { AreaChart, BarChart, DonutChart, HourHeatStrip, RankedBars } from '../components/ui/charts';
import { useBranchData } from '../context/BranchDataContext';
import { useAuth } from '../context/AuthContext';
import { formatCurrency, formatNumber } from '../lib/statisticsUtils';
import { formatDateKey } from '../lib/analyticsApi';
import {
  resolvePeriod, getPeriodMetrics, getDelta, buildCategoryIndex,
  getPeriodProductStats, formatHourLabel,
} from '../lib/executiveMetrics';
import { generateAIAnalysis } from '../lib/aiAnalystService';
import { isAiEnabled } from '../lib/workspaceApi';
import '../styles/analytics.css';
import '../styles/dashboard.css';

const ExecutivePresentation = lazy(() => import('../components/ai/ExecutivePresentation'));

const peso = (v) => formatCurrency(v);

const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
  { key: '12mo', label: '12 Months' },
  { key: 'custom', label: 'Custom' },
];

function presetToSelection(preset, custom) {
  const today = new Date();
  const key = (d) => formatDateKey(d);
  const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
  switch (preset) {
    case 'yesterday': return { type: 'yesterday' };
    case '7d': return { type: 'range', from: key(daysAgo(6)), to: key(today) };
    case '30d': return { type: 'range', from: key(daysAgo(29)), to: key(today) };
    case 'custom':
      if (custom.from && custom.to) return { type: 'range', from: custom.from, to: custom.to };
      if (custom.from) return { type: 'date', date: custom.from };
      return { type: 'today' };
    default: return { type: 'today' };
  }
}

function DeepSection({ title, data }) {
  if (!data) return null;
  const lists = [data.insights, data.topSelling, data.worstPerforming, data.stockOutRisks,
    data.restockRecommendations, data.busiestHours, data.recommendations, data.leaks,
    data.risks, data.opportunities, data.anomalies].filter((l) => Array.isArray(l) && l.length > 0);
  return (
    <div className="deep__card">
      <div className="deep__cardTitle"><Sparkles size={13} style={{ color: 'var(--primary)' }} />{title}</div>
      {data.summary && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-2)', lineHeight: 1.6 }}>{data.summary}</p>}
      {lists.map((list, i) => (
        <ul className="deep__list" key={i}>
          {list.slice(0, 4).map((item, j) => <li key={j}><span>{item}</span></li>)}
        </ul>
      ))}
    </div>
  );
}

export default function AnalyticsPage() {
  const navigate = useNavigate();
  const { branchId, analytics, analyticsLoaded, inventory, logs, aiAnalyticsData, hasOrders } = useBranchData();
  const { workspace } = useAuth();
  const aiEnabled = isAiEnabled(workspace);

  const [preset, setPreset] = useState('today');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [quickResult, setQuickResult] = useState(null);
  const [deepResult, setDeepResult] = useState(null);
  const [aiBusy, setAiBusy] = useState('');
  const [aiError, setAiError] = useState('');
  const [presentationOpen, setPresentationOpen] = useState(false);

  const isYearView = preset === '12mo';
  const period = useMemo(() => resolvePeriod(presetToSelection(preset, custom)), [preset, custom]);

  const view = useMemo(() => {
    if (!analytics) return null;

    if (isYearView) {
      const months = Object.entries(analytics.monthly || {})
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-12);
      const revenue = months.reduce((s, [, d]) => s + Number(d.revenue || 0), 0);
      const orders = months.reduce((s, [, d]) => s + Number(d.orders || 0), 0);
      return {
        label: 'Last 12 months',
        metrics: { revenue, orders, averageOrderValue: orders > 0 ? revenue / orders : 0 },
        deltas: null,
        chart: months.map(([month, d]) => ({
          label: new Date(`${month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short' }),
          value: Number(d.revenue || 0),
          secondary: `${d.orders || 0} orders`,
        })),
        chartKind: 'bar',
        hourly: null,
        productStats: getPeriodProductStats(logs, [], buildCategoryIndex(inventory)),
        allTimeProducts: true,
      };
    }

    const dayCount = period.dateKeys.length;
    const metrics = { ...getPeriodMetrics(analytics, period.dateKeys), dayCount };
    const compare = getPeriodMetrics(analytics, period.compareKeys);
    const categoryIndex = buildCategoryIndex(inventory);
    const productStats = getPeriodProductStats(logs, period.dateKeys, categoryIndex);

    const chart = period.dateKeys.map((k) => ({
      label: dayCount > 10
        ? new Date(`${k}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : new Date(`${k}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' }),
      value: Number(analytics.daily?.[k]?.revenue || 0),
      secondary: `${analytics.daily?.[k]?.orders || 0} orders`,
    }));

    return {
      label: period.label,
      metrics,
      deltas: {
        revenue: getDelta(metrics.revenue, compare.revenue),
        orders: getDelta(metrics.orders, compare.orders),
        aov: getDelta(metrics.averageOrderValue, compare.averageOrderValue),
      },
      compareLabel: period.compareLabel,
      chart,
      chartKind: dayCount === 1 ? 'hourly' : 'area',
      hourly: metrics.hourlyOrders,
      peak: metrics.peak,
      productStats,
    };
  }, [analytics, inventory, logs, period, isYearView]);

  const statistics = analytics?.statistics || {};
  const summary = analytics?.summary || {};

  async function runQuick() {
    if (!aiEnabled || aiBusy) return;
    setAiError('');
    setAiBusy('quick');
    try {
      // Cache-first: shares the dashboard's realtime cache; the 3-minute cooldown still
      // lets an explicit re-run refresh once the data has had time to move.
      setQuickResult(await generateAIAnalysis(aiAnalyticsData, branchId, false, 'realtime'));
    } catch (e) { setAiError(e.message || 'Quick analysis failed.'); } finally { setAiBusy(''); }
  }

  async function runDeep() {
    if (!aiEnabled || aiBusy) return;
    setAiError('');
    setAiBusy('deep');
    try {
      setDeepResult(await generateAIAnalysis(aiAnalyticsData, branchId, true, 'deep'));
    } catch (e) { setAiError(e.message || 'Report generation failed.'); } finally { setAiBusy(''); }
  }

  if (!analyticsLoaded) {
    return (
      <AppShell title="Analytics">
        <div className="ana__kpis">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 128, borderRadius: 'var(--r-lg)' }} />)}
        </div>
        <div className="skeleton" style={{ height: 320, borderRadius: 'var(--r-lg)' }} />
      </AppShell>
    );
  }

  return (
    <AppShell title="Analytics">
      {/* ── Toolbar ── */}
      <div className="ana__toolbar rise">
        <div className="seg" role="tablist" aria-label="Analytics period">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              role="tab"
              aria-selected={preset === p.key}
              className={`seg__btn ${preset === p.key ? 'is-active' : ''}`}
              onClick={() => setPreset(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn--secondary btn--sm" onClick={() => navigate(`/analytics-history/${branchId}`)}>
            <History size={14} /> Order history
          </button>
          <button className="btn btn--secondary btn--sm" onClick={() => navigate(`/reports/${branchId}`)}>
            <FileText size={14} /> Reports
          </button>
        </div>
      </div>

      {preset === 'custom' && (
        <div className="ana__custom rise" style={{ marginBottom: 'var(--sp-5)' }}>
          <label className="field-label" style={{ margin: 0 }}>From</label>
          <input type="date" className="input" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
          <label className="field-label" style={{ margin: 0 }}>To</label>
          <input type="date" className="input" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          <span className="card-sub">Pick one date for a single day, or both for a range.</span>
        </div>
      )}

      {!hasOrders ? (
        <div className="empty">
          <span className="empty__icon"><TrendingUp size={24} /></span>
          <div className="empty__title">Analytics will appear here</div>
          <p>No completed orders yet for this branch.</p>
        </div>
      ) : (
        <>
          {/* ── AI action bar ── */}
          {aiEnabled && <div className="ana__aiBar rise-1">
            <div>
              <h2 className="card-title"><Sparkles size={17} style={{ color: 'var(--primary)' }} /> Executive Business Analysis</h2>
              <p className="card-sub">Your AI consultant explains what happened, why, and what to do — as a live presentation or a written report.</p>
            </div>
            <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
              <button className="btn btn--primary" onClick={() => setPresentationOpen(true)}>
                <Presentation size={15} /> Launch Presentation
              </button>
              <button className="btn btn--secondary" onClick={runDeep} disabled={Boolean(aiBusy)}>
                {aiBusy === 'deep' ? <span className="spinner" /> : <FileText size={15} />}
                {aiBusy === 'deep' ? 'Building report…' : 'Written Report'}
              </button>
              <button className="btn btn--secondary" onClick={runQuick} disabled={Boolean(aiBusy)}>
                {aiBusy === 'quick' ? <span className="spinner" /> : <Sparkles size={15} />}
                {aiBusy === 'quick' ? 'Analyzing…' : 'Quick Insight'}
              </button>
            </div>
          </div>}

          {aiEnabled && aiError && (
            <div className="login__error" role="alert" style={{ marginBottom: 'var(--sp-4)' }}>{aiError}</div>
          )}

          {aiEnabled && quickResult?.insight && (
            <section className="card card--pad insight rise" style={{ marginBottom: 'var(--sp-4)' }}>
              <div className="flex-between" style={{ marginBottom: 'var(--sp-2)' }}>
                <h2 className="card-title"><Sparkles size={16} style={{ color: 'var(--primary)' }} /> Quick Insight</h2>
                {quickResult.insight.priority && (
                  <span className={`pill ${quickResult.insight.priority === 'HIGH' ? 'pill--danger' : quickResult.insight.priority === 'MEDIUM' ? 'pill--warning' : 'pill--success'}`}>
                    {quickResult.insight.priority}
                  </span>
                )}
              </div>
              <p style={{ color: 'var(--text-2)', lineHeight: 1.65 }}>{quickResult.insight.message}</p>
              {quickResult.insight.action && (
                <p style={{ marginTop: 'var(--sp-3)', fontWeight: 650, fontSize: 'var(--text-sm)' }}>
                  <span className="pill pill--brand" style={{ marginRight: 8 }}>Next action</span>
                  {quickResult.insight.action}
                </p>
              )}
            </section>
          )}

          {/* ── Period KPIs ── */}
          <div className="ana__kpis">
            <div className="card kpi rise-1">
              <div className="kpi__top"><span className="kpi__label">Revenue · {view.label}</span><span className="kpi__icon"><Banknote size={17} /></span></div>
              <div className="kpi__value"><AnimatedNumber value={view.metrics.revenue} format={peso} /></div>
              <div className="kpi__meta">{view.deltas && <StatDelta delta={view.deltas.revenue} label={`vs ${view.compareLabel}`} />}</div>
            </div>
            <div className="card kpi rise-2">
              <div className="kpi__top"><span className="kpi__label">Orders · {view.label}</span><span className="kpi__icon"><ReceiptText size={17} /></span></div>
              <div className="kpi__value"><AnimatedNumber value={view.metrics.orders} /></div>
              <div className="kpi__meta">{view.deltas && <StatDelta delta={view.deltas.orders} label={`vs ${view.compareLabel}`} />}</div>
            </div>
            <div className="card kpi rise-3">
              <div className="kpi__top"><span className="kpi__label">Avg Order Value</span><span className="kpi__icon"><Gauge size={17} /></span></div>
              <div className="kpi__value"><AnimatedNumber value={view.metrics.averageOrderValue} format={peso} /></div>
              <div className="kpi__meta">{view.deltas && <StatDelta delta={view.deltas.aov} label={`vs ${view.compareLabel}`} />}</div>
            </div>
          </div>

          {/* ── Trend chart ── */}
          <section className="card card--pad rise-2" style={{ marginBottom: 'var(--sp-4)' }}>
            <div className="flex-between" style={{ marginBottom: 'var(--sp-4)' }}>
              <div>
                <h2 className="card-title"><TrendingUp size={17} style={{ color: 'var(--primary)' }} /> Revenue — {view.label}</h2>
                {view.peak && <p className="card-sub">Peak: {formatHourLabel(view.peak.peakHour)} ({view.peak.peakOrders} orders) · busy window {view.peak.label}</p>}
              </div>
            </div>
            {view.chartKind === 'hourly' ? (
              <>
                <BarChart
                  height={230}
                  data={(view.hourly || []).map((v, h) => ({
                    label: `${h % 12 || 12}${h >= 12 ? 'p' : 'a'}`,
                    value: v,
                    highlight: view.peak && h >= view.peak.windowStart && h <= view.peak.windowEnd,
                  }))}
                  formatValue={(v) => `${v} orders`}
                />
                <div style={{ marginTop: 'var(--sp-5)' }}>
                  <HourHeatStrip
                    values={view.hourly || []}
                    peakStart={view.peak?.windowStart ?? null}
                    peakEnd={view.peak?.windowEnd ?? null}
                    formatValue={(v) => `${v} orders`}
                  />
                </div>
              </>
            ) : view.chartKind === 'bar' ? (
              <BarChart height={250} data={view.chart} formatValue={peso} />
            ) : (
              <AreaChart height={250} data={view.chart} formatValue={peso} />
            )}
          </section>

          {/* ── Products + categories ── */}
          <div className="ana__grid">
            <section className="card card--pad rise-3">
              <h2 className="card-title" style={{ marginBottom: 'var(--sp-4)' }}>
                <Layers size={17} style={{ color: 'var(--primary)' }} />
                {isYearView ? 'All-Time Product Performance' : `Top Products — ${view.label}`}
              </h2>
              {isYearView ? (
                Object.keys(analytics.products || {}).length > 0 ? (
                  <RankedBars
                    maxItems={8}
                    data={Object.values(analytics.products)
                      .sort((a, b) => (b.quantitySold || 0) - (a.quantitySold || 0))
                      .map((p) => ({ label: p.name, value: p.quantitySold || 0, secondary: peso(p.revenue) }))}
                    formatValue={(v) => `${v} sold`}
                  />
                ) : <p className="card-sub">No product data yet.</p>
              ) : view.productStats.topProducts.length > 0 ? (
                <RankedBars
                  maxItems={8}
                  data={view.productStats.topProducts.map((p) => ({ label: p.name, value: p.quantity, secondary: peso(p.revenue) }))}
                  formatValue={(v) => `${v} sold`}
                />
              ) : (
                <p className="card-sub">No item-level sales recorded in this period.</p>
              )}
            </section>

            <section className="card card--pad rise-4">
              <h2 className="card-title" style={{ marginBottom: 'var(--sp-4)' }}>
                <PieChart size={17} style={{ color: 'var(--primary)' }} /> Revenue by Category
              </h2>
              {view.productStats.categories?.length > 0 ? (
                <DonutChart
                  data={view.productStats.categories.map((c) => ({ label: c.name, value: Math.round(c.revenue) }))}
                  formatValue={peso}
                />
              ) : (
                <p className="card-sub">Category mix appears when orders match menu categories in this period.</p>
              )}
            </section>
          </div>

          {/* ── Advanced statistics + overview ── */}
          <section className="card card--pad rise-4" style={{ marginBottom: 'var(--sp-4)' }}>
            <h2 className="card-title" style={{ marginBottom: 'var(--sp-4)' }}>
              <Sigma size={17} style={{ color: 'var(--primary)' }} /> Statistical Overview
            </h2>
            <div className="ana__statCards">
              <div className="ana__statCard"><span className="ana__statLabel">Mean orders / day</span><span className="ana__statValue num">{formatNumber(statistics.ordersPerDay?.mean || 0)}</span></div>
              <div className="ana__statCard"><span className="ana__statLabel">Median orders / day</span><span className="ana__statValue num">{formatNumber(statistics.ordersPerDay?.median || 0)}</span></div>
              <div className="ana__statCard"><span className="ana__statLabel">Mode orders / day</span><span className="ana__statValue num">{formatNumber(statistics.ordersPerDay?.mode || 0)}</span></div>
              <div className="ana__statCard"><span className="ana__statLabel">Mean revenue / day</span><span className="ana__statValue num">{peso(statistics.revenuePerDay?.mean || 0)}</span></div>
              <div className="ana__statCard"><span className="ana__statLabel">Median revenue / day</span><span className="ana__statValue num">{peso(statistics.revenuePerDay?.median || 0)}</span></div>
              <div className="ana__statCard"><span className="ana__statLabel">Lifetime revenue</span><span className="ana__statValue num">{peso(summary.totalRevenue || 0)}</span></div>
              <div className="ana__statCard"><span className="ana__statLabel">Lifetime orders</span><span className="ana__statValue num">{formatNumber(summary.totalOrders || 0)}</span></div>
              <div className="ana__statCard"><span className="ana__statLabel">Lifetime AOV</span><span className="ana__statValue num">{peso(summary.averageOrderValue || 0)}</span></div>
            </div>
          </section>

          {/* ── Deep report ── */}
          {aiEnabled && deepResult && (
            <section className="card card--pad deep rise" style={{ marginBottom: 'var(--sp-4)' }}>
              <div>
                <h2 className="card-title"><FileText size={17} style={{ color: 'var(--primary)' }} /> AI Deep Analysis Report</h2>
                <p className="card-sub">Full business intelligence review across revenue, products, inventory, staffing and forecasting.</p>
              </div>
              <div className="deep__grid">
                <DeepSection title="Revenue Performance" data={deepResult.revenuePerformance} />
                <DeepSection title="Product Performance" data={deepResult.productPerformance} />
                <DeepSection title="Inventory Analysis" data={deepResult.inventoryAnalysis} />
                <DeepSection title="Peak Hours" data={deepResult.peakHourAnalysis} />
                <DeepSection title="Staffing" data={deepResult.staffingRecommendations} />
                <DeepSection title="Revenue Leaks" data={deepResult.revenueLeakDetection} />
                <DeepSection title="Forecast" data={deepResult.forecasting} />
                {deepResult.operationalRecommendations && (
                  <div className="deep__card">
                    <div className="deep__cardTitle"><Sparkles size={13} style={{ color: 'var(--primary)' }} />Priority Actions</div>
                    {['high', 'medium', 'low'].map((level) => (
                      deepResult.operationalRecommendations[level]?.length > 0 && (
                        <div key={level}>
                          <span className={`pill ${level === 'high' ? 'pill--danger' : level === 'medium' ? 'pill--warning' : 'pill--info'}`} style={{ marginBottom: 6 }}>
                            {level} priority
                          </span>
                          <ul className="deep__list">
                            {deepResult.operationalRecommendations[level].map((item, i) => <li key={i}><span>{item}</span></li>)}
                          </ul>
                        </div>
                      )
                    ))}
                  </div>
                )}
              </div>
              {deepResult.executiveSummary && (
                <p style={{ padding: 'var(--sp-4)', borderRadius: 'var(--r-md)', background: 'var(--primary-soft)', color: 'var(--text-1)', fontWeight: 550, lineHeight: 1.6 }}>
                  <strong>Executive summary:</strong> {deepResult.executiveSummary}
                </p>
              )}
            </section>
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
