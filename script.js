(() => {
  'use strict';

  const root = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasObserver = 'IntersectionObserver' in window;
  const clamp = (n) => Math.min(1, Math.max(0, n));
  const smooth = (from, to, x) => {
    const k = clamp((x - from) / (to - from));
    return k * k * (3 - 2 * k);
  };

  /* Smooth scroll (Lenis). Skipped when the user prefers reduced motion. */
  let lenis = null;
  if (!reduceMotion && typeof Lenis !== 'undefined') {
    root.classList.add('lenis');
    lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true
    });
    document.querySelectorAll('a[href^="#"]').forEach((link) => {
      link.addEventListener('click', (e) => {
        const id = link.getAttribute('href');
        const target = id.length > 1 && document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        lenis.scrollTo(target, { offset: -96 });
      });
    });
  }

  /* World: the scroll position is the time of day, from morning at the top to night at the bottom */
  let worldDirty = true;
  function updateWorld() {
    const max = root.scrollHeight - window.innerHeight;
    const progress = max > 0 ? clamp(window.scrollY / max) : 0;
    root.style.setProperty('--t', progress.toFixed(4));
    root.style.setProperty('--dusk', (smooth(0.15, 0.45, progress) * (1 - smooth(0.5, 0.8, progress))).toFixed(3));
    root.style.setProperty('--night', smooth(0.55, 0.85, progress).toFixed(3));
    /* The window of the house lights up a little before dark */
    root.style.setProperty('--lamp', smooth(0.4, 0.58, progress).toFixed(3));
  }

  const markDirty = () => { worldDirty = true; };
  window.addEventListener('scroll', markDirty, { passive: true });
  window.addEventListener('resize', markDirty);

  function frame(now) {
    if (lenis) lenis.raf(now);
    if (worldDirty) {
      worldDirty = false;
      updateWorld();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* Nav: backdrop appears once the page leaves the very top */
  const navWrap = document.querySelector('.nav-wrap');
  if (navWrap && hasObserver) {
    const sentinel = document.createElement('div');
    sentinel.setAttribute('aria-hidden', 'true');
    sentinel.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:24px;pointer-events:none;';
    document.body.prepend(sentinel);
    new IntersectionObserver((entries) => {
      navWrap.classList.toggle('is-scrolled', !entries[0].isIntersecting);
    }).observe(sentinel);
  }

  /* Nav: mark the link of the section currently in view */
  const navLinks = document.querySelectorAll('.nav-links a[href^="#"]');
  if (navLinks.length && hasObserver) {
    const linkFor = {};
    navLinks.forEach((link) => { linkFor[link.getAttribute('href').slice(1)] = link; });
    const sectionObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const link = linkFor[entry.target.id];
        if (entry.isIntersecting) {
          /* Sections without a nav link just clear the marker */
          navLinks.forEach((l) => l.removeAttribute('aria-current'));
          if (link) link.setAttribute('aria-current', 'true');
        } else if (link) {
          link.removeAttribute('aria-current');
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    document.querySelectorAll('main section[id]').forEach((section) => sectionObserver.observe(section));
  }

  /* Mobile menu */
  const toggle = document.querySelector('.menu-toggle');
  const menu = document.getElementById('mobile-menu');
  if (toggle && menu) {
    const setMenu = (open) => {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
      menu.classList.toggle('is-open', open);
      if (lenis) lenis[open ? 'stop' : 'start']();
    };
    toggle.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
    menu.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setMenu(false)));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menu.classList.contains('is-open')) {
        setMenu(false);
        toggle.focus();
      }
    });
  }
})();
