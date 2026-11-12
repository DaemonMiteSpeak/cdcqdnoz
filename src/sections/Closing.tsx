import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { Logo, Reveal, SectionHead, SplitWords } from '../components/primitives';
import { LINKS } from '../config';
import { useI18n } from '../i18n';
import { fitLines } from '../lib/hooks';
import { gsap, prefersReducedMotion } from '../lib/scroll';
import { clamp, cx, pad, vars } from '../lib/util';
import './closing.css';

/* ------------------------------------ FAQ ------------------------------------ */

export function Faq() {
  const { t } = useI18n();
  const f = t.faq;
  const [open, setOpen] = useState(0);

  return (
    <section id="faq" className="section faq" data-theme="paper" data-section>
      <SectionHead index="07" eyebrow={f.eyebrow} title={f.title} />
      <div className="faq__grid">
        <Reveal className="faq__side">
          <p>{f.lede}</p>
          <Button href={LINKS.telegram} target="_blank" rel="noreferrer" variant="ghost">
            {f.contact}
          </Button>
          <span className="mono faq__handle">@algosolver_bot</span>
        </Reveal>

        <ul className="faq__list">
          {f.items.map((item, i) => {
            const isOpen = open === i;
            return (
              <li key={i} className={cx('qa', isOpen && 'is-open')}>
                <h3>
                  <button
                    type="button"
                    id={`faq-q-${i}`}
                    aria-expanded={isOpen}
                    aria-controls={`faq-a-${i}`}
                    onClick={() => setOpen(isOpen ? -1 : i)}
                  >
                    <span className="mono qa__idx">Q{pad(i + 1)}</span>
                    <span className="qa__q">{item.q}</span>
                    <span className="qa__icon" aria-hidden="true">
                      <i />
                      <i />
                    </span>
                  </button>
                </h3>
                <div id={`faq-a-${i}`} role="region" aria-labelledby={`faq-q-${i}`} className="qa__a" inert={!isOpen}>
                  <div>
                    <p>{item.a}</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/* --------------------------------- Final CTA --------------------------------- */

/**
 * The hero's rigid grid returns here and comes loose: scroll raises the warp,
 * the pointer pushes the mesh aside.
 */
function useWarpGrid(root: React.RefObject<HTMLElement | null>, canvas: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const el = root.current!;
    const cv = canvas.current!;
    const ctx = cv.getContext('2d')!;
    const reduced = prefersReducedMotion();
    const state = { warp: reduced ? 0.55 : 0 };
    const mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999 };
    let w = 0;
    let h = 0;
    let gap = 36;
    let cols = 0;
    let rows = 0;
    let px = new Float32Array(0);
    let py = new Float32Array(0);
    let raf = 0;
    let running = false;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = el.clientWidth;
      h = el.clientHeight;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      gap = clamp(w / 34, 26, 46);
      cols = Math.ceil(w / gap) + 3;
      rows = Math.ceil(h / gap) + 3;
      px = new Float32Array(cols * rows);
      py = new Float32Array(cols * rows);
      if (!running) draw(performance.now());
    };

    const draw = (now: number) => {
      const time = reduced ? 0 : now / 1000;
      mouse.x += (mouse.tx - mouse.x) * 0.14;
      mouse.y += (mouse.ty - mouse.y) * 0.14;
      const amp = state.warp * gap * 1.15;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x0 = (c - 1) * gap;
          const y0 = (r - 1) * gap;
          let x = x0 + Math.sin(y0 * 0.011 + time * 0.7 + x0 * 0.004) * amp;
          let y = y0 + Math.cos(x0 * 0.009 + time * 0.55 + y0 * 0.005) * amp * 1.25;
          const dx = x - mouse.x;
          const dy = y - mouse.y;
          const d2 = dx * dx + dy * dy;
          const push = Math.exp(-d2 / 42000) * 46;
          const d = Math.sqrt(d2) || 1;
          x += (dx / d) * push;
          y += (dy / d) * push;
          px[r * cols + c] = x;
          py[r * cols + c] = y;
        }
      }
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(236,232,223,.12)';
      ctx.beginPath();
      for (let r = 0; r < rows; r++) {
        ctx.moveTo(px[r * cols], py[r * cols]);
        for (let c = 1; c < cols; c++) ctx.lineTo(px[r * cols + c], py[r * cols + c]);
      }
      for (let c = 0; c < cols; c++) {
        ctx.moveTo(px[c], py[c]);
        for (let r = 1; r < rows; r++) ctx.lineTo(px[r * cols + c], py[r * cols + c]);
      }
      ctx.stroke();

      // One thread of the mesh carries the brand colour through the section.
      const mid = Math.round(rows * 0.62);
      ctx.strokeStyle = '#ff4a1c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px[mid * cols], py[mid * cols]);
      for (let c = 1; c < cols; c++) ctx.lineTo(px[mid * cols + c], py[mid * cols + c]);
      ctx.stroke();

      ctx.fillStyle = 'rgba(236,232,223,.4)';
      for (let i = 0; i < px.length; i++) ctx.fillRect(px[i] - 1, py[i] - 1, 2, 2);
    };

    const frame = (now: number) => {
      if (!running) return;
      draw(now);
      raf = requestAnimationFrame(frame);
    };

    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      mouse.tx = e.clientX - r.left;
      mouse.ty = e.clientY - r.top;
      if (mouse.x < -999) {
        mouse.x = mouse.tx;
        mouse.y = mouse.ty;
      }
    };
    const onLeave = () => {
      mouse.tx = mouse.x = -9999;
      mouse.ty = mouse.y = -9999;
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);

    const ro = new ResizeObserver(resize);
    ro.observe(el);
    const io = new IntersectionObserver(([entry]) => {
      running = entry.isIntersecting && !reduced;
      cancelAnimationFrame(raf);
      if (running) raf = requestAnimationFrame(frame);
    });
    io.observe(el);

    const gctx = gsap.context(() => {
      if (reduced) return;
      gsap.to(state, {
        warp: 1,
        ease: 'none',
        scrollTrigger: { trigger: el, start: 'top 90%', end: 'top 0%', scrub: true },
      });
      // "Beyond" physically widens as the section arrives.
      gsap.fromTo(
        el,
        { '--bw': 25 },
        { '--bw': 112, ease: 'none', scrollTrigger: { trigger: el, start: 'top 75%', end: 'top 8%', scrub: 0.5 } },
      );
    }, el);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      gctx.revert();
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [root, canvas]);
}

export function FinalCta() {
  const { t, lang } = useI18n();
  const c = t.cta;
  const root = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  useWarpGrid(root, canvas);

  useLayoutEffect(() => {
    const el = title.current!;
    const fit = () => {
      // Measure with the accent line at its widest so the scrubbed expansion never overflows.
      const accent = el.querySelector<HTMLElement>('.is-accent');
      accent?.style.setProperty('--wdth', '112');
      fitLines(el, '.cta__line', 'min(27vw, 27svh)', 0.98);
      accent?.style.removeProperty('--wdth');
    };
    fit();
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth;
        fit();
      }
    });
    ro.observe(el);
    document.fonts.ready.then(fit);
    return () => ro.disconnect();
  }, [lang]);

  return (
    <section ref={root} id="get" className="cta" data-theme="ink" data-section>
      <canvas ref={canvas} className="cta__canvas" aria-hidden="true" />
      <div className="cta__inner">
        <p className="mono cta__eyebrow">
          <span>§ 08</span>
          <span>{c.eyebrow}</span>
        </p>
        <h2 ref={title} className="cta__title display" aria-label={c.lines.join(' ')}>
          {c.lines.map((line, i) => (
            <span key={i} className="cta__line" aria-hidden="true">
              <span className={cx('cta__line-i', i === 1 && 'is-accent')}>
                <SplitWords text={line} offset={i * 2} />
              </span>
            </span>
          ))}
        </h2>
        <Reveal className="cta__action" delay={250}>
          <Button href={LINKS.installer} variant="signal" size="xl" icon="down" magnetic>
            {c.button}
          </Button>
          <p className="mono">{c.meta}</p>
        </Reveal>
      </div>
    </section>
  );
}

/* ----------------------------------- Footer ----------------------------------- */

const WORDMARK = 'ALGOSOLVER'.split('');

export function Footer() {
  const { t } = useI18n();
  const f = t.footer;
  const word = useRef<HTMLDivElement>(null);

  // Letters swell under the pointer; the rest stay compressed.
  useEffect(() => {
    const el = word.current!;
    const letters = Array.from(el.children) as HTMLElement[];
    const fit = () => {
      el.style.fontSize = '100px';
      const natural = letters.reduce((sum, l) => sum + l.getBoundingClientRect().width, 0);
      if (natural) el.style.fontSize = `${((el.clientWidth * 0.66) / natural) * 100}px`;
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const r = el.getBoundingClientRect();
      const m = (e.clientX - r.left) / r.width;
      el.classList.add('is-live');
      letters.forEach((letter, i) => {
        const pull = Math.max(0, 1 - Math.abs(m - (i + 0.5) / letters.length) / 0.22);
        const eased = pull * pull * (3 - 2 * pull);
        letter.style.fontVariationSettings = `'wdth' ${(25 + eased * 100).toFixed(1)}, 'wght' ${(620 + eased * 300).toFixed(0)}, 'opsz' 144`;
      });
    };
    const onLeave = () => {
      el.classList.remove('is-live');
      letters.forEach((letter) => (letter.style.fontVariationSettings = ''));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    document.fonts.ready.then(fit);
    const host = el.parentElement!;
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    return () => {
      ro.disconnect();
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  const nav = [
    { label: t.nav.features, href: '#features' },
    { label: t.nav.courses, href: '#courses' },
    { label: t.nav.pricing, href: '#pricing' },
    { label: t.nav.faq, href: '#faq' },
  ];
  const legal = [
    { label: f.terms, href: LINKS.terms },
    { label: f.privacy, href: LINKS.privacy },
    { label: f.refund, href: LINKS.refund },
  ];

  return (
    <footer className="footer" data-theme="signal" data-section>
      <div className="footer__top">
        <div className="footer__lead">
          <a className="footer__brand" href="#top">
            <Logo mono /> AlgoSolver
          </a>
          <p>{f.tagline}</p>
          <Button href={LINKS.installer} size="lg" icon="down">
            {f.download}
          </Button>
        </div>

        <nav aria-label={f.nav}>
          <h2 className="mono footer__h">{f.nav}</h2>
          <ul>
            {nav.map((link) => (
              <li key={link.href}>
                <a className="hlink" href={link.href}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div>
          <h2 className="mono footer__h">{f.legal}</h2>
          <ul>
            {legal.map((link) => (
              <li key={link.label}>
                <a className="hlink" href={link.href}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="mono footer__h">{f.contact}</h2>
          <ul>
            <li>
              <a className="hlink" href={LINKS.telegram} target="_blank" rel="noreferrer">
                {f.telegram} ↗
              </a>
            </li>
            <li>
              <a className="hlink" href={LINKS.telegram} target="_blank" rel="noreferrer">
                @algosolver_bot
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div ref={word} className="fword" aria-hidden="true">
        {WORDMARK.map((letter, i) => (
          <span key={i} style={vars({ '--i': i })}>
            {letter}
          </span>
        ))}
      </div>

      <div className="footer__base mono">
        <span>{f.rights}</span>
        <span className="footer__built">{f.built}</span>
        <a className="hlink" href="#top">
          {f.top} ↑
        </a>
      </div>
    </footer>
  );
}
