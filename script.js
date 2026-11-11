(() => {
  'use strict';

  const root = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasObserver = 'IntersectionObserver' in window;
  const clamp = (n, min = 0, max = 1) => Math.min(max, Math.max(min, n));
  const smooth = (from, to, x) => {
    const k = clamp((x - from) / (to - from));
    return k * k * (3 - 2 * k);
  };
  const pad = (n) => String(n).padStart(2, '0');
  const signed = (n) => String(n).replace('-', '−');
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const $ = (selector) => document.querySelector(selector);

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
        const target = id.length > 1 && $(id);
        if (!target) return;
        e.preventDefault();
        lenis.scrollTo(target, { offset: -96 });
      });
    });
  }

  /* World: the scroll position is the time of day, and feeds the clock and coordinates */
  const hud = $('[data-hud]');
  const out = {
    fps: $('[data-fps]'),
    clock: $('[data-clock]'),
    cx: $('[data-cx]'),
    cy: $('[data-cy]'),
    cz: $('[data-cz]'),
    cps: $('[data-cps]')
  };
  let worldDirty = true;
  let pointerX = window.innerWidth / 2;
  let pointerY = window.innerHeight / 2;

  function updateWorld() {
    const max = root.scrollHeight - window.innerHeight;
    const progress = max > 0 ? clamp(window.scrollY / max) : 0;
    root.style.setProperty('--t', progress.toFixed(4));
    root.style.setProperty('--dusk', (smooth(0.15, 0.45, progress) * (1 - smooth(0.5, 0.8, progress))).toFixed(3));
    root.style.setProperty('--night', smooth(0.55, 0.85, progress).toFixed(3));
    if (hud) hud.classList.toggle('is-scrolled', window.scrollY > window.innerHeight * 0.35);

    /* 08:00 at the top of the page, midnight at the bottom */
    const minutes = Math.round(480 + progress * 960);
    out.clock.textContent = pad(Math.floor(minutes / 60) % 24) + ':' + pad(minutes % 60);

    /* Y runs from the build limit down to bedrock */
    out.cx.textContent = signed(Math.round((pointerX - window.innerWidth / 2) / 8));
    out.cy.textContent = signed(Math.round(320 - progress * 384));
    out.cz.textContent = signed(Math.round((pointerY - window.innerHeight / 2) / 8));
  }

  const markDirty = () => { worldDirty = true; };
  window.addEventListener('scroll', markDirty, { passive: true });
  window.addEventListener('resize', markDirty);
  window.addEventListener('pointermove', (e) => {
    pointerX = e.clientX;
    pointerY = e.clientY;
    worldDirty = true;
  }, { passive: true });

  /* One frame loop: smooth scroll, world updates and the real frame counter */
  let frames = 0;
  let since = performance.now();
  function frame(now) {
    if (lenis) lenis.raf(now);
    if (worldDirty) {
      worldDirty = false;
      updateWorld();
    }
    frames += 1;
    const span = now - since;
    if (span >= 500) {
      /* A long gap means the tab was in the background, not a slow frame */
      if (span < 2000) out.fps.textContent = Math.round(frames * 1000 / span);
      frames = 0;
      since = now;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* Nav: backdrop appears once the page leaves the very top */
  const navWrap = $('.nav-wrap');
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
  const toggle = $('.menu-toggle');
  const menu = $('#mobile-menu');
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

  /* HUD: widgets over the whole page, driven by the settings section */
  const settings = $('[data-settings]');
  if (!hud || !settings) return;

  const widgets = {};
  hud.querySelectorAll('[data-widget]').forEach((el) => { widgets[el.dataset.widget] = el; });
  const names = Object.keys(widgets);

  /*
   * pos values are fractions of the free space: 0 is the left/top edge, 1 the right/bottom.
   * Narrow screens have no side margins, so there the HUD starts along the bottom, over the ground.
   */
  const compact = window.matchMedia('(max-width: 1279px)').matches;
  const defaults = compact ? {
    pvp: {
      accent: '#FFD84A', scale: 100, alpha: 55, font: 'pixel',
      on: { fps: true, coords: false, clock: true, keys: false, cps: true },
      pos: { fps: [0, 1], coords: [0, 0], clock: [1, 1], keys: [1, 0], cps: [0.5, 1] }
    },
    survival: {
      accent: '#7DFFC2', scale: 100, alpha: 35, font: 'pixel',
      on: { fps: false, coords: true, clock: true, keys: false, cps: false },
      pos: { fps: [1, 0], coords: [0, 1], clock: [1, 1], keys: [0, 0], cps: [0.5, 0] }
    },
    stream: {
      accent: '#FF9C7A', scale: 115, alpha: 80, font: 'sans',
      on: { fps: true, coords: false, clock: true, keys: false, cps: true },
      pos: { fps: [1, 1], coords: [0, 0], clock: [0, 1], keys: [1, 0], cps: [0.5, 1] }
    }
  } : {
    pvp: {
      accent: '#FFD84A', scale: 100, alpha: 55, font: 'pixel',
      on: { fps: true, coords: false, clock: true, keys: true, cps: true },
      pos: { fps: [0, 0], coords: [0.5, 1], clock: [1, 0], keys: [1, 1], cps: [0, 1] }
    },
    survival: {
      accent: '#7DFFC2', scale: 100, alpha: 35, font: 'pixel',
      on: { fps: true, coords: true, clock: true, keys: false, cps: false },
      pos: { fps: [0, 0], coords: [0, 1], clock: [1, 0], keys: [1, 1], cps: [0.5, 1] }
    },
    stream: {
      accent: '#FF9C7A', scale: 120, alpha: 80, font: 'sans',
      on: { fps: true, coords: false, clock: true, keys: true, cps: true },
      pos: { fps: [1, 0], coords: [0.5, 1], clock: [0, 0], keys: [0, 1], cps: [1, 1] }
    }
  };

  /* The layout is remembered per screen class, so a phone layout never lands on a desktop */
  const storageKey = 'eternet-hud-v1-' + (compact ? 'compact' : 'wide');
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      const valid = saved && defaults[saved.active] && Object.keys(defaults).every((id) => {
        const p = saved.profiles && saved.profiles[id];
        return p && p.on && p.pos && names.every((n) => Array.isArray(p.pos[n]) && typeof p.on[n] === 'boolean');
      });
      return valid ? saved : null;
    } catch (err) {
      return null;
    }
  }
  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch (err) {
      /* Storage can be unavailable (private mode); the HUD still works for this visit */
    }
  }
  const state = load() || { active: 'pvp', touched: false, profiles: clone(defaults) };

  const profileButtons = settings.querySelectorAll('[data-profile]');
  const moduleInputs = settings.querySelectorAll('[data-module]');
  const swatches = settings.querySelectorAll('[data-accent]');
  const fontButtons = settings.querySelectorAll('[data-font]');
  const scaleInput = settings.querySelector('[data-scale]');
  const alphaInput = settings.querySelector('[data-alpha]');
  const scaleOut = settings.querySelector('[data-scale-out]');
  const alphaOut = settings.querySelector('[data-alpha-out]');
  const note = hud.querySelector('[data-note]');
  const press = (buttons, key, value) => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[key] === value)));

  let glideTimer = 0;
  function render(glide) {
    const profile = state.profiles[state.active];
    if (glide && !reduceMotion) {
      hud.classList.add('is-switching');
      clearTimeout(glideTimer);
      glideTimer = setTimeout(() => hud.classList.remove('is-switching'), 650);
    }
    names.forEach((name) => {
      const el = widgets[name];
      const [x, y] = profile.pos[name];
      el.style.setProperty('--x', x);
      el.style.setProperty('--y', y);
      el.toggleAttribute('data-low', y > 0.5);
      el.classList.toggle('is-off', !profile.on[name]);
      el.tabIndex = profile.on[name] ? 0 : -1;
    });
    root.style.setProperty('--accent', profile.accent);
    hud.style.setProperty('--hud-scale', profile.scale / 100);
    hud.style.setProperty('--hud-alpha', profile.alpha / 100);
    hud.dataset.font = profile.font;
    note.hidden = state.touched;

    press(profileButtons, 'profile', state.active);
    press(swatches, 'accent', profile.accent);
    press(fontButtons, 'font', profile.font);
    moduleInputs.forEach((input) => { input.checked = profile.on[input.dataset.module]; });
    scaleInput.value = profile.scale;
    alphaInput.value = profile.alpha;
    scaleOut.textContent = profile.scale + '%';
    alphaOut.textContent = profile.alpha + '%';
  }

  const change = (apply, glide) => {
    apply(state.profiles[state.active]);
    render(glide);
    save();
  };
  profileButtons.forEach((b) => b.addEventListener('click', () => {
    state.active = b.dataset.profile;
    render(true);
    save();
  }));
  moduleInputs.forEach((input) => input.addEventListener('change', () => change((p) => { p.on[input.dataset.module] = input.checked; })));
  swatches.forEach((b) => b.addEventListener('click', () => change((p) => { p.accent = b.dataset.accent; })));
  fontButtons.forEach((b) => b.addEventListener('click', () => change((p) => { p.font = b.dataset.font; })));
  scaleInput.addEventListener('input', () => change((p) => { p.scale = Number(scaleInput.value); }));
  alphaInput.addEventListener('input', () => change((p) => { p.alpha = Number(alphaInput.value); }));
  settings.querySelector('[data-reset]').addEventListener('click', () => {
    state.profiles[state.active] = clone(defaults[state.active]);
    render(true);
    save();
  });

  /* Dragging snaps to the centre lines, like an in-game HUD editor */
  const SNAP = 0.025;
  names.forEach((name) => {
    const el = widgets[name];
    const place = (x, y) => {
      const pos = [clamp(x), clamp(y)];
      state.profiles[state.active].pos[name] = pos;
      el.style.setProperty('--x', pos[0]);
      el.style.setProperty('--y', pos[1]);
      el.toggleAttribute('data-low', pos[1] > 0.5);
    };
    const touched = () => {
      if (state.touched) return;
      state.touched = true;
      note.hidden = true;
    };

    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const area = hud.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      const grabX = e.clientX - box.left;
      const grabY = e.clientY - box.top;
      const freeX = Math.max(1, area.width - box.width);
      const freeY = Math.max(1, area.height - box.height);
      let moved = false;
      hud.classList.remove('is-switching');
      el.setPointerCapture(e.pointerId);

      const move = (ev) => {
        if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
        if (!moved) {
          moved = true;
          touched();
          el.classList.add('is-dragging');
          hud.classList.add('is-editing');
        }
        let x = (ev.clientX - grabX - area.left) / freeX;
        let y = (ev.clientY - grabY - area.top) / freeY;
        const snapX = Math.abs(x - 0.5) < SNAP;
        const snapY = Math.abs(y - 0.5) < SNAP;
        if (snapX) x = 0.5;
        if (snapY) y = 0.5;
        hud.classList.toggle('snap-x', snapX);
        hud.classList.toggle('snap-y', snapY);
        place(x, y);
      };
      const stop = () => {
        el.classList.remove('is-dragging');
        hud.classList.remove('is-editing', 'snap-x', 'snap-y');
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', stop);
        el.removeEventListener('pointercancel', stop);
        if (moved) save();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', stop);
      el.addEventListener('pointercancel', stop);
    });

    el.addEventListener('keydown', (e) => {
      const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!step) return;
      e.preventDefault();
      const [x, y] = state.profiles[state.active].pos[name];
      place(x + step[0] * 0.04, y + step[1] * 0.04);
      touched();
      save();
    });
  });

  /* Keys light up on real presses */
  const keys = {};
  hud.querySelectorAll('[data-key]').forEach((el) => { keys[el.dataset.key] = el; });
  window.addEventListener('keydown', (e) => { if (keys[e.code]) keys[e.code].classList.add('is-down'); });
  window.addEventListener('keyup', (e) => { if (keys[e.code]) keys[e.code].classList.remove('is-down'); });
  window.addEventListener('blur', () => Object.values(keys).forEach((el) => el.classList.remove('is-down')));

  /* CPS: presses during the last second */
  let clicks = [];
  let cpsTimer = 0;
  const updateCps = () => {
    const now = performance.now();
    clicks = clicks.filter((time) => now - time < 1000);
    out.cps.textContent = clicks.length;
    if (!clicks.length) {
      clearInterval(cpsTimer);
      cpsTimer = 0;
    }
  };
  window.addEventListener('pointerdown', () => {
    clicks.push(performance.now());
    updateCps();
    if (!cpsTimer) cpsTimer = setInterval(updateCps, 100);
  }, { passive: true });

  render(false);
  hud.hidden = false;
})();
