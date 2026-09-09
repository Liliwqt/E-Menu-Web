import { useEffect, useRef, useState } from 'react';

/**
 * Smoothly counts from the previous value to the new value.
 * Respects prefers-reduced-motion (jumps instantly).
 */
export default function AnimatedNumber({ value, format, duration = 900 }) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef(null);

  useEffect(() => {
    const target = Number(value) || 0;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      fromRef.current = target;
      setDisplay(target);
      return undefined;
    }

    const from = fromRef.current;
    const start = performance.now();

    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (target - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = target;
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  const text = format ? format(display) : Math.round(display).toLocaleString();
  return <span className="num">{text}</span>;
}
