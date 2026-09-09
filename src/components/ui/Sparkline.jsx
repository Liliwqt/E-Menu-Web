import { useId } from 'react';

/**
 * Compact gradient area sparkline. Pure SVG, no dependencies.
 */
export default function Sparkline({
  data = [],
  width = 120,
  height = 36,
  color = 'var(--chart-1)',
  strokeWidth = 2,
  fluid = false,
}) {
  const gradId = useId();
  if (!data || data.length < 2) {
    return <svg width={fluid ? '100%' : width} height={height} aria-hidden="true" />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = strokeWidth + 1;

  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (v - min) / range) * (height - pad * 2);
    return [x, y];
  });

  // Smooth path via Catmull-Rom → Bézier
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
  }

  const area = `${d} L ${points[points.length - 1][0]} ${height} L ${points[0][0]} ${height} Z`;

  return (
    <svg
      width={fluid ? '100%' : width}
      height={fluid ? undefined : height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ display: 'block', overflow: 'visible', height: fluid ? height : undefined }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path d={d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <circle cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r={strokeWidth + 0.5} fill={color} />
    </svg>
  );
}
