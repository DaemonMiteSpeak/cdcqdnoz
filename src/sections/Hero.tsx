import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { useI18n } from '../i18n';
import { fitLines } from '../lib/hooks';
import { prefersReducedMotion } from '../lib/scroll';
import { cx, pad, vars } from '../lib/util';
import { PathField, type Rect } from './pathField';
import './hero.css';

// Roboto Flex vertical metrics (em) and the padding of the word masks in hero.css.
const ASCENT = 0.928;
const DESCENT = 0.244;
const CAP_HEIGHT = 0.711;
const MASK_TOP = 0.14;
const MASK_BOTTOM = 0.06;
const COMPACT = '(max-width: 760px)';

export function Hero({ ready }: { ready: boolean }) {
  const { t, lang } = useI18n();
  const root = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const visited = useRef<HTMLElement>(null);
  const steps = useRef<HTMLElement>(null);
  const turns = useRef<HTMLElement>(null);
  const field = useRef<PathField | null>(null);
  const sync = useRef(() => {});
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT).matches);
  const lines = compact ? t.hero.linesMobile : t.hero.lines;

  const labels = {
    start: t.hero.start.toLocaleUpperCase(lang),
    target: t.hero.target.toLocaleUpperCase(lang),
    steps: t.hero.hud.steps.toLocaleUpperCase(lang),
  };
  const labelsRef = useRef(labels);
  labelsRef.current = labels;

  useEffect(() => {
    const mq = window.matchMedia(COMPACT);
    const onChange = () => setCompact(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const el = root.current!;
    const f = new PathField(canvas.current!, prefersReducedMotion(), (s) => {
      if (visited.current) visited.current.textContent = pad(s.visited, 4);
      if (steps.current) steps.current.textContent = pad(s.steps, 3);
      if (turns.current) turns.current.textContent = pad(s.turns, 3);
      hud.current?.classList.toggle('is-blocked', !s.reachable);
    });
    f.debug = new URLSearchParams(location.search).has('grid');
    f.labels = labelsRef.current;
    field.current = f;

    // Fit the headline, then hand every `[data-wall]` box to the grid as an obstacle.
    sync.current = () => {
      const h1 = title.current!;
      fitLines(h1, '.hero__line', 'var(--hero-cap)');
      const rr = el.getBoundingClientRect();
      const cs = getComputedStyle(h1);
      const fs = parseFloat(cs.fontSize);
      // Where the capitals sit inside a word's mask box, derived from the font's vertical metrics.
      const lh = parseFloat(cs.lineHeight) / fs || 0.9;
      const baseline = (lh - (ASCENT + DESCENT)) / 2 + ASCENT;
      const capTop = MASK_TOP + baseline - CAP_HEIGHT;
      const capBottom = lh + MASK_BOTTOM - baseline;
      const rects: Rect[] = [];
      el.querySelectorAll<HTMLElement>('[data-wall]').forEach((node) => {
        const r = node.getBoundingClientRect();
        if (!r.width) return;
        if (node.dataset.wall === 'text') {
          rects.push({
            x: r.left - rr.left,
            y: r.top - rr.top + fs * capTop + 1,
            w: r.width,
            h: r.height - fs * (capTop + capBottom) - 2,
          });
        } else {
          rects.push({ x: r.left - rr.left - 8, y: r.top - rr.top - 8, w: r.width + 16, h: r.height + 16 });
        }
      });
      const navH = parseFloat(getComputedStyle(el).getPropertyValue('--nav-px')) || 68;
      rects.push({ x: 0, y: 0, w: rr.width, h: navH });
      const a = anchor.current!.getBoundingClientRect();
      f.layout(rr.width, rr.height, rects, { x: a.left - rr.left, y: a.top - rr.top });
    };

    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    let painting: 'add' | 'erase' | null = null;
    let tap: { x: number; y: number } | null = null;
    const interactive = (e: Event) => !!(e.target as Element).closest('a, button');

    const onDown = (e: PointerEvent) => {
      if (interactive(e)) return;
      if (e.pointerType === 'touch') {
        tap = { x: e.clientX, y: e.clientY };
        return;
      }
      if (e.button !== 0) return;
      const p = local(e);
      painting = f.paint(p.x, p.y, 'toggle');
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const p = local(e);
      f.setPointer(p.x, p.y);
      if (painting) f.paint(p.x, p.y, painting);
    };
    const onUp = (e: PointerEvent) => {
      painting = null;
      if (e.pointerType === 'touch' && tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 10) {
        const p = local(e);
        f.paint(p.x, p.y, 'toggle');
        f.setPointer(p.x, p.y);
      }
      tap = null;
    };
    const onLeave = () => f.clearPointer();
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'r' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (el.getBoundingClientRect().bottom > 0) f.resetWalls();
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);

    const ro = new ResizeObserver(() => sync.current());
    ro.observe(el);
    const io = new IntersectionObserver(([entry]) => (entry.isIntersecting ? f.startLoop() : f.stopLoop()));
    io.observe(el);
    document.fonts.ready.then(() => sync.current());

    return () => {
      ro.disconnect();
      io.disconnect();
      f.stopLoop();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useLayoutEffect(() => {
    if (field.current) field.current.labels = labelsRef.current;
    sync.current();
  }, [lang, compact]);

  // The intro slides the UI blocks into place; re-measure the walls once they have landed.
  useEffect(() => {
    if (!ready) return;
    const id = window.setTimeout(() => sync.current(), 1900);
    return () => clearTimeout(id);
  }, [ready]);

  let wordIndex = 0;
  const lastLine = lines.length - 1;

  return (
    <section ref={root} id="top" className={cx('hero', ready && 'is-ready')} data-theme="paper" data-section>
      <canvas ref={canvas} className="hero__canvas" aria-hidden="true" />

      <div className="hero__top">
        <p className="hero__tag mono" data-wall="box">
          <span>{t.hero.tag}</span>
          <span className="hero__aud">{t.hero.audience}</span>
        </p>
        <div ref={hud} className="hero__hud mono" data-wall="box" aria-hidden="true">
          <span className="hero__hud-title">
            <i /> {t.hero.hud.title}
          </span>
          <span className="hero__hud-row">
            {t.hero.hud.visited} <b ref={visited}>0000</b> {t.hero.hud.cells}
          </span>
          <span className="hero__hud-row">
            {t.hero.hud.path} <b ref={steps}>000</b> {t.hero.hud.steps}
          </span>
          <span className="hero__hud-row">
            {t.hero.hud.turns} <b ref={turns}>000</b>
          </span>
          <span className="hero__hud-alert">{t.hero.hud.noRoute}</span>
        </div>
      </div>

      <h1 ref={title} className="hero__title display" aria-label={`AlgoSolver — ${t.hero.lines.join(' ')}`}>
        {lines.map((line, li) => {
          const words = line.split(' ');
          return (
            <span className="hero__line" key={li} aria-hidden="true">
              <span className="hero__line-i">
                {words.map((word, wi) => {
                  const accent = li === lastLine && wi === words.length - 1;
                  return (
                    <span key={wi}>
                      <span className={cx('hero__w', accent && 'hero__w--accent')} data-wall="text">
                        <span className="hero__wi" style={vars({ '--i': wordIndex++ })}>
                          {word}
                        </span>
                      </span>
                      {wi < words.length - 1 ? ' ' : ''}
                    </span>
                  );
                })}
              </span>
            </span>
          );
        })}
        <span ref={anchor} className="hero__anchor" aria-hidden="true" />
      </h1>

      <div className="hero__bottom">
        <div className="hero__intro">
          <p className="hero__sub" data-wall="box">
            {t.hero.sub}
          </p>
          <div className="hero__cta" data-wall="box">
            <Button href="#showcase" size="lg" icon="down" magnetic>
              {t.hero.cta1}
            </Button>
            <Button href="#pricing" size="lg" variant="ghost" magnetic>
              {t.hero.cta2}
            </Button>
          </div>
        </div>
        <p className="hero__hint mono" data-wall="box" aria-hidden="true">
          <span className="hero__hint-mouse">{t.hero.hintMouse}</span>
          <span className="hero__hint-touch">{t.hero.hintTouch}</span>
        </p>
      </div>
    </section>
  );
}
