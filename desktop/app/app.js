(() => {
  'use strict';

  const STAGE_W = 1920;
  const STAGE_H = 1080;

  const INITIAL_USER = 'YukeeDesign';
  const INITIAL_PASS = 'hider-demo-activation-key';

  // the sparkle row in the source SVG is spaced 5.5px apart; the caret follows it
  const STAR_PITCH = 5.5;
  const STAR_ORIGIN = 28.5;

  const stage = document.getElementById('stage');
  const appWindow = document.getElementById('window');
  const form = document.getElementById('loginForm');
  const user = document.getElementById('username');
  const pass = document.getElementById('password');
  const eyeBtn = document.getElementById('eyeBtn');
  const minBtn = document.getElementById('minBtn');
  const closeBtn = document.getElementById('closeBtn');
  const restoreBtn = document.getElementById('restoreBtn');
  const buyLink = document.getElementById('buyLink');
  const passCaret = document.getElementById('passCaret');
  const passSel = document.getElementById('passSel');
  const starLayer = document.getElementById('artPassValue');
  const starD = starLayer.querySelector('path').getAttribute('d');
  const symbolField = document.getElementById('bottomSymbols');
  const symbolCells = symbolField ? [...symbolField.querySelectorAll('.sym')] : [];
  symbolCells.forEach((cell) => { cell.dataset.base = cell.dataset.kind; });
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  let revealed = false;
  let starCount = starLayer.querySelectorAll('path').length;

  /* ---------------------------------------------------------------- stage */

  function fitStage() {
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    const scale = Math.min(viewW / STAGE_W, viewH / STAGE_H);
    const x = (viewW - STAGE_W * scale) / 2;
    const y = (viewH - STAGE_H * scale) / 2;

    stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }

  fitStage();
  window.addEventListener('resize', fitStage);
  window.visualViewport?.addEventListener('resize', fitStage);

  /* --------------------------------------------------------------- stars */

  function renderStars(count) {
    count = Math.max(0, count);
    if (count === starCount) return;

    const ns = 'http://www.w3.org/2000/svg';
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < count; i += 1) {
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', starD);
      if (i) path.setAttribute('transform', `translate(${(i * STAR_PITCH).toFixed(3)} 0)`);
      fragment.appendChild(path);
    }

    starLayer.replaceChildren(fragment);
    starCount = count;
  }

  /* --------------------------------------------------------------- caret */

  /* own selection plate for the masked key, locked to the star grid */
  function updateSelection() {
    const start = pass.selectionStart ?? 0;
    const end = pass.selectionEnd ?? 0;
    const show = !revealed && document.activeElement === pass && end > start;

    if (show) {
      passSel.style.left = `${(STAR_ORIGIN - .5 + start * STAR_PITCH).toFixed(2)}px`;
      passSel.style.width = `${((end - start) * STAR_PITCH).toFixed(2)}px`;
    }

    passSel.classList.toggle('is-on', show);
  }

  function updateCaret(restart = false) {
    updateSelection();
    if (!appWindow.classList.contains('is-pass-caret')) return;

    const hasRange = (pass.selectionEnd ?? 0) > (pass.selectionStart ?? 0);
    const index = pass.selectionDirection === 'backward'
      ? (pass.selectionStart ?? pass.value.length)
      : (pass.selectionEnd ?? pass.value.length);
    passCaret.style.left = `${(STAR_ORIGIN + index * STAR_PITCH).toFixed(2)}px`;
    passCaret.style.visibility = hasRange ? 'hidden' : '';

    if (restart) {
      passCaret.style.animation = 'none';
      void passCaret.offsetWidth;
      passCaret.style.animation = '';
    }
  }

  function syncPass() {
    const nextType = revealed ? 'text' : 'password';
    if (pass.type !== nextType) pass.type = nextType;

    appWindow.classList.toggle('is-pass-revealed', revealed);

    const caretOn = !revealed && document.activeElement === pass;
    appWindow.classList.toggle('is-pass-caret', caretOn);
    if (caretOn) updateCaret(false);
    updateSelection();
  }

  /* --------------------------------------------------------------- fields */

  function syncUser() {
    const live = document.activeElement === user || user.value !== INITIAL_USER;
    appWindow.classList.toggle('is-user-live', live);
  }

  user.addEventListener('focus', syncUser);
  user.addEventListener('blur', syncUser);
  user.addEventListener('input', syncUser);

  pass.addEventListener('focus', () => {
    syncPass();
    if (!revealed) updateCaret(true);
  });

  pass.addEventListener('blur', syncPass);

  pass.addEventListener('input', () => {
    if (!revealed) renderStars(pass.value.length);
    syncPass();
    if (!revealed) updateCaret(true);
  });

  pass.addEventListener('keyup', () => {
    if (!revealed) updateCaret(true);
  });

  pass.addEventListener('select', () => {
    if (!revealed) updateCaret(true);
  });

  /* masked key: click, shift+click, drag and double-click selection on the star grid */
  let dragAnchor = null;

  function starIndexAt(event) {
    const rect = pass.getBoundingClientRect();
    const scale = rect.width / 257 || 1;
    const offset = (event.clientX - rect.left) / scale - STAR_ORIGIN;
    return Math.max(0, Math.min(pass.value.length, Math.round(offset / STAR_PITCH)));
  }

  function selectTo(index) {
    const from = Math.min(dragAnchor, index);
    const to = Math.max(dragAnchor, index);
    pass.setSelectionRange(from, to, index < dragAnchor ? 'backward' : 'forward');
    updateCaret(true);
  }

  pass.addEventListener('pointerdown', (event) => {
    if (revealed || event.button !== 0) return;

    const index = starIndexAt(event);

    event.preventDefault();
    pass.focus({ preventScroll: true });

    if (event.detail >= 2) {
      dragAnchor = null;
      pass.setSelectionRange(0, pass.value.length);
      updateCaret(true);
      return;
    }

    if (event.shiftKey) {
      const start = pass.selectionStart ?? index;
      const end = pass.selectionEnd ?? index;
      dragAnchor = pass.selectionDirection === 'backward' ? end : start;
    } else {
      dragAnchor = index;
    }

    selectTo(index);
    pass.setPointerCapture?.(event.pointerId);
  });

  pass.addEventListener('pointermove', (event) => {
    if (dragAnchor === null || revealed) return;
    selectTo(starIndexAt(event));
  });

  const endDrag = (event) => {
    if (dragAnchor === null) return;
    dragAnchor = null;
    pass.releasePointerCapture?.(event.pointerId);
  };

  pass.addEventListener('pointerup', endDrag);
  pass.addEventListener('pointercancel', endDrag);

  document.addEventListener('selectionchange', () => {
    if (document.activeElement === pass && !revealed) updateCaret(false);
    else updateSelection();
  });

  eyeBtn.addEventListener('click', () => {
    revealed = !revealed;
    if (!revealed) renderStars(pass.value.length);
    syncPass();
    eyeBtn.setAttribute('aria-pressed', String(revealed));
    eyeBtn.setAttribute('aria-label', revealed ? 'Hide activation key' : 'Show activation key');
  });

  /* ---------------------------------------------------------------- login */

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    const invalid = [];
    if (!user.value.trim()) invalid.push(user);
    if (!pass.value) invalid.push(pass);

    if (invalid.length) {
      appWindow.classList.remove('shake');
      void appWindow.offsetWidth;
      appWindow.classList.add('shake');
      setTimeout(() => appWindow.classList.remove('shake'), 420);
      invalid[0].focus({ preventScroll: true });
      return;
    }

    // desktop build: live.js validates the credentials against the relay and opens the app only on success
    if (window.hider) return;

    appWindow.classList.remove('submitting');
    void appWindow.offsetWidth;
    appWindow.classList.add('submitting');
    setTimeout(() => appWindow.classList.remove('submitting'), 500);

    // app2.js takes over from here and swaps in the app window
    setTimeout(() => document.dispatchEvent(new CustomEvent('hider:login')), 240);
  });

  buyLink.addEventListener('click', (event) => {
    event.preventDefault();
    appWindow.classList.remove('buy-pop');
    void appWindow.offsetWidth;
    appWindow.classList.add('buy-pop');
    setTimeout(() => appWindow.classList.remove('buy-pop'), 360);
  });

  /* --------------------------------------------------------------- chrome */

  function setMinimized(next) {
    appWindow.classList.toggle('is-minimized', next);
    minBtn.setAttribute('aria-label', next ? 'Restore' : 'Minimize');
    minBtn.title = next ? 'Restore' : 'Minimize';
  }

  minBtn.addEventListener('click', () => {
    setMinimized(!appWindow.classList.contains('is-minimized'));
  });

  closeBtn.addEventListener('click', () => {
    if (appWindow.classList.contains('is-closed')) return;
    appWindow.classList.add('is-closed');
    setTimeout(() => {
      appWindow.hidden = true;
      appWindow.classList.remove('is-minimized');
      restoreBtn.hidden = false;
      restoreBtn.focus({ preventScroll: true });
    }, 280);
  });

  restoreBtn.addEventListener('click', () => {
    // app2.js decides which window to reopen (login form or the app window)
    const handled = !document.dispatchEvent(new CustomEvent('hider:restore', { cancelable: true }));
    if (handled) return;

    restoreBtn.hidden = true;
    setMinimized(false);
    appWindow.hidden = false;
    // commit the closed state before removing it so the fade-in actually runs
    void appWindow.offsetWidth;
    appWindow.classList.remove('is-closed');
  });

  /* --------------------------------------------------- bottom symbols */

  const spaceTimers = new WeakMap();

  function countSpaces() {
    let count = 0;
    for (const cell of symbolCells) {
      if (cell.dataset.kind === 'space') count += 1;
    }
    return count;
  }

  function pickSymbolKind(cell) {
    const current = cell.dataset.kind;
    const base = cell.dataset.base === 'equals' ? 'equals' : 'plus';
    const other = base === 'plus' ? 'equals' : 'plus';
    const canBlank = countSpaces() < Math.floor(symbolCells.length * .14);
    const roll = Math.random();

    // a blank cell always comes back, mostly as its original glyph
    if (current === 'space') return roll < .82 ? base : other;

    // cells sitting on their original glyph only leave it occasionally; when the
    // blank budget is full they simply stay put, keeping the source composition
    if (current === base) {
      if (roll < .3) return other;
      return canBlank ? 'space' : base;
    }

    // cells that drifted away are pulled back home, sometimes through a blank
    if (roll < .92) return base;
    return canBlank ? 'space' : base;
  }

  function flipSymbol(cell, nextKind) {
    if (cell.dataset.busy === '1' || cell.dataset.kind === nextKind) return;
    if (appWindow.hidden || appWindow.classList.contains('is-minimized')) return;

    cell.dataset.busy = '1';
    cell.classList.add('is-flipping');

    setTimeout(() => {
      cell.dataset.kind = nextKind;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => cell.classList.remove('is-flipping'));
      });
      setTimeout(() => { delete cell.dataset.busy; }, 200);
    }, 110);

    if (nextKind === 'space') {
      const timer = setTimeout(() => {
        if (cell.dataset.kind === 'space') {
          flipSymbol(cell, pickSymbolKind(cell));
        }
      }, 2600 + Math.random() * 2600);
      spaceTimers.set(cell, timer);
    } else {
      const timer = spaceTimers.get(cell);
      if (timer) {
        clearTimeout(timer);
        spaceTimers.delete(cell);
      }
    }
  }

  function animateSymbols(count) {
    if (motionQuery.matches || document.hidden) return;
    if (appWindow.hidden || appWindow.classList.contains('is-minimized')) return;

    const pool = symbolCells.filter((cell) => cell.dataset.busy !== '1');
    const total = Math.min(count, pool.length);

    for (let i = 0; i < total; i += 1) {
      const index = Math.floor(Math.random() * pool.length);
      const [cell] = pool.splice(index, 1);
      const delay = i * 26 + Math.random() * 60;

      setTimeout(() => {
        flipSymbol(cell, pickSymbolKind(cell));
      }, delay);
    }
  }

  let symbolTimer = null;

  function startSymbols() {
    if (symbolTimer || motionQuery.matches || !symbolCells.length) return;
    animateSymbols(16);
    symbolTimer = setInterval(() => {
      animateSymbols(8 + Math.floor(Math.random() * 7));
    }, 400);
  }

  function stopSymbols() {
    if (!symbolTimer) return;
    clearInterval(symbolTimer);
    symbolTimer = null;
  }

  if (symbolCells.length) {
    startSymbols();
    motionQuery.addEventListener?.('change', () => {
      if (motionQuery.matches) stopSymbols();
      else startSymbols();
    });
  }

  /* ------------------------------------------------------------- keyboard */

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });

  /* ---------------------------------------------------------------- init */

  renderStars(pass.value.length);
  syncUser();
  syncPass();
})();
