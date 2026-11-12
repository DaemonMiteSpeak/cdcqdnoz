import { useEffect, useRef, useState } from 'react';
import { SectionHead } from '../../components/primitives';
import { useI18n } from '../../i18n';
import { cx, pad } from '../../lib/util';
import { GLYPHS } from './glyphs';
import './features.css';

export function Features() {
  const { t } = useI18n();
  const f = t.features;
  const list = useRef<HTMLOListElement>(null);
  const [active, setActive] = useState(0);

  // The feature whose title sits closest to the reading line owns the stage.
  useEffect(() => {
    let raf = 0;
    const narrow = window.matchMedia('(max-width: 900px)');
    const update = () => {
      raf = 0;
      const el = list.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return;
      const focus = window.innerHeight * (narrow.matches ? 0.64 : 0.5);
      let best = 0;
      let bestDist = Infinity;
      Array.from(el.children).forEach((li, i) => {
        const b = (li.firstElementChild as HTMLElement).getBoundingClientRect();
        const dist = Math.abs((b.top + b.bottom) / 2 - focus);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      });
      setActive(best);
    };
    const request = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', request, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', request);
    };
  }, []);

  return (
    <section id="features" className="section features" data-theme="paper" data-section>
      <SectionHead index="03" eyebrow={f.eyebrow} title={f.title} lede={f.lede} />

      <div className="features__grid">
        <ol ref={list} className="features__list">
          {f.items.map((item, i) => (
            <li key={i} className={cx('feat', active === i && 'is-active')} onMouseEnter={() => setActive(i)}>
              <div className="feat__head">
                <span className="feat__idx mono">F/{pad(i + 1)}</span>
                <h3 className="feat__name display">{item.name}</h3>
              </div>
              <div className="feat__body">
                <div>
                  <p>{item.desc}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>

        <div className="features__stage" aria-hidden="true">
          <div className="stage" data-theme="ink">
            <div className="stage__top mono">
              <span>
                {f.fig} {pad(active + 1)} / 06
              </span>
              <span className="stage__cap" key={active}>
                {f.items[active].cap}
              </span>
            </div>
            <div className="stage__canvas">
              {GLYPHS.map((Glyph, i) => (
                <div key={i} className={cx('glyph', `glyph--${i}`, active === i && 'is-active')}>
                  <Glyph />
                </div>
              ))}
            </div>
            <div className="stage__ticks">
              {f.items.map((_, i) => (
                <i key={i} className={active === i ? 'is-on' : undefined} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
