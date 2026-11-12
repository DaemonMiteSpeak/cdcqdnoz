import { useEffect, useRef, useState } from 'react';
import { LANGS, useI18n } from '../i18n';
import { lockScroll } from '../lib/scroll';
import { cx, pad, vars } from '../lib/util';
import { LINKS } from '../config';
import { Button } from './Button';
import { Logo } from './primitives';

const NAV = [
  { key: 'features', href: '#features' },
  { key: 'courses', href: '#courses' },
  { key: 'how', href: '#how' },
  { key: 'pricing', href: '#pricing' },
  { key: 'faq', href: '#faq' },
] as const;

function LangSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="lang" role="group" aria-label={t.nav.language} style={vars({ '--idx': LANGS.indexOf(lang) })}>
      <span className="lang__pill" aria-hidden="true" />
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          className={cx('lang__btn', code === lang && 'is-on')}
          aria-pressed={code === lang}
          lang={code}
          onClick={() => code !== lang && setLang(code)}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export function Nav() {
  const { t } = useI18n();
  const [theme, setTheme] = useState('paper');
  const [active, setActive] = useState('');
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const progress = useRef<HTMLSpanElement>(null);

  // One rAF-throttled scroll pass: nav theme, active link, progress bar.
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const probe = 34;
      let nextTheme = 'paper';
      document.querySelectorAll<HTMLElement>('[data-section]').forEach((section) => {
        const r = section.getBoundingClientRect();
        if (r.top <= probe && r.bottom > probe) nextTheme = section.dataset.theme ?? 'paper';
      });
      setTheme(nextTheme);

      const mid = window.innerHeight * 0.42;
      let current = '';
      for (const { href } of NAV) {
        const r = document.querySelector(href)?.getBoundingClientRect();
        if (r && r.top <= mid && r.bottom > mid) current = href;
      }
      setActive(current);
      setScrolled(window.scrollY > 16);

      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (progress.current) {
        progress.current.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
      }
    };
    const request = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', request);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', request);
      window.removeEventListener('resize', request);
    };
  }, []);

  useEffect(() => {
    lockScroll(open);
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const mq = window.matchMedia('(min-width: 1101px)');
    const onWide = () => mq.matches && setOpen(false);
    window.addEventListener('keydown', onKey);
    mq.addEventListener('change', onWide);
    return () => {
      window.removeEventListener('keydown', onKey);
      mq.removeEventListener('change', onWide);
    };
  }, [open]);

  const closeMenu = () => {
    lockScroll(false);
    setOpen(false);
  };

  return (
    <>
      <header className={cx('nav', scrolled && 'is-scrolled', open && 'is-open')} data-theme={open ? 'ink' : theme}>
        <a className="nav__brand" href="#top" aria-label={t.nav.home} onClick={closeMenu}>
          <Logo />
          <span>AlgoSolver</span>
        </a>

        <nav className="nav__links" aria-label="Primary">
          {NAV.map(({ key, href }) => (
            <a
              key={key}
              href={href}
              className={cx('nav__link', active === href && 'is-active')}
              aria-current={active === href ? 'true' : undefined}
            >
              {t.nav[key]}
            </a>
          ))}
        </nav>

        <div className="nav__right">
          <LangSwitch />
          <a className="nav__login" href="#how">
            {t.nav.login}
          </a>
          <Button href={LINKS.download} size="sm" icon="down" className="nav__dl">
            {t.nav.download}
          </Button>
          <button
            type="button"
            className="nav__burger"
            aria-expanded={open}
            aria-controls="site-menu"
            onClick={() => setOpen((v) => !v)}
          >
            <span className="sr-only">{open ? t.nav.close : t.nav.menu}</span>
            <i />
            <i />
          </button>
        </div>
        <span ref={progress} className="nav__progress" aria-hidden="true" />
      </header>

      <div id="site-menu" className={cx('menu', open && 'is-open')} data-theme="ink" inert={!open}>
        <nav className="menu__links" aria-label="Mobile">
          {NAV.map(({ key, href }, i) => (
            <a key={key} href={href} className="menu__link" onClick={closeMenu}>
              <span className="menu__idx mono">{pad(i + 1)}</span>
              <span className="menu__mask">
                <span className="menu__text display" style={vars({ '--i': i })}>
                  {t.nav[key]}
                </span>
              </span>
            </a>
          ))}
        </nav>
        <div className="menu__foot">
          <LangSwitch />
          <a className="menu__login mono" href="#how" onClick={closeMenu}>
            {t.nav.login}
          </a>
          <Button href={LINKS.download} variant="signal" icon="down" onClick={closeMenu}>
            {t.nav.download}
          </Button>
        </div>
      </div>
    </>
  );
}
