import { useId, useMemo, useState, useCallback } from 'react';

/**
 * Lightweight interactive SVG charts.
 * Zero chart dependencies — full design-token theming, hover tooltips,
 * entrance animation via CSS, responsive via viewBox.
 */

function useTooltip() {
  const [tip, setTip] = useState(null);
  const show = useCallback((payload) => setTip(payload), []);
  const hide = useCallback(() => setTip(null), []);
  return { tip, show, hide };
}

function Tooltip({ tip, formatValue }) {
  if (!tip) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: `${tip.xPct}%`,
        top: `${tip.yPct}%`,
        transform: `translate(${tip.xPct > 50 ? '-108%' : '10px'}, ${tip.yPct > 70 ? '-100%' : tip.yPct < 20 ? '0' : '-50%'})`,
        background: 'var(--surface)',
        border: '1px solid var(--border-strong)',
        borderRadius: 10,
        boxShadow: 'var(--shadow-md)',
        padding: '7px 11px',
        pointerEvents: 'none',
        zIndex: 5,
        whiteSpace: 'nowrap',
      }}
    >
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)', fontWeight: 600 }}>{tip.label}</div>
      <div className="num" style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--text-1)' }}>
        {formatValue ? formatValue(tip.value) : tip.value.toLocaleString()}
      </div>
      {tip.secondary && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)' }}>{tip.secondary}</div>
      )}
    </div>
  );
}

function niceTicks(max, count = 4) {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2.5 ? 5 : norm >= 1.5 ? 2.5 : norm > 1 ? 2 : 1) * mag;
  // The top tick MUST cover the data max, otherwise points above it render
  // outside the viewBox and the chart appears cut off at the top.
  const top = Math.ceil(max / step - 1e-9) * step;
  const ticks = [];
  for (let v = 0; v <= top + step * 0.001; v += step) ticks.push(v);
  return ticks;
}

function compactNumber(v) {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}k`;
  return `${Math.round(v)}`;
}

/**
 * Area/line trend chart.
 * data: [{ label, value, secondary? }]
 */
export function AreaChart({ data = [], height = 240, color = 'var(--chart-1)', formatValue, showGrid = true }) {
  const gradId = useId();
  const { tip, show, hide } = useTooltip();
  const W = 800;
  const H = height;
  const padL = 46;
  const padR = 14;
  const padT = 16;
  const padB = 30;

  const { points, ticks, max } = useMemo(() => {
    const values = data.map((d) => Number(d.value) || 0);
    const mx = Math.max(1, ...values);
    const tks = niceTicks(mx);
    const top = tks[tks.length - 1];
    const pts = data.map((d, i) => {
      const x = padL + (data.length > 1 ? (i / (data.length - 1)) * (W - padL - padR) : (W - padL - padR) / 2);
      const y = padT + (1 - (Number(d.value) || 0) / top) * (H - padT - padB);
      return { x, y, ...d };
    });
    return { points: pts, ticks: tks, max: top };
  }, [data, H]);

  if (data.length === 0) return null;

  let path = '';
  points.forEach((p, i) => {
    if (i === 0) { path = `M ${p.x} ${p.y}`; return; }
    const prev = points[i - 1];
    const cx = (prev.x + p.x) / 2;
    path += ` C ${cx} ${prev.y}, ${cx} ${p.y}, ${p.x} ${p.y}`;
  });
  const area = `${path} L ${points[points.length - 1].x} ${H - padB} L ${points[0].x} ${H - padB} Z`;

  const labelEvery = Math.max(1, Math.ceil(data.length / 8));

  return (
    <div style={{ position: 'relative', overflow: 'hidden' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }} role="img" aria-label="Trend chart">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {showGrid && ticks.map((t) => {
          const y = padT + (1 - t / max) * (H - padT - padB);
          return (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="var(--chart-grid)" strokeWidth="1" />
              <text x={padL - 8} y={y + 3.5} textAnchor="end" fontSize="11" fill="var(--text-3)" fontFamily="var(--font-mono)">
                {compactNumber(t)}
              </text>
            </g>
          );
        })}

        {points.map((p, i) => (
          i % labelEvery === 0 ? (
            <text key={`x${i}`} x={p.x} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--text-3)">
              {p.label}
            </text>
          ) : null
        ))}

        <path d={area} fill={`url(#${gradId})`} style={{ animation: 'chartFade 900ms ease 250ms backwards' }} />
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          pathLength="1"
          strokeDasharray="1"
          style={{ animation: 'chartDraw 1100ms var(--ease-out) backwards' }}
        />

        {points.map((p, i) => (
          <g key={i}>
            <rect
              x={p.x - (W / Math.max(1, points.length)) / 2}
              y={0}
              width={W / Math.max(1, points.length)}
              height={H}
              fill="transparent"
              onMouseEnter={() => show({ xPct: (p.x / W) * 100, yPct: (p.y / H) * 100, yPx: p.y, label: p.label, value: p.value, secondary: p.secondary })}
              onMouseLeave={hide}
              onTouchStart={() => show({ xPct: (p.x / W) * 100, yPct: (p.y / H) * 100, yPx: p.y, label: p.label, value: p.value, secondary: p.secondary })}
            />
            {tip && tip.label === p.label && tip.value === p.value ? (
              <>
                <line x1={p.x} x2={p.x} y1={padT} y2={H - padB} stroke={color} strokeOpacity="0.3" strokeDasharray="3 3" />
                <circle cx={p.x} cy={p.y} r="5" fill={color} stroke="var(--surface)" strokeWidth="2" />
              </>
            ) : (
              <circle cx={p.x} cy={p.y} r={points.length > 40 ? 0 : 2.5} fill={color} opacity="0.7" />
            )}
          </g>
        ))}
      </svg>
      <Tooltip tip={tip} formatValue={formatValue} />
    </div>
  );
}

/**
 * Vertical bar chart with rounded bars.
 * data: [{ label, value, highlight? }]
 */
export function BarChart({ data = [], height = 240, color = 'var(--chart-2)', highlightColor = 'var(--chart-1)', formatValue }) {
  const { tip, show, hide } = useTooltip();
  const W = 800;
  const H = height;
  const padL = 46;
  const padR = 14;
  const padT = 16;
  const padB = 30;

  const values = data.map((d) => Number(d.value) || 0);
  const rawMax = Math.max(1, ...values);
  const ticks = niceTicks(rawMax);
  const max = ticks[ticks.length - 1];

  const innerW = W - padL - padR;
  const slot = innerW / Math.max(1, data.length);
  const barW = Math.min(46, slot * 0.62);
  const labelEvery = Math.max(1, Math.ceil(data.length / 12));

  return (
    <div style={{ position: 'relative', overflow: 'hidden' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }} role="img" aria-label="Bar chart">
        {ticks.map((t) => {
          const y = padT + (1 - t / max) * (H - padT - padB);
          return (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="var(--chart-grid)" strokeWidth="1" />
              <text x={padL - 8} y={y + 3.5} textAnchor="end" fontSize="11" fill="var(--text-3)" fontFamily="var(--font-mono)">
                {compactNumber(t)}
              </text>
            </g>
          );
        })}

        {data.map((d, i) => {
          const v = Number(d.value) || 0;
          const x = padL + slot * i + (slot - barW) / 2;
          const h = Math.max(v > 0 ? 3 : 0, (v / max) * (H - padT - padB));
          const y = H - padB - h;
          const fill = d.highlight ? highlightColor : color;
          const active = tip && tip.index === i;
          return (
            <g key={i}>
              <rect
                x={padL + slot * i} y={padT} width={slot} height={H - padT - padB}
                fill="transparent"
                onMouseEnter={() => show({ index: i, xPct: ((x + barW / 2) / W) * 100, yPct: (y / H) * 100, yPx: y, label: d.label, value: v, secondary: d.secondary })}
                onMouseLeave={hide}
                onTouchStart={() => show({ index: i, xPct: ((x + barW / 2) / W) * 100, yPct: (y / H) * 100, yPx: y, label: d.label, value: v, secondary: d.secondary })}
              />
              <rect
                x={x} y={y} width={barW} height={h}
                rx={Math.min(4, barW / 2)}
                fill={fill}
                opacity={active ? 1 : 0.85}
                style={{
                  transition: 'opacity 150ms ease',
                  transformBox: 'fill-box',
                  transformOrigin: '50% 100%',
                  animation: `chartGrowY 700ms var(--ease-out) ${Math.min(i * 45, 700)}ms backwards`,
                }}
              />
              {i % labelEvery === 0 && (
                <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--text-3)">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} formatValue={formatValue} />
    </div>
  );
}

/**
 * Donut chart with legend.
 * data: [{ label, value }]
 */
export function DonutChart({ data = [], size = 168, formatValue }) {
  const palette = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];
  const total = data.reduce((s, d) => s + (Number(d.value) || 0), 0);
  const stroke = 20;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const [active, setActive] = useState(null);

  let acc = 0;
  const segments = data.slice(0, 5).map((d, i) => {
    const frac = total > 0 ? (Number(d.value) || 0) / total : 0;
    const seg = { ...d, frac, offset: acc, color: palette[i % palette.length] };
    acc += frac;
    return seg;
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-5)', flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
          {segments.map((s, i) => (
            <circle
              key={i}
              cx={size / 2} cy={size / 2} r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={active === i ? stroke + 4 : stroke}
              strokeDasharray={`${Math.max(0, s.frac * c - 3)} ${c}`}
              strokeDashoffset={-s.offset * c}
              strokeLinecap="round"
              style={{ transition: 'stroke-width 150ms ease' }}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
            />
          ))}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
          <div>
            <div className="num" style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>
              {active !== null ? `${Math.round(segments[active].frac * 100)}%` : (formatValue ? formatValue(total) : total.toLocaleString())}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)' }}>
              {active !== null ? segments[active].label : 'Total'}
            </div>
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 8, minWidth: 150, flex: 1 }}>
        {segments.map((s, i) => (
          <div
            key={i}
            className="flex-between"
            style={{ fontSize: 'var(--text-sm)', cursor: 'default', opacity: active === null || active === i ? 1 : 0.5, transition: 'opacity 150ms ease' }}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
          >
            <span className="flex gap-2" style={{ alignItems: 'center', color: 'var(--text-2)', minWidth: 0 }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color, flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
            </span>
            <span className="num" style={{ fontWeight: 650, color: 'var(--text-1)' }}>
              {formatValue ? formatValue(s.value) : s.value.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Hour-of-day activity heat strip (24 cells).
 * values: number[24]
 */
export function HourHeatStrip({ values = [], peakStart = null, peakEnd = null, formatValue }) {
  const { tip, show, hide } = useTooltip();
  const max = Math.max(1, ...values);

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(24, 1fr)', gap: 3 }}>
        {values.map((v, h) => {
          const intensity = v / max;
          const inPeak = peakStart !== null && h >= peakStart && h <= peakEnd;
          return (
            <div
              key={h}
              onMouseEnter={() => show({ xPct: (h / 24) * 100, yPx: 0, label: `${h % 12 || 12}${h >= 12 ? 'PM' : 'AM'}`, value: v })}
              onMouseLeave={hide}
              onTouchStart={() => show({ xPct: (h / 24) * 100, yPx: 0, label: `${h % 12 || 12}${h >= 12 ? 'PM' : 'AM'}`, value: v })}
              style={{
                height: 34,
                borderRadius: 4,
                background: intensity === 0
                  ? 'var(--surface-3)'
                  : `color-mix(in srgb, var(--chart-1) ${Math.round(15 + intensity * 85)}%, var(--surface-3))`,
                outline: inPeak ? '2px solid var(--accent)' : 'none',
                outlineOffset: 1,
                transition: 'transform 150ms ease',
                cursor: 'default',
                animation: `chartFade 500ms ease ${h * 22}ms backwards`,
              }}
            />
          );
        })}
      </div>
      <div className="flex-between" style={{ marginTop: 6, fontSize: 'var(--text-xs)', color: 'var(--text-3)' }}>
        <span>12AM</span><span>6AM</span><span>12PM</span><span>6PM</span><span>11PM</span>
      </div>
      <Tooltip tip={tip} formatValue={formatValue} />
    </div>
  );
}

/**
 * Horizontal ranked bars (product performance).
 * data: [{ label, value, secondary? }]
 */
export function RankedBars({ data = [], color = 'var(--chart-1)', formatValue, maxItems = 6 }) {
  const items = data.slice(0, maxItems);
  const max = Math.max(1, ...items.map((d) => Number(d.value) || 0));

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {items.map((d, i) => (
        <div key={i}>
          <div className="flex-between" style={{ marginBottom: 4, fontSize: 'var(--text-sm)' }}>
            <span style={{ color: 'var(--text-2)', fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
              {d.label}
            </span>
            <span className="num" style={{ color: 'var(--text-1)', fontWeight: 650, flexShrink: 0 }}>
              {formatValue ? formatValue(d.value) : d.value.toLocaleString()}
              {d.secondary ? <span style={{ color: 'var(--text-3)', fontWeight: 450 }}> · {d.secondary}</span> : null}
            </span>
          </div>
          <div style={{ height: 8, borderRadius: 99, background: 'var(--surface-3)', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${Math.max(2, ((Number(d.value) || 0) / max) * 100)}%`,
                borderRadius: 99,
                background: i === 0 ? 'var(--brand-grad)' : color,
                opacity: i === 0 ? 1 : Math.max(0.35, 1 - i * 0.13),
                transition: 'width 900ms var(--ease-out)',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
