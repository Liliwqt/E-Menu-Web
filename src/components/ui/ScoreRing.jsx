import { useEffect, useState } from 'react';

/**
 * Animated circular score gauge (0–100).
 */
export default function ScoreRing({ score, size = 132, stroke = 10, label }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { setProgress(score || 0); return undefined; }
    const t = setTimeout(() => setProgress(score || 0), 60);
    return () => clearTimeout(t);
  }, [score]);

  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, progress));
  const offset = c - (pct / 100) * c;

  const tone = score === null || score === undefined
    ? 'var(--text-3)'
    : score >= 80 ? 'var(--success)' : score >= 60 ? 'var(--warning)' : 'var(--danger)';

  return (
    <div style={{ position: 'relative', width: size, height: size }} role="img" aria-label={`Score ${score ?? 'unavailable'} out of 100`}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1.1s var(--ease-out), stroke 0.4s ease' }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div>
          <div className="num" style={{ fontSize: size / 4.2, fontWeight: 700, color: 'var(--text-1)', fontFamily: 'var(--font-display)' }}>
            {score === null || score === undefined ? '—' : Math.round(score)}
          </div>
          {label && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)', fontWeight: 600 }}>{label}</div>}
        </div>
      </div>
    </div>
  );
}
