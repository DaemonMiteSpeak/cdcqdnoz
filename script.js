(function () {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasObserver = 'IntersectionObserver' in window;
  const canObserve = hasObserver && !reduceMotion;

  /* Smooth scroll (Lenis). Skipped when the user prefers reduced motion. */
  let lenis = null;
  if (!reduceMotion && typeof Lenis !== 'undefined') {
    document.documentElement.classList.add('lenis');
    lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true
    });
    const raf = (time) => {
      lenis.raf(time);
      requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);

    document.querySelectorAll('a[href^="#"]').forEach((link) => {
      link.addEventListener('click', (e) => {
        const id = link.getAttribute('href');
        if (id.length < 2) return;
        const target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        lenis.scrollTo(target, { offset: -96 });
      });
    });
  }

  /* Scroll reveals: each block rises once, then stays visible */
  const reveals = document.querySelectorAll('.reveal');
  if (canObserve) {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.15 });
    reveals.forEach((el) => revealObserver.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('is-visible'));
  }

  /* Tagline: words activate one at a time as they cross the trigger line */
  const tagline = document.querySelector('[data-words]');
  if (tagline) {
    const words = tagline.textContent.trim().split(/\s+/);
    tagline.textContent = '';
    const spans = words.map((word, i) => {
      const span = document.createElement('span');
      span.className = 'word';
      span.textContent = word;
      tagline.appendChild(span);
      if (i < words.length - 1) tagline.appendChild(document.createTextNode(' '));
      return span;
    });
    if (canObserve) {
      const wordObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-active');
          observer.unobserve(entry.target);
        });
      }, { rootMargin: '0px 0px -45% 0px', threshold: 1 });
      spans.forEach((span) => wordObserver.observe(span));
    } else {
      spans.forEach((span) => span.classList.add('is-active'));
    }
  }

  /* Nav: glass capsule appears once the page leaves the very top */
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
    const clear = () => navLinks.forEach((l) => l.removeAttribute('aria-current'));
    const sectionObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const link = linkFor[entry.target.id];
        if (entry.isIntersecting) {
          /* Sections without a nav link (hero, steps, final CTA) just clear the marker */
          clear();
          if (link) link.setAttribute('aria-current', 'true');
        } else if (link && link.getAttribute('aria-current')) {
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

  /* Cards: a soft light follows the pointer */
  document.querySelectorAll('.card').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - rect.left) + 'px');
      card.style.setProperty('--my', (e.clientY - rect.top) + 'px');
    });
  });

  /* Studio: draggable HUD with profiles that remember their own layout */
  const studio = document.querySelector('[data-studio]');
  if (!studio) return;

  const screen = studio.querySelector('.screen');
  const layer = studio.querySelector('.hud-layer');
  const widgets = {};
  layer.querySelectorAll('[data-widget]').forEach((el) => { widgets[el.dataset.widget] = el; });

  /* pos values are fractions of the free space: 0 is the left/top edge, 1 the right/bottom */
  const defaults = {
    pvp: {
      accent: '#8CFFD9', scale: 100, alpha: 70,
      on: { fps: true, coords: true, keys: true, clock: false, compass: false },
      pos: { fps: [0, 0], coords: [0, 0.11], keys: [1, 1], clock: [1, 0], compass: [0.5, 0] }
    },
    survival: {
      accent: '#FFD37A', scale: 100, alpha: 50,
      on: { fps: false, coords: true, keys: false, clock: true, compass: true },
      pos: { fps: [0, 0.11], coords: [0, 0], keys: [0, 1], clock: [1, 0], compass: [0.5, 0] }
    },
    stream: {
      accent: '#FF9BD2', scale: 115, alpha: 85,
      on: { fps: true, coords: false, keys: true, clock: true, compass: false },
      pos: { fps: [1, 0], coords: [0, 0.14], keys: [0, 1], clock: [0, 0], compass: [0.5, 0] }
    }
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const clamp = (n) => Math.min(1, Math.max(0, n));
  const profiles = clone(defaults);
  let active = 'pvp';

  const chips = studio.querySelectorAll('[data-profile]');
  const moduleInputs = studio.querySelectorAll('[data-module]');
  const swatches = studio.querySelectorAll('[data-accent]');
  const scaleInput = studio.querySelector('[data-scale]');
  const alphaInput = studio.querySelector('[data-alpha]');
  const scaleOut = studio.querySelector('[data-scale-out]');
  const alphaOut = studio.querySelector('[data-alpha-out]');

  let switchTimer = 0;
  function render(glide) {
    const profile = profiles[active];
    if (glide && !reduceMotion) {
      screen.classList.add('is-switching');
      clearTimeout(switchTimer);
      switchTimer = setTimeout(() => screen.classList.remove('is-switching'), 750);
    }
    Object.keys(widgets).forEach((name) => {
      const el = widgets[name];
      el.style.setProperty('--x', profile.pos[name][0]);
      el.style.setProperty('--y', profile.pos[name][1]);
      el.classList.toggle('is-off', !profile.on[name]);
      el.tabIndex = profile.on[name] ? 0 : -1;
    });
    document.documentElement.style.setProperty('--accent', profile.accent);
    screen.style.setProperty('--hud-scale', profile.scale / 100);
    screen.style.setProperty('--hud-alpha', profile.alpha / 100);
    chips.forEach((chip) => chip.setAttribute('aria-pressed', String(chip.dataset.profile === active)));
    moduleInputs.forEach((input) => { input.checked = profile.on[input.dataset.module]; });
    swatches.forEach((swatch) => swatch.setAttribute('aria-pressed', String(swatch.dataset.accent === profile.accent)));
    scaleInput.value = profile.scale;
    alphaInput.value = profile.alpha;
    scaleOut.textContent = profile.scale + '%';
    alphaOut.textContent = profile.alpha + '%';
  }

  chips.forEach((chip) => chip.addEventListener('click', () => {
    active = chip.dataset.profile;
    render(true);
  }));
  moduleInputs.forEach((input) => input.addEventListener('change', () => {
    profiles[active].on[input.dataset.module] = input.checked;
    render(false);
  }));
  swatches.forEach((swatch) => swatch.addEventListener('click', () => {
    profiles[active].accent = swatch.dataset.accent;
    render(false);
  }));
  scaleInput.addEventListener('input', () => {
    profiles[active].scale = Number(scaleInput.value);
    render(false);
  });
  alphaInput.addEventListener('input', () => {
    profiles[active].alpha = Number(alphaInput.value);
    render(false);
  });
  studio.querySelector('[data-reset]').addEventListener('click', () => {
    profiles[active] = clone(defaults[active]);
    render(true);
  });

  Object.keys(widgets).forEach((name) => {
    const el = widgets[name];
    const place = (x, y) => {
      profiles[active].pos[name] = [clamp(x), clamp(y)];
      el.style.setProperty('--x', profiles[active].pos[name][0]);
      el.style.setProperty('--y', profiles[active].pos[name][1]);
    };

    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const area = layer.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      const grabX = e.clientX - box.left;
      const grabY = e.clientY - box.top;
      const freeX = Math.max(1, area.width - box.width);
      const freeY = Math.max(1, area.height - box.height);
      screen.classList.remove('is-switching');
      el.classList.add('is-dragging');
      el.setPointerCapture(e.pointerId);

      const move = (ev) => place((ev.clientX - grabX - area.left) / freeX, (ev.clientY - grabY - area.top) / freeY);
      const stop = () => {
        el.classList.remove('is-dragging');
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', stop);
        el.removeEventListener('pointercancel', stop);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', stop);
      el.addEventListener('pointercancel', stop);
    });

    el.addEventListener('keydown', (e) => {
      const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!step) return;
      e.preventDefault();
      const [x, y] = profiles[active].pos[name];
      place(x + step[0] * 0.05, y + step[1] * 0.05);
    });
  });

  /* Compass strip is doubled so its loop has no seam */
  const compass = studio.querySelector('[data-compass]');
  compass.innerHTML += compass.innerHTML;

  const clock = studio.querySelector('[data-clock]');
  const tickClock = () => {
    clock.textContent = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  };
  tickClock();
  setInterval(tickClock, 20000);

  /* Keys light up on real WASD/space presses */
  const keys = {};
  studio.querySelectorAll('[data-key]').forEach((el) => { keys[el.dataset.key] = el; });
  let lastPress = 0;
  window.addEventListener('keydown', (e) => {
    if (!keys[e.code]) return;
    lastPress = Date.now();
    keys[e.code].classList.add('is-down');
  });
  window.addEventListener('keyup', (e) => {
    if (keys[e.code]) keys[e.code].classList.remove('is-down');
  });

  /* Idle life for the preview: numbers drift and keys tap while the studio is on screen */
  if (canObserve) {
    const fps = studio.querySelector('[data-fps]');
    const cx = studio.querySelector('[data-cx]');
    const cz = studio.querySelector('[data-cz]');
    const keyCodes = Object.keys(keys);
    let x = 128;
    let z = -312;
    let timer = 0;
    const tick = () => {
      fps.textContent = 138 + Math.round(Math.random() * 12);
      x += Math.round(Math.random() * 2);
      z -= Math.round(Math.random() * 2);
      cx.textContent = x;
      cz.textContent = String(z).replace('-', '−');
      if (Date.now() - lastPress < 4000) return;
      const key = keys[keyCodes[Math.floor(Math.random() * keyCodes.length)]];
      key.classList.add('is-down');
      setTimeout(() => key.classList.remove('is-down'), 320);
    };
    new IntersectionObserver((entries) => {
      clearInterval(timer);
      if (entries[0].isIntersecting) timer = setInterval(tick, 700);
    }).observe(screen);
  }

  render(false);
})();
