import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, ChevronLeft, ChevronRight, Play, Pause, Coffee,
  TrendingUp, TrendingDown, Sparkles, AlertTriangle, Lightbulb, CalendarClock,
} from 'lucide-react';
import { useBranchData } from '../../context/BranchDataContext';
import { useAuth } from '../../context/AuthContext';
import { AUTH_CONFIG } from '../../config/authConfig';
import AnimatedNumber from '../ui/AnimatedNumber';
import Sparkline from '../ui/Sparkline';
import { BarChart, HourHeatStrip, RankedBars } from '../ui/charts';
import { formatCurrency } from '../../lib/statisticsUtils';
import {
  resolvePeriod, getPeriodMetrics, getDelta, buildCategoryIndex, getPeriodProductStats,
  getWeekComparison, forecastTomorrowRevenue, forecastBusyHours, getDailySeries, formatHourLabel,
} from '../../lib/executiveMetrics';
import { generateAIAnalysis } from '../../lib/aiAnalystService';
import '../../styles/presentation.css';

const peso = (v) => formatCurrency(v);
const AUTOPLAY_MS = 9000;

/**
 * Executive AI Presentation — the V2 signature feature.
 * An AI consultant walks the owner through the business scene by scene,
 * with animated data and narration, like a board-meeting briefing.
 */
export default function ExecutivePresentation({ open, onClose }) {
  const { branchId, analytics, logs, inventory, aiAnalyticsData } = useBranchData();
  const { nickname, user } = useAuth();
  const [ai, setAi] = useState(null);
  const [aiError, setAiError] = useState(false);
  const [scene, setScene] = useState(-1); // -1 = loading/title
  const [playing, setPlaying] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);

  const branchLabel = AUTH_CONFIG.branches[branchId]?.name || branchId;
  const managerNickname = nickname || user?.email?.split('@')[0] || 'Manager';

  // Deterministic data for every scene
  const data = useMemo(() => {
    if (!analytics) return null;
    const period = resolvePeriod({ type: 'today' });
    const today = getPeriodMetrics(analytics, period.dateKeys);
    const yesterday = getPeriodMetrics(analytics, period.compareKeys);
    const revenueDelta = getDelta(today.revenue, yesterday.revenue);
    const ordersDelta = getDelta(today.orders, yesterday.orders);
    const week = getWeekComparison(analytics);
    const weekDelta = getDelta(week.thisWeek.revenue, week.lastWeek.revenue);
    const categoryIndex = buildCategoryIndex(inventory);
    const todayProducts = getPeriodProductStats(logs, period.dateKeys, categoryIndex);
    const trend14 = getDailySeries(analytics.daily, new Date(), 14, 'revenue');
    const forecast = forecastTomorrowRevenue(analytics.daily);
    const busy = forecastBusyHours(analytics.hourly);
    return { period, today, yesterday, revenueDelta, ordersDelta, week, weekDelta, todayProducts, trend14, forecast, busy };
  }, [analytics, logs, inventory]);

  // AI narration (executive mode)
  useEffect(() => {
    if (!open || !branchId) return undefined;
    let cancelled = false;
    setAi(null);
    setAiError(false);
    generateAIAnalysis(
      { ...aiAnalyticsData, reportContext: { managerNickname, branchLabel, asOfLabel: new Date().toLocaleString() } },
      branchId,
      false, // re-opens within the hour replay the cached narration instead of re-billing
      'executive'
    )
      .then((result) => { if (!cancelled) setAi(result); })
      .catch(() => { if (!cancelled) setAiError(true); });
    return () => { cancelled = true; };
  }, [open, branchId]); // eslint-disable-line react-hooks/exhaustive-deps

  const scenes = useMemo(() => {
    if (!data) return [];
    const s = [];

    s.push({ key: 'headline', kicker: 'Executive Briefing' });
    s.push({ key: 'todayVsYesterday', kicker: 'Scene 1 — Daily Performance' });
    s.push({ key: 'weekVsWeek', kicker: 'Scene 2 — Weekly Momentum' });
    s.push({ key: 'products', kicker: 'Scene 3 — Product Movers' });
    s.push({ key: 'peakHours', kicker: 'Scene 4 — Operating Rhythm' });
    s.push({ key: 'risksOps', kicker: 'Scene 5 — Risks & Opportunities' });
    s.push({ key: 'forecast', kicker: 'Scene 6 — Forecast' });
    s.push({ key: 'actions', kicker: 'Scene 7 — Action Plan' });
    s.push({ key: 'summary', kicker: 'Executive Summary' });
    return s;
  }, [data]);

  const ready = Boolean(data) && (Boolean(ai) || aiError);

  // Auto-advance from the loading screen when ready.
  useEffect(() => {
    if (open && scene === -1 && ready) {
      const t = setTimeout(() => setScene(0), 700);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open, scene, ready]);

  // Autoplay timer.
  useEffect(() => {
    clearInterval(timerRef.current);
    setElapsed(0);
    if (!open || !playing || scene < 0 || scene >= scenes.length) return undefined;
    const startedAt = Date.now();
    timerRef.current = setInterval(() => {
      const e = Date.now() - startedAt;
      setElapsed(e);
      if (e >= AUTOPLAY_MS) {
        setScene((cur) => {
          if (cur >= scenes.length - 1) { setPlaying(false); return cur; }
          return cur + 1;
        });
      }
    }, 100);
    return () => clearInterval(timerRef.current);
  }, [open, playing, scene, scenes.length]);

  // Keyboard navigation.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if (e.key === 'ArrowRight') setScene((c) => Math.min(scenes.length - 1, c + 1));
      if (e.key === 'ArrowLeft') setScene((c) => Math.max(0, c - 1));
      if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p); }
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose, scenes.length]);

  const narrationFor = (key) => {
    if (!ai) return null;
    switch (key) {
      case 'todayVsYesterday': return ai.scenes?.todayVsYesterday?.narration;
      case 'weekVsWeek': return ai.scenes?.weekVsLastWeek?.narration;
      case 'products': return ai.scenes?.productMovers?.narration;
      default: return null;
    }
  };

  const fallbackNarration = 'AI narration is unavailable right now — the numbers below still reflect your live data.';

  function renderScene() {
    if (!data) return null;
    const sc = scenes[scene];
    if (!sc) return null;

    switch (sc.key) {
      case 'headline':
        return (
          <div className="pres__scene" key="headline">
            <div className="pres__kicker">{sc.kicker} · {branchLabel}</div>
            <h2 className="pres__title">
              {ai?.headline ? <>{ai.headline}</> : <>Here is how <em>{branchLabel}</em> is performing, {managerNickname}.</>}
            </h2>
            <div className="pres__panel pres__delayed1">
              <div className="pres__bigLabel">Revenue — last 14 days</div>
              <div style={{ marginTop: 12 }}>
                <Sparkline data={data.trend14.series} width={760} height={90} color="#e6c896" strokeWidth={2.5} />
              </div>
            </div>
            {typeof ai?.confidenceScore === 'number' && ai.confidenceScore > 0 && (
              <div className="pres__delayed2">
                <span className="pill" style={{ background: 'rgba(196,165,116,0.18)', color: '#e6c896' }}>
                  Analysis confidence: {ai.confidenceScore}%
                </span>
              </div>
            )}
          </div>
        );

      case 'todayVsYesterday':
        return (
          <div className="pres__scene" key="tvy">
            <div className="pres__kicker">{sc.kicker}</div>
            <h2 className="pres__title">Today vs <em>yesterday</em></h2>
            <div className="pres__panel">
              <div className="pres__compare">
                <div>
                  <div className="pres__bigLabel">Today</div>
                  <div className="pres__bigValue"><AnimatedNumber value={data.today.revenue} format={peso} duration={1200} /></div>
                  <div style={{ color: 'rgba(245,230,211,0.6)', fontSize: 'var(--text-sm)', marginTop: 4 }} className="num">
                    {data.today.orders} orders · AOV {peso(data.today.averageOrderValue)}
                  </div>
                </div>
                <div className="pres__vs">VS</div>
                <div className="pres__delayed1">
                  <div className="pres__bigLabel">Yesterday</div>
                  <div className="pres__bigValue" style={{ opacity: 0.65 }}><AnimatedNumber value={data.yesterday.revenue} format={peso} duration={1200} /></div>
                  <div style={{ color: 'rgba(245,230,211,0.6)', fontSize: 'var(--text-sm)', marginTop: 4 }} className="num">
                    {data.yesterday.orders} orders · AOV {peso(data.yesterday.averageOrderValue)}
                  </div>
                </div>
              </div>
              {data.revenueDelta.available && (
                <div className="pres__delayed2" style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
                  {data.revenueDelta.direction === 'down' ? <TrendingDown size={20} color="#e08a70" /> : <TrendingUp size={20} color="#8fb98f" />}
                  <span style={{ fontWeight: 700, fontSize: '1.1rem', color: data.revenueDelta.direction === 'down' ? '#e08a70' : '#8fb98f' }} className="num">
                    {data.revenueDelta.pct > 0 ? '+' : ''}{data.revenueDelta.pct?.toFixed(1)}% revenue vs yesterday
                  </span>
                </div>
              )}
            </div>
            <p className="pres__narration pres__delayed2">
              {narrationFor('todayVsYesterday') || (aiError ? fallbackNarration : ai?.scenes?.todayVsYesterday?.keyDifference) || 'Comparing today with yesterday as orders come in.'}
            </p>
          </div>
        );

      case 'weekVsWeek':
        return (
          <div className="pres__scene" key="wvw">
            <div className="pres__kicker">{sc.kicker}</div>
            <h2 className="pres__title">This week vs <em>last week</em></h2>
            <div className="pres__panel">
              <BarChart
                height={200}
                color="rgba(196,165,116,0.45)"
                highlightColor="#c4a574"
                data={[
                  { label: `Last week`, value: data.week.lastWeek.revenue, secondary: `${data.week.lastWeek.orders} orders` },
                  { label: `This week`, value: data.week.thisWeek.revenue, secondary: `${data.week.thisWeek.orders} orders`, highlight: true },
                ]}
                formatValue={peso}
              />
              {data.weekDelta.available && (
                <div className="pres__delayed2" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  {data.weekDelta.direction === 'down' ? <TrendingDown size={18} color="#e08a70" /> : <TrendingUp size={18} color="#8fb98f" />}
                  <span className="num" style={{ fontWeight: 700, color: data.weekDelta.direction === 'down' ? '#e08a70' : '#8fb98f' }}>
                    {data.weekDelta.pct > 0 ? '+' : ''}{data.weekDelta.pct?.toFixed(1)}% week over week
                  </span>
                </div>
              )}
            </div>
            <p className="pres__narration pres__delayed2">
              {narrationFor('weekVsWeek') || (aiError ? fallbackNarration : ai?.scenes?.weekVsLastWeek?.keyDifference) || 'Weekly momentum builds as the week progresses.'}
            </p>
          </div>
        );

      case 'products': {
        const winners = ai?.scenes?.productMovers?.winners || [];
        const losers = ai?.scenes?.productMovers?.losers || [];
        return (
          <div className="pres__scene" key="products">
            <div className="pres__kicker">{sc.kicker}</div>
            <h2 className="pres__title">What's <em>selling</em> today</h2>
            <div className="pres__panel">
              {data.todayProducts.topProducts.length > 0 ? (
                <RankedBars
                  color="rgba(196,165,116,0.85)"
                  data={data.todayProducts.topProducts.map((p) => ({ label: p.name, value: p.quantity, secondary: peso(p.revenue) }))}
                  formatValue={(v) => `${v} sold`}
                />
              ) : (
                <p style={{ color: 'rgba(245,230,211,0.6)' }}>No item-level sales yet today.</p>
              )}
            </div>
            {(winners.length > 0 || losers.length > 0) && (
              <div className="pres__cards pres__delayed2" style={{ gridTemplateColumns: winners.length && losers.length ? '1fr 1fr' : '1fr', display: 'grid' }}>
                {winners.length > 0 && (
                  <div className="pres__panel" style={{ padding: 'var(--sp-4)' }}>
                    <div className="pres__bigLabel" style={{ color: '#8fb98f', marginBottom: 8 }}>Gaining demand</div>
                    {winners.slice(0, 2).map((w, i) => <p key={i} style={{ fontSize: 'var(--text-sm)', color: 'rgba(245,230,211,0.85)', lineHeight: 1.6 }}>{w}</p>)}
                  </div>
                )}
                {losers.length > 0 && (
                  <div className="pres__panel" style={{ padding: 'var(--sp-4)' }}>
                    <div className="pres__bigLabel" style={{ color: '#e08a70', marginBottom: 8 }}>Losing demand</div>
                    {losers.slice(0, 2).map((l, i) => <p key={i} style={{ fontSize: 'var(--text-sm)', color: 'rgba(245,230,211,0.85)', lineHeight: 1.6 }}>{l}</p>)}
                  </div>
                )}
              </div>
            )}
            <p className="pres__narration pres__delayed3">
              {narrationFor('products') || (aiError ? fallbackNarration : 'Product demand ranked by units sold today.')}
            </p>
          </div>
        );
      }

      case 'peakHours':
        return (
          <div className="pres__scene" key="peak">
            <div className="pres__kicker">{sc.kicker}</div>
            <h2 className="pres__title">Your operating <em>rhythm</em></h2>
            <div className="pres__panel">
              <HourHeatStrip
                values={data.today.hourlyOrders}
                peakStart={data.today.peak?.windowStart ?? null}
                peakEnd={data.today.peak?.windowEnd ?? null}
                formatValue={(v) => `${v} orders`}
              />
            </div>
            <p className="pres__narration pres__delayed2">
              {data.today.peak
                ? `Today peaked at ${formatHourLabel(data.today.peak.peakHour)} with ${data.today.peak.peakOrders} orders — the busy window ran ${data.today.peak.label}. ${data.busy ? `Historically the rush lands around ${data.busy.label}, so prep and staffing should be in place before it.` : ''}`
                : 'No clear peak has formed yet today. The heat strip fills in as orders arrive.'}
            </p>
            {ai?.patterns?.length > 0 && (
              <div className="pres__cards pres__delayed3">
                {ai.patterns.slice(0, 2).map((p, i) => (
                  <div className="pres__listItem" key={i}>
                    <Sparkles size={16} style={{ color: '#e6c896', flexShrink: 0, marginTop: 3 }} />
                    <span>{p}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      case 'risksOps': {
        const risks = ai?.risks || [];
        const opportunities = ai?.opportunities || [];
        return (
          <div className="pres__scene" key="riskops">
            <div className="pres__kicker">{sc.kicker}</div>
            <h2 className="pres__title">Risks & <em>opportunities</em></h2>
            <div className="pres__cards">
              {risks.slice(0, 3).map((r, i) => (
                <div className={`pres__listItem pres__delayed${Math.min(3, i + 1)}`} key={`r${i}`}>
                  <AlertTriangle size={16} style={{ color: '#e08a70', flexShrink: 0, marginTop: 3 }} />
                  <span>{r}</span>
                </div>
              ))}
              {opportunities.slice(0, 3).map((o, i) => (
                <div className={`pres__listItem pres__delayed${Math.min(3, i + 1)}`} key={`o${i}`}>
                  <Lightbulb size={16} style={{ color: '#fbbf24', flexShrink: 0, marginTop: 3 }} />
                  <span>{o}</span>
                </div>
              ))}
              {risks.length === 0 && opportunities.length === 0 && (
                <p className="pres__narration">{aiError ? fallbackNarration : 'No specific risks or opportunities were flagged for this period.'}</p>
              )}
            </div>
          </div>
        );
      }

      case 'forecast':
        return (
          <div className="pres__scene" key="forecast">
            <div className="pres__kicker">{sc.kicker}</div>
            <h2 className="pres__title">Tomorrow, <em>projected</em></h2>
            <div className="pres__panel">
              {data.forecast ? (
                <div className="pres__compare">
                  <div>
                    <div className="pres__bigLabel">Projected revenue · {data.forecast.weekdayLabel}</div>
                    <div className="pres__bigValue"><AnimatedNumber value={data.forecast.value} format={peso} duration={1400} /></div>
                    <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <span className="pill" style={{ background: 'rgba(196,165,116,0.18)', color: '#e6c896' }}>AI forecast</span>
                      <span className="pill num" style={{ background: 'rgba(245,230,211,0.1)', color: 'rgba(245,230,211,0.7)' }}>{data.forecast.confidence}% confidence</span>
                    </div>
                  </div>
                  {data.busy && (
                    <>
                      <div className="pres__vs" style={{ background: 'rgba(217,171,92,0.14)', borderColor: 'rgba(217,171,92,0.45)', color: '#e0c56e' }}>
                        <CalendarClock size={18} />
                      </div>
                      <div className="pres__delayed1">
                        <div className="pres__bigLabel">Expected rush</div>
                        <div className="pres__bigValue" style={{ fontSize: 'clamp(1.3rem,3vw,2rem)' }}>{data.busy.label}</div>
                        <div style={{ color: 'rgba(245,230,211,0.55)', fontSize: 'var(--text-sm)', marginTop: 4 }}>from {data.busy.basis}</div>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <p style={{ color: 'rgba(245,230,211,0.65)' }}>Forecasting unlocks after about five days of sales history.</p>
              )}
            </div>
            <p className="pres__narration pres__delayed2">
              {ai?.forecastOutlook || (data.forecast ? `Based on ${data.forecast.basis}. Treat this as a planning aid, not a guarantee.` : '')}
            </p>
          </div>
        );

      case 'actions': {
        const plan = ai?.actionPlan || [];
        return (
          <div className="pres__scene" key="actions">
            <div className="pres__kicker">{sc.kicker}</div>
            <h2 className="pres__title">Your <em>action plan</em></h2>
            <div className="pres__cards">
              {plan.length > 0 ? plan.slice(0, 5).map((a, i) => (
                <div className={`pres__listItem pres__delayed${Math.min(3, i + 1)}`} key={i}>
                  <span className="pres__badgeNum">{a.priority || i + 1}</span>
                  <span>
                    <strong style={{ color: '#fff' }}>{a.action}</strong>
                    {a.detail ? <><br /><span style={{ color: 'rgba(245,230,211,0.7)', fontSize: 'var(--text-sm)' }}>{a.detail}</span></> : null}
                  </span>
                </div>
              )) : (
                <p className="pres__narration">{aiError ? fallbackNarration : 'No actions were generated for this period.'}</p>
              )}
            </div>
          </div>
        );
      }

      case 'summary':
        return (
          <div className="pres__scene" key="summary">
            <div className="pres__kicker">{sc.kicker}</div>
            <h2 className="pres__title">The <em>bottom line</em></h2>
            <p className="pres__narration" style={{ fontSize: 'clamp(1.05rem,2vw,1.3rem)', maxWidth: '58ch' }}>
              {ai?.closingSummary || `Today: ${peso(data.today.revenue)} across ${data.today.orders} orders. This week is at ${peso(data.week.thisWeek.revenue)} vs ${peso(data.week.lastWeek.revenue)} last week.`}
            </p>
            <div className="pres__delayed2" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="pres__navBtn pres__navBtn--primary" onClick={() => setScene(0)}>
                <Play size={15} /> Replay briefing
              </button>
              <button className="pres__navBtn" onClick={onClose}>Back to dashboard</button>
            </div>
          </div>
        );

      default:
        return null;
    }
  }

  if (!open) return null;

  // Portal to <body> so no transformed ancestor can offset this fixed overlay.
  return createPortal(
    <div className="pres" role="dialog" aria-modal="true" aria-label="Executive AI presentation">
      <header className="pres__head">
        <div className="pres__brand">
          <div className="shell__brandMark" style={{ width: 32, height: 32, borderRadius: 10 }}><Coffee size={16} /></div>
          <span style={{ fontSize: '0.9rem' }}>E-Menu Portal · Executive Briefing</span>
        </div>
        {scene >= 0 && (
          <div className="pres__progress" role="tablist" aria-label="Presentation progress">
            {scenes.map((s, i) => (
              <button
                key={s.key}
                className="pres__progressSeg"
                onClick={() => setScene(i)}
                aria-label={`Go to ${s.kicker}`}
              >
                <span
                  className="pres__progressFill"
                  style={{ width: i < scene ? '100%' : i === scene ? `${Math.min(100, (elapsed / AUTOPLAY_MS) * 100)}%` : '0%' }}
                />
              </button>
            ))}
          </div>
        )}
        <button className="pres__navBtn" style={{ minHeight: 38, padding: '0 12px' }} onClick={onClose} aria-label="Close presentation">
          <X size={17} />
        </button>
      </header>

      <div className="pres__stage">
        {scene === -1 ? (
          <div className="pres__loading">
            <div className="pres__orb"><Coffee size={34} /></div>
            <div>
              <h2 className="pres__title" style={{ fontSize: 'clamp(1.3rem,3vw,1.9rem)' }}>Preparing your briefing…</h2>
              <p style={{ color: 'rgba(245,230,211,0.6)', marginTop: 8 }}>
                The AI consultant is reviewing revenue, products, inventory and demand patterns for {branchLabel}.
              </p>
            </div>
          </div>
        ) : renderScene()}
      </div>

      {scene >= 0 && (
        <footer className="pres__foot">
          <button className="pres__navBtn" onClick={() => setScene((c) => Math.max(0, c - 1))} disabled={scene === 0}>
            <ChevronLeft size={16} /> Back
          </button>
          <button className="pres__navBtn" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause autoplay' : 'Resume autoplay'}>
            {playing ? <Pause size={15} /> : <Play size={15} />}
            {playing ? 'Pause' : 'Play'}
          </button>
          <button
            className="pres__navBtn pres__navBtn--primary"
            onClick={() => setScene((c) => Math.min(scenes.length - 1, c + 1))}
            disabled={scene >= scenes.length - 1}
          >
            Next <ChevronRight size={16} />
          </button>
        </footer>
      )}
    </div>,
    document.body
  );
}
