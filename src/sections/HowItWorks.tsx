import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useGSAP } from '@gsap/react';
import { Check, SectionHead } from '../components/primitives';
import { useI18n } from '../i18n';
import { gsap, prefersReducedMotion } from '../lib/scroll';
import { cx, pad, roundedPath, vars } from '../lib/util';
import './how.css';

// Flowchart vocabulary: terminator, decision, input/output.
const SHAPES = [
  <rect key="a" x="3" y="23" width="90" height="50" rx="25" />,
  <path key="b" d="M48 3 93 48 48 93 3 48Z" />,
  <path key="c" d="M22 22H93L74 74H3Z" />,
];

export function HowItWorks() {
  const { t, lang } = useI18n();
  const h = t.how;
  const flow = useRef<HTMLDivElement>(null);
  const badges = useRef<Array<HTMLDivElement | null>>([]);
  const live = useRef<SVGPathElement>(null);
  const stops = useRef([0, 0, 0]);
  const [wire, setWire] = useState({ d: '', w: 0, h: 0 });
  const [reached, setReached] = useState(() => (prefersReducedMotion() ? 3 : 0));

  // Route one wire through the three badges, wherever the layout puts them.
  useLayoutEffect(() => {
    const el = flow.current!;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const b = badges.current.flatMap((node) => {
        if (!node) return [];
        const br = node.getBoundingClientRect();
        return [{ cx: Math.round(br.left - r.left + br.width / 2), top: br.top - r.top, bottom: br.bottom - r.top }];
      });
      if (b.length < 3) return;
      const pts = [{ x: b[0].cx, y: 0 }];
      const marks: number[] = [];
      b.forEach((cur, i) => {
        marks.push(pts.length);
        pts.push({ x: cur.cx, y: cur.top }, { x: cur.cx, y: cur.bottom });
        const next = b[i + 1];
        if (next && Math.abs(next.cx - cur.cx) > 2) {
          const turn = next.top - 48;
          pts.push({ x: cur.cx, y: turn }, { x: next.cx, y: turn });
        }
      });
      pts.push({ x: b[2].cx, y: r.height });

      const cum = [0];
      for (let i = 1; i < pts.length; i++) {
        cum.push(cum[i - 1] + Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y));
      }
      stops.current = marks.map((m) => cum[m] / cum[cum.length - 1]);
      setWire({ d: roundedPath(pts, 20), w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [lang]);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      const proxy = { p: 0 };
      gsap.to(proxy, {
        p: 1,
        ease: 'none',
        scrollTrigger: { trigger: flow.current, start: 'top 70%', end: 'bottom 68%', scrub: 0.6 },
        onUpdate: () => {
          if (live.current) live.current.style.strokeDashoffset = String(1 - proxy.p);
          const n = stops.current.filter((s) => proxy.p >= s - 0.003).length;
          setReached((prev) => (prev === n ? prev : n));
        },
      });
    },
    { scope: flow },
  );

  const m = h.mock;
  const mocks: ReactNode[] = [
    <div className="mock mock--dl" key="dl">
      <div className="mock__row mono">
        <span>AlgoSolver-Setup-2.0.exe</span>
        <span>{m.size}</span>
      </div>
      <div className="mock__bar">
        <i />
      </div>
      <span className="mock__done mono">
        <Check /> {m.downloaded}
      </span>
    </div>,
    <div className="mock mock--key" key="key">
      <span className="mono mock__label">{m.key}</span>
      <div className="mock__field mono">
        <span>ALGO-7F3K-Q2M9-X1BD</span>
      </div>
      <span className="mock__stamp mono">{m.activated}</span>
    </div>,
    <div className="mock mock--ready" key="ready">
      {m.ready.map((item, i) => (
        <span key={item} className="mock__chip mono" style={vars({ '--i': i })}>
          <Check /> {item}
        </span>
      ))}
    </div>,
  ];

  return (
    <section id="how" className="section how" data-theme="paper" data-section>
      <SectionHead index="05" eyebrow={h.eyebrow} title={h.title} />

      <div ref={flow} className="how__flow">
        <svg className="how__wire" width={wire.w} height={wire.h} viewBox={`0 0 ${wire.w} ${wire.h}`} aria-hidden="true">
          <path className="how__ghost" d={wire.d} />
          <path
            ref={live}
            className="how__live"
            d={wire.d}
            pathLength={1}
            style={prefersReducedMotion() ? { strokeDashoffset: 0 } : undefined}
          />
        </svg>

        <ol className="how__steps">
          {h.steps.map((step, i) => (
            <li key={i} className={cx('step', reached > i && 'is-active')}>
              <div
                className="step__badge"
                ref={(node) => {
                  badges.current[i] = node;
                }}
              >
                <svg viewBox="0 0 96 96" aria-hidden="true">
                  {SHAPES[i]}
                </svg>
                <span className="display">{i + 1}</span>
              </div>
              <div className="step__body">
                <span className="mono step__kicker">
                  {h.step} {pad(i + 1)}
                </span>
                <h3 className="step__title display">{step.title}</h3>
                <p className="step__desc">{step.desc}</p>
                {mocks[i]}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
