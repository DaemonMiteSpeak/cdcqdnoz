import type { CSSProperties } from 'react';

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

/** Typed escape hatch for CSS custom properties in `style`. */
export const vars = (v: Record<`--${string}`, string | number>) => v as CSSProperties;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Small deterministic PRNG so "random" visuals are stable between renders. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pad = (n: number, len = 2) => String(n).padStart(len, '0');

type Pt = { x: number; y: number };

/** SVG path through orthogonal waypoints with rounded corners. */
export function roundedPath(points: Pt[], radius: number) {
  if (points.length < 2) return '';
  let d = `M${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const a = points[i - 1];
    const b = points[i + 1];
    const la = Math.hypot(p.x - a.x, p.y - a.y);
    const lb = Math.hypot(b.x - p.x, b.y - p.y);
    const r = Math.min(radius, la / 2, lb / 2);
    if (r < 0.5) {
      d += ` L${p.x} ${p.y}`;
      continue;
    }
    const ax = p.x + ((a.x - p.x) / la) * r;
    const ay = p.y + ((a.y - p.y) / la) * r;
    const bx = p.x + ((b.x - p.x) / lb) * r;
    const by = p.y + ((b.y - p.y) / lb) * r;
    d += ` L${ax} ${ay} Q${p.x} ${p.y} ${bx} ${by}`;
  }
  const last = points[points.length - 1];
  return `${d} L${last.x} ${last.y}`;
}
