import { useRef, useState, type KeyboardEvent } from 'react';
import { useGSAP } from '@gsap/react';
import { Logo, SectionHead } from '../../components/primitives';
import { useI18n } from '../../i18n';
import { useInView } from '../../lib/hooks';
import { gsap, prefersReducedMotion } from '../../lib/scroll';
import { cx, pad, vars } from '../../lib/util';
import { AlgoView, DashView, MODULES, PyView, VisionView } from './views';
import './showcase.css';

const TABS = ['dash', 'py', 'vision', 'algo'] as const;
type Tab = (typeof TABS)[number];

export function Showcase() {
  const { t } = useI18n();
  const a = t.showcase.app;
  const stage = useRef<HTMLDivElement>(null);
  const win = useRef<HTMLDivElement>(null);
  const tablist = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>('dash');
  const [mod, setMod] = useState(2);
  // The demo tours its own tabs until someone touches it.
  const [auto, setAuto] = useState(() => !prefersReducedMotion());
  const inView = useInView(stage, { once: false, margin: '-18% 0px -18% 0px' });

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap.fromTo(
        win.current,
        { rotateX: 15, scale: 0.9, y: 70, transformPerspective: 1500 },
        {
          rotateX: 0,
          scale: 1,
          y: 0,
          ease: 'none',
          scrollTrigger: { trigger: stage.current, start: 'top 98%', end: 'top 30%', scrub: 0.5 },
        },
      );
    },
    { scope: stage },
  );

  const onTabKey = (e: KeyboardEvent) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + dir + TABS.length) % TABS.length];
    setTab(next);
    tablist.current?.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
  };

  return (
    <section id="showcase" className="section showcase" data-theme="ink" data-section>
      <SectionHead index="01" eyebrow={t.showcase.eyebrow} title={t.showcase.title} lede={t.showcase.lede} />

      <div ref={stage} className="showcase__stage" style={vars({ '--play': inView ? 'running' : 'paused' })}>
        <div
          ref={win}
          className="app"
          onPointerDown={() => setAuto(false)}
          onKeyDown={() => setAuto(false)}
        >
          <div className="app__bar">
            <span className="app__title">
              <Logo size={17} /> AlgoSolver <b>v2.0</b>
            </span>
            <span className="app__chips mono">
              <span className="app__chip app__chip--live">
                <i /> {a.online}
              </span>
              <span className="app__chip app__chip--lic">
                {a.license} · {a.daysLeft}
              </span>
            </span>
            <span className="app__ctl" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </div>

          <div className="app__body">
            <aside className="app__side">
              <span className="mono app__side-h">{a.modules} 01–11</span>
              <ul>
                {MODULES.map((m, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className={cx('app__mod', mod === i && 'is-on')}
                      aria-pressed={mod === i}
                      onClick={() => {
                        setMod(i);
                        setTab('dash');
                      }}
                    >
                      <span className="mono">{pad(i + 1)}</span>
                      <span className="app__mod-name">{a.moduleNames[i]}</span>
                      <span className="app__mod-bar">
                        <i style={{ width: `${m.progress}%` }} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>

            <div className="app__main">
              <div ref={tablist} className="app__tabs" role="tablist" onKeyDown={onTabKey}>
                {TABS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    data-tab={id}
                    id={`app-tab-${id}`}
                    aria-selected={tab === id}
                    aria-controls="app-panel"
                    tabIndex={tab === id ? 0 : -1}
                    className={cx('app__tab', tab === id && 'is-on')}
                    onClick={() => setTab(id)}
                  >
                    {a.tabs[id]}
                    {tab === id && auto && (
                      <i
                        className="app__tab-timer"
                        onAnimationEnd={() => setTab(TABS[(TABS.indexOf(id) + 1) % TABS.length])}
                      />
                    )}
                  </button>
                ))}
              </div>
              <div
                id="app-panel"
                role="tabpanel"
                aria-labelledby={`app-tab-${tab}`}
                className="app__view"
                key={`${tab}-${mod}`}
              >
                {tab === 'dash' && <DashView mod={mod} />}
                {tab === 'py' && <PyView auto={auto} />}
                {tab === 'vision' && <VisionView />}
                {tab === 'algo' && <AlgoView />}
              </div>
            </div>
          </div>

          <div className="app__status mono">
            <span>{a.status}</span>
            <span>UTF-8</span>
          </div>
        </div>

        <p className={cx('showcase__hint mono', !auto && 'is-off')} aria-hidden="true">
          <i /> {t.showcase.hint}
        </p>
      </div>
    </section>
  );
}
