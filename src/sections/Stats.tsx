import { useEffect, useRef } from 'react';
import { SectionHead } from '../components/primitives';
import { STATS } from '../config';
import { formatInt, useI18n } from '../i18n';
import { useCountUp, useInView } from '../lib/hooks';
import { prefersReducedMotion } from '../lib/scroll';
import { cx, mulberry32, pad } from '../lib/util';
import './stats.css';

type Shape = (typeof STATS)[number]['shape'];

const ON = '#ff4a1c';
const OFF = 'rgba(236,232,223,.17)';

/**
 * Draws the statistic at unit scale — every dot, tick, block or spine stands for a
 * fixed amount — and fills them in order when the row scrolls into view.
 */
function UnitField({ shape, units, cols, active }: { shape: Shape; units: number; cols: number; active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const progress = useRef(0);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const rand = mulberry32(units * 3 + 1);
    const heights = Array.from({ length: units }, () => 0.38 + rand() * 0.62);

    const draw = () => {
      const w = canvas.clientWidth;
      if (!w) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cell = w / cols;
      const rows = Math.ceil(units / cols);
      const rowH = shape === 'dot' ? cell : shape === 'tick' ? 16 : shape === 'block' ? Math.min(76, cell * 1.15) : 108;
      const h = Math.ceil(rows * rowH);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const lit = Math.floor(progress.current * units + 0.001);
      ctx.font = '500 10px "Martian Mono Variable", monospace';
      ctx.textBaseline = 'bottom';
      for (let i = 0; i < units; i++) {
        const x = (i % cols) * cell;
        const y = Math.floor(i / cols) * rowH;
        ctx.fillStyle = i < lit ? ON : OFF;
        if (shape === 'dot') {
          ctx.beginPath();
          ctx.arc(x + cell / 2, y + cell / 2, Math.max(1.1, cell * 0.27), 0, Math.PI * 2);
          ctx.fill();
        } else if (shape === 'tick') {
          ctx.fillRect(x + cell / 2 - 0.75, y + 2, 1.5, rowH - 5);
        } else if (shape === 'block') {
          ctx.fillRect(x + 2, y, cell - 4, rowH);
          if (cell > 26) {
            ctx.fillStyle = i < lit ? '#0c0c0d' : 'rgba(236,232,223,.5)';
            ctx.fillText(pad(i + 1), x + 7, y + rowH - 5);
          }
        } else {
          const bh = rowH * heights[i];
          ctx.fillRect(x + 1.5, rowH - bh, Math.max(1, cell - 3), bh);
        }
      }
    };

    let raf = 0;
    if (active) {
      if (prefersReducedMotion()) progress.current = 1;
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / 2000);
        progress.current = Math.max(progress.current, 1 - Math.pow(1 - p, 3));
        draw();
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } else {
      draw();
    }
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [shape, units, cols, active]);

  return <canvas ref={ref} className={cx('unitfield', `unitfield--${shape}`)} aria-hidden="true" />;
}

function StatRow({ index }: { index: number }) {
  const { t, lang } = useI18n();
  const ref = useRef<HTMLLIElement>(null);
  const inView = useInView(ref, { margin: '0px 0px -22% 0px' });
  const stat = STATS[index];
  const copy = t.stats.items[index];
  const value = useCountUp(stat.value, inView);

  return (
    <li ref={ref} className={cx('stat', inView && 'is-in')}>
      <div className="stat__label mono">
        <span className="stat__idx">{pad(index + 1)}</span>
        <span>{copy.label}</span>
      </div>
      <p className="stat__num display" aria-label={`${formatInt(stat.value, lang)}${stat.suffix} ${copy.label}`}>
        <span aria-hidden="true">{formatInt(value, lang)}</span>
        {stat.suffix && (
          <span className="stat__plus" aria-hidden="true">
            {stat.suffix}
          </span>
        )}
      </p>
      <div className="stat__viz">
        <UnitField shape={stat.shape} units={stat.units} cols={stat.cols} active={inView} />
        <span className="mono stat__unit">{copy.unit}</span>
      </div>
    </li>
  );
}

export function Stats() {
  const { t } = useI18n();
  return (
    <section className="section stats" data-theme="ink" data-section>
      <SectionHead index="02" eyebrow={t.stats.eyebrow} title={t.stats.title} />
      <ul className="stats__list">
        {STATS.map((_, i) => (
          <StatRow key={i} index={i} />
        ))}
      </ul>
    </section>
  );
}
