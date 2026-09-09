import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

/**
 * Trend chip: arrow + % change vs a labeled comparison basis.
 * delta: { pct, direction, available } (see executiveMetrics.getDelta)
 */
export default function StatDelta({ delta, label, invert = false }) {
  if (!delta) return null;

  if (!delta.available) {
    return <span className="pill pill--neutral">No {label || 'comparison'} data</span>;
  }

  const dir = delta.direction;
  const good = invert ? dir === 'down' : dir === 'up';
  const cls = dir === 'flat' ? 'pill--neutral' : good ? 'pill--success' : 'pill--danger';
  const Icon = dir === 'up' ? TrendingUp : dir === 'down' ? TrendingDown : Minus;
  const pct = delta.pct === null ? '—' : `${delta.pct > 0 ? '+' : ''}${delta.pct.toFixed(1)}%`;

  return (
    <span className={`pill ${cls}`} title={label ? `Compared to ${label}` : undefined}>
      <Icon size={12} strokeWidth={2.5} />
      <span className="num">{pct}</span>
      {label ? <span style={{ fontWeight: 500, opacity: 0.8 }}>{label}</span> : null}
    </span>
  );
}
