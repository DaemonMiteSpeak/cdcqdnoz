import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useGSAP } from '@gsap/react';
import { useInView } from '../lib/hooks';
import { gsap, prefersReducedMotion } from '../lib/scroll';
import { cx, mulberry32, vars } from '../lib/util';

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M4.5 28 16 4.5 27.5 28" stroke="currentColor" strokeWidth="3.4" strokeLinecap="square" />
      <rect x="12.6" y="18.4" width="6.8" height="6.8" fill="var(--signal)" />
    </svg>
  );
}

/** Words rise out of a mask once the block scrolls into view. */
export function SplitWords({ text, className, offset = 0 }: { text: string; className?: string; offset?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref);
  const words = text.split(' ');
  return (
    <span ref={ref} className={cx('sw', inView && 'is-in', className)}>
      {words.map((word, i) => (
        <span key={`${word}-${i}`}>
          <span className="sw__w">
            <span className="sw__i" style={vars({ '--i': i + offset })}>
              {word}
            </span>
          </span>
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </span>
  );
}

export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  return (
    <div ref={ref} className={cx('rv', inView && 'is-in', className)} style={vars({ '--rv-d': `${delay}ms` })}>
      {children}
    </div>
  );
}

export function SectionHead({
  index,
  eyebrow,
  title,
  lede,
}: {
  index: string;
  eyebrow: string;
  title: string;
  lede?: string;
}) {
  return (
    <header className="shead">
      <div className="shead__meta mono">
        <span className="shead__idx">§ {index}</span>
        <span>{eyebrow}</span>
        <span className="shead__count" aria-hidden="true">
          {index} / 08
        </span>
      </div>
      <h2 className="shead__title display">
        <SplitWords text={title} />
      </h2>
      {lede && (
        <Reveal className="shead__lede" delay={200}>
          <p>{lede}</p>
        </Reveal>
      )}
    </header>
  );
}

type DividerTheme = 'paper' | 'paper-2' | 'ink' | 'signal';

/**
 * Section boundary drawn as a bar chart that sorts itself while you scroll past:
 * shuffled columns of the next section's colour slide into ascending order.
 */
export function SortDivider({
  from,
  to,
  flip = false,
  caption,
}: {
  from: DividerTheme;
  to: DividerTheme;
  flip?: boolean;
  caption?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const count = useMemo(() => (window.innerWidth < 720 ? 14 : 30), []);
  const order = useMemo(() => {
    const rand = mulberry32(count * 7 + (flip ? 3 : 1));
    const idx = Array.from({ length: count }, (_, i) => i);
    for (let i = count - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return idx;
  }, [count, flip]);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      const bars = gsap.utils.toArray<HTMLElement>('.sortdiv__bar', ref.current);
      gsap.fromTo(
        bars,
        { xPercent: (i: number) => (order[i] - i) * 100 },
        {
          xPercent: 0,
          ease: 'power2.inOut',
          stagger: { each: 0.015, from: 'random' },
          scrollTrigger: { trigger: ref.current, start: 'top 96%', end: 'top 38%', scrub: 0.6 },
        },
      );
    },
    { scope: ref, dependencies: [order] },
  );

  return (
    <div
      ref={ref}
      className={cx('sortdiv', flip && 'sortdiv--flip')}
      data-theme={from}
      data-section
      aria-hidden="true"
      style={vars({ '--to': `var(--${to})`, '--n': count })}
    >
      {caption && <span className="sortdiv__cap mono">{caption}</span>}
      <div className="sortdiv__bars">
        {order.map((_, i) => (
          <span key={i} className="sortdiv__bar" style={{ height: `${((i + 1) / count) * 100}%` }} />
        ))}
      </div>
    </div>
  );
}

/** Opening curtain: counts to 100 while fonts settle, then lifts off the hero. */
export function Intro({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<'count' | 'out' | 'gone'>(() => (prefersReducedMotion() ? 'gone' : 'count'));
  const num = useRef<HTMLSpanElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (phase === 'gone') {
      done.current();
      return;
    }
    if (phase !== 'count') return;
    let raf = 0;
    let cancelled = false;
    const timers: number[] = [];
    const t0 = performance.now();
    const duration = 1050;
    const finish = () => {
      if (cancelled) return;
      setPhase('out');
      done.current();
      timers.push(window.setTimeout(() => !cancelled && setPhase('gone'), 1000));
    };
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      if (num.current) num.current.textContent = String(Math.round(eased * 100)).padStart(3, '0');
      if (p < 1) raf = requestAnimationFrame(tick);
      else {
        const cap = new Promise((r) => timers.push(window.setTimeout(r, 900)));
        Promise.race([document.fonts.ready, cap]).then(finish);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
    };
  }, [phase]);

  if (phase === 'gone') return null;
  return (
    <div className={cx('intro', phase === 'out' && 'is-out')} data-theme="ink" aria-hidden="true">
      <div className="intro__top mono">
        <span className="intro__brand">
          <Logo size={20} /> AlgoSolver
        </span>
        <span>v2.0</span>
      </div>
      <div className="intro__body">
        <span className="intro__label mono">compiling curiosity</span>
        <span ref={num} className="intro__num display">
          000
        </span>
      </div>
    </div>
  );
}
