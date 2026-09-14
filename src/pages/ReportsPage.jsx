import { useMemo, useState } from 'react';
import { Printer, Sparkles, FileBarChart } from 'lucide-react';
import AppShell from '../components/layout/AppShell';
import { AreaChart, DonutChart, RankedBars } from '../components/ui/charts';
import { useBranchData } from '../context/BranchDataContext';
import { useAuth } from '../context/AuthContext';
import { branchLabel } from '../lib/branchLabel';
import { formatCurrency, formatNumber } from '../lib/statisticsUtils';
import { formatDateKey } from '../lib/analyticsApi';
import {
  resolvePeriod, getPeriodMetrics, getDelta, buildCategoryIndex, getPeriodProductStats,
  forecastTomorrowRevenue, formatHourLabel,
} from '../lib/executiveMetrics';
import { generateAIAnalysis } from '../lib/aiAnalystService';
import { useAiAccess } from '../hooks/useAiAccess';
import '../styles/reports.css';
import '../styles/analytics.css';

const peso = (v) => formatCurrency(v);

const RANGES = [
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
];

export default function ReportsPage() {
  const { branchId, analytics, inventory, logs, aiAnalyticsData, hasOrders } = useBranchData();
  const { nickname, user, workspace } = useAuth();
  const aiEnabled = useAiAccess();
  const [rangeKey, setRangeKey] = useState('7d');
  const [commentary, setCommentary] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');

  const branchName = branchLabel({ workspace, branchId });
  const range = RANGES.find((r) => r.key === rangeKey) || RANGES[0];

  const view = useMemo(() => {
    if (!analytics) return null;
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - (range.days - 1));
    const period = resolvePeriod({ type: 'range', from: formatDateKey(from), to: formatDateKey(to) });
    const metrics = { ...getPeriodMetrics(analytics, period.dateKeys), dayCount: period.dateKeys.length };
    const compare = getPeriodMetrics(analytics, period.compareKeys);
    const categoryIndex = buildCategoryIndex(inventory);
    const productStats = getPeriodProductStats(logs, period.dateKeys, categoryIndex);
    const forecast = forecastTomorrowRevenue(analytics.daily);
    const chart = period.dateKeys.map((k) => ({
      label: new Date(`${k}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      value: Number(analytics.daily?.[k]?.revenue || 0),
      secondary: `${analytics.daily?.[k]?.orders || 0} orders`,
    }));
    return {
      period,
      metrics,
      revenueDelta: getDelta(metrics.revenue, compare.revenue),
      ordersDelta: getDelta(metrics.orders, compare.orders),
      productStats,
      forecast,
      chart,
    };
  }, [analytics, inventory, logs, range]);

  async function addCommentary() {
    if (!aiEnabled || aiBusy) return;
    setAiBusy(true);
    setAiError('');
    try {
      const result = await generateAIAnalysis(aiAnalyticsData, branchId, true, 'deep');
      setCommentary(result);
    } catch (e) {
      setAiError(e.message || 'AI commentary failed.');
    } finally {
      setAiBusy(false);
    }
  }

  const generatedAt = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
  const deltaText = (d) => (d?.available && d.pct !== null ? `${d.pct > 0 ? '+' : ''}${d.pct.toFixed(1)}% vs previous period` : 'no comparison data');

  return (
    <AppShell title="Reports">
      <div className="flex-between report-toolbar rise" style={{ marginBottom: 'var(--sp-5)', flexWrap: 'wrap' }}>
        <div className="seg">
          {RANGES.map((r) => (
            <button key={r.key} className={`seg__btn ${rangeKey === r.key ? 'is-active' : ''}`} onClick={() => { setRangeKey(r.key); }}>
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          {aiEnabled && <button className="btn btn--secondary" onClick={addCommentary} disabled={aiBusy || !hasOrders}>
            {aiBusy ? <span className="spinner" /> : <Sparkles size={15} />}
            {aiBusy ? 'Writing…' : commentary ? 'Refresh AI commentary' : 'Add AI commentary'}
          </button>}
          <button className="btn btn--primary" onClick={() => window.print()}>
            <Printer size={15} /> Print / Save PDF
          </button>
        </div>
      </div>

      {aiEnabled && aiError && <div className="login__error" role="alert" style={{ marginBottom: 'var(--sp-4)' }}>{aiError}</div>}

      {!hasOrders || !view ? (
        <div className="empty">
          <span className="empty__icon"><FileBarChart size={24} /></span>
          <div className="empty__title">No data to report yet</div>
          <p>Reports become available once orders are recorded.</p>
        </div>
      ) : (
        <article className="report rise-1">
          <header className="report__masthead">
            <div>
              <h2 className="report__title">Executive Business Report</h2>
              <p className="report__meta">
                {branchName} · {view.period.label} · Prepared for {nickname || user?.email?.split('@')[0]} · Generated {generatedAt}
              </p>
            </div>
            <div className="shell__brandMark" style={{ width: 44, height: 44 }}><FileBarChart size={20} /></div>
          </header>

          <section className="report__section">
            <h3 className="report__sectionTitle">Key figures</h3>
            <div className="report__kpis">
              <div className="report__kpi">
                <div className="report__kpiLabel">Revenue</div>
                <div className="report__kpiValue num">{peso(view.metrics.revenue)}</div>
                <div className="card-sub">{deltaText(view.revenueDelta)}</div>
              </div>
              <div className="report__kpi">
                <div className="report__kpiLabel">Orders</div>
                <div className="report__kpiValue num">{formatNumber(view.metrics.orders)}</div>
                <div className="card-sub">{deltaText(view.ordersDelta)}</div>
              </div>
              <div className="report__kpi">
                <div className="report__kpiLabel">Avg order value</div>
                <div className="report__kpiValue num">{peso(view.metrics.averageOrderValue)}</div>
                <div className="card-sub">across {view.metrics.dayCount} days</div>
              </div>
              <div className="report__kpi">
                <div className="report__kpiLabel">Peak hour</div>
                <div className="report__kpiValue">{view.metrics.peak ? formatHourLabel(view.metrics.peak.peakHour) : '—'}</div>
                <div className="card-sub">{view.metrics.peak ? `window ${view.metrics.peak.label}` : 'no peak detected'}</div>
              </div>
            </div>
          </section>

          <section className="report__section">
            <h3 className="report__sectionTitle">Revenue trend</h3>
            <AreaChart height={220} data={view.chart} formatValue={peso} />
          </section>

          <section className="report__section">
            <h3 className="report__sectionTitle">Product performance</h3>
            {view.productStats.topProducts.length > 0 ? (
              <RankedBars
                maxItems={8}
                data={view.productStats.topProducts.map((p) => ({ label: p.name, value: p.quantity, secondary: peso(p.revenue) }))}
                formatValue={(v) => `${v} sold`}
              />
            ) : <p className="card-sub">No item-level sales in this period.</p>}
          </section>

          {view.productStats.categories?.length > 0 && (
            <section className="report__section">
              <h3 className="report__sectionTitle">Category mix</h3>
              <DonutChart
                data={view.productStats.categories.map((c) => ({ label: c.name, value: Math.round(c.revenue) }))}
                formatValue={peso}
              />
            </section>
          )}

          {view.forecast && (
            <section className="report__section">
              <h3 className="report__sectionTitle">Outlook</h3>
              <p style={{ lineHeight: 1.7, color: 'var(--text-2)' }}>
                Tomorrow ({view.forecast.weekdayLabel}) is projected at <strong className="num" style={{ color: 'var(--text-1)' }}>{peso(view.forecast.value)}</strong> revenue
                — an AI-generated forecast at {view.forecast.confidence}% confidence, based on {view.forecast.basis}. Treat as a planning aid, not a guarantee.
              </p>
            </section>
          )}

          {commentary && (
            <section className="report__section">
              <h3 className="report__sectionTitle">AI analyst commentary</h3>
              <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
                {[
                  ['Revenue', commentary.revenuePerformance?.summary],
                  ['Products', commentary.productPerformance?.summary],
                  ['Inventory', commentary.inventoryAnalysis?.summary],
                  ['Staffing', commentary.staffingRecommendations?.summary],
                  ['Forecast', commentary.forecasting?.summary],
                ].filter(([, text]) => text).map(([label, text]) => (
                  <p key={label} style={{ lineHeight: 1.7, color: 'var(--text-2)' }}>
                    <strong style={{ color: 'var(--text-1)' }}>{label}: </strong>{text}
                  </p>
                ))}
              </div>
              {commentary.executiveSummary && (
                <div className="report__summary" style={{ marginTop: 'var(--sp-4)' }}>
                  <strong>Executive summary — </strong>{commentary.executiveSummary}
                </div>
              )}
            </section>
          )}

          <footer style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-4)', color: 'var(--text-3)', fontSize: 'var(--text-xs)' }}>
            E-Menu Portal · Powered by Touch · Data source: live operations database · Forecasts are AI-generated projections.
          </footer>
        </article>
      )}
    </AppShell>
  );
}
