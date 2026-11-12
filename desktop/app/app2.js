(() => {
  'use strict';

  const appScreen = document.getElementById('appWindow');
  if (!appScreen) return;

  const loginWindow = document.getElementById('window');
  const restoreBtn = document.getElementById('restoreBtn');
  const minBtn = document.getElementById('appMinBtn');
  const closeBtn = document.getElementById('appCloseBtn');
  const toggle = document.getElementById('appToggle');
  const tabs = [...appScreen.querySelectorAll('.app-tab')];
  const getBtn = document.getElementById('appGet');
  const copyBtn = document.getElementById('appCopy');
  const clearBtn = document.getElementById('appClear');
  const serverInput = document.getElementById('appServer');
  const versionBtn = document.getElementById('appVersion');
  const versionLabel = document.getElementById('appVersionLabel');
  const versionMenu = document.getElementById('appVersions');
  const versionOpts = [...appScreen.querySelectorAll('.app-version-opt')];
  const roleBtn = document.getElementById('appRole');
  const banBtn = document.getElementById('appBan');
  const rows = [...appScreen.querySelectorAll('.app-art [data-row]')];
  const rowKeys = [...new Set(rows.map((el) => Number(el.dataset.row)))].sort((a, b) => a - b);
  const rowSev = new Map();
  rows.forEach((el) => {
    const key = Number(el.dataset.row);
    if (!rowSev.has(key)) rowSev.set(key, el.dataset.sev);
  });
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  const ROW_STEP = 16;

  let lastScreen = 'login';
  let enterTimer = null;
  let filter = 'all';
  let cleared = false;
  let menuOpen = false;

  appScreen.classList.add('is-log-all');
  reflow();

  /* ------------------------------------------------------------ screens */

  function enterApp(event) {
    const hold = !!(event && event.detail && event.detail.hold);
    lastScreen = 'app';
    loginWindow.classList.add('is-leaving');

    setTimeout(() => {
      loginWindow.hidden = true;
      loginWindow.classList.remove('is-leaving', 'is-minimized', 'is-closed');

      appScreen.hidden = false;
      appScreen.classList.remove('is-closed', 'is-minimized');
      startAppSymbols();
      if (hold) return; // the page transition (fx) replays the entrance when the blur lifts
      void appScreen.offsetWidth;
      appScreen.classList.add('is-in');

      clearTimeout(enterTimer);
      enterTimer = setTimeout(() => appScreen.classList.remove('is-in'), 1500);
    }, motionQuery.matches ? 0 : 300);
  }

  function backToLogin() {
    lastScreen = 'login';
    setMenu(false);
    stopAppSymbols();
    appScreen.classList.add('is-closed');

    setTimeout(() => {
      appScreen.hidden = true;
      appScreen.classList.remove('is-closed', 'is-in', 'is-minimized');

      loginWindow.hidden = false;
      void loginWindow.offsetWidth;
      loginWindow.classList.remove('is-leaving');
    }, motionQuery.matches ? 0 : 280);
  }

  document.addEventListener('hider:login', enterApp);

  document.addEventListener('hider:restore', (event) => {
    if (lastScreen !== 'app') return;
    event.preventDefault();
    restoreBtn.hidden = true;
    appScreen.hidden = false;
    appScreen.classList.remove('is-closed', 'is-minimized');
    void appScreen.offsetWidth;
    appScreen.classList.add('is-in');
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => appScreen.classList.remove('is-in'), 1500);
  });

  /* ------------------------------------------------------------- chrome */

  minBtn.addEventListener('click', () => {
    const next = !appScreen.classList.contains('is-minimized');
    setMenu(false);
    appScreen.classList.toggle('is-minimized', next);
    minBtn.setAttribute('aria-label', next ? 'Restore' : 'Minimize');
    minBtn.title = next ? 'Restore' : 'Minimize';
  });

  closeBtn.addEventListener('click', () => {
    if (appScreen.classList.contains('is-closed')) return;
    setMenu(false);
    appScreen.classList.add('is-closed');
    setTimeout(() => {
      appScreen.hidden = true;
      appScreen.classList.remove('is-minimized');
      restoreBtn.hidden = false;
      restoreBtn.focus({ preventScroll: true });
    }, 280);
  });

  /* -------------------------------------------------------------- parts */

  toggle.addEventListener('click', () => {
    const on = !appScreen.classList.contains('is-account-on');
    appScreen.classList.toggle('is-account-on', on);
    toggle.setAttribute('aria-checked', String(on));
  });

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((other) => other.setAttribute('aria-selected', String(other === tab)));
      filter = tab.dataset.filter;
      cleared = false;
      appScreen.classList.remove('is-log-all', 'is-log-warn', 'is-log-err', 'is-logs-cleared');
      appScreen.classList.add('is-log-' + filter);
      reflow();
    });
  });

  getBtn.addEventListener('click', () => {
    appScreen.classList.remove('is-fetching');
    void appScreen.offsetWidth;
    appScreen.classList.add('is-fetching');
    setTimeout(() => appScreen.classList.remove('is-fetching'), 950);
  });

  /* --------------------------------------------------------- log reflow */

  function rowVisible(sev) {
    if (cleared) return false;
    if (filter === 'all') return true;
    if (filter === 'warn') return sev === 'warn';
    return sev === 'err';
  }

  function reflow() {
    const shift = new Map();
    let slot = 0;

    rowKeys.forEach((key) => {
      const visible = rowVisible(rowSev.get(key));
      shift.set(key, visible ? slot++ : slot);
    });

    rows.forEach((el) => {
      const key = Number(el.dataset.row);
      const offset = cleared ? 0 : (shift.get(key) - key) * ROW_STEP;
      el.style.translate = '0 ' + offset + 'px';
    });
  }

  /* ------------------------------------------------------------ version */

  /* the list opens downward out of the plate: newest version on top */
  function cmpVersion(a, b) {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
      const diff = (pa[i] || 0) - (pb[i] || 0);
      if (diff) return diff;
    }
    return 0;
  }

  versionOpts
    .slice()
    .sort((a, b) => cmpVersion(b.dataset.version, a.dataset.version))
    .forEach((opt, index) => {
      opt.style.setProperty('--i', index);
      versionMenu.appendChild(opt);
    });

  versionMenu.style.setProperty('--n', versionOpts.length);

  /* a single plate glides between rows instead of every row flashing on its own */
  const versionHl = document.createElement('span');
  versionHl.className = 'app-version-hl';
  versionHl.setAttribute('aria-hidden', 'true');
  versionMenu.prepend(versionHl);

  function moveHl(opt) {
    const y = `translateY(${opt.offsetTop + 1}px)`;
    if (!versionHl.classList.contains('is-on')) {
      versionHl.style.transition = 'none';
      versionHl.style.transform = y;
      void versionHl.offsetWidth;
      versionHl.style.transition = '';
      versionHl.classList.add('is-on');
    } else {
      versionHl.style.transform = y;
    }
  }

  function sortedOpts() {
    return [...versionMenu.querySelectorAll('.app-version-opt')];
  }

  function setMenu(open) {
    if (open === menuOpen) return;
    menuOpen = open;
    versionMenu.hidden = false;
    versionBtn.setAttribute('aria-expanded', String(open));
    appScreen.classList.toggle('is-version-open', open);
    if (!open) versionHl.classList.remove('is-on');
  }

  versionBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    setMenu(!menuOpen);
  });

  versionOpts.forEach((opt) => {
    opt.addEventListener('click', (event) => {
      event.stopPropagation();
      versionOpts.forEach((other) => other.setAttribute('aria-selected', String(other === opt)));
      versionLabel.textContent = opt.dataset.version;
      setMenu(false);
      versionBtn.focus({ preventScroll: true });
    });
  });

  document.addEventListener('click', () => setMenu(false));

  versionMenu.addEventListener('pointerover', (event) => {
    const opt = event.target.closest?.('.app-version-opt');
    if (opt && menuOpen) moveHl(opt);
  });

  versionMenu.addEventListener('pointerleave', () => versionHl.classList.remove('is-on'));

  versionOpts.forEach((opt) => {
    opt.addEventListener('focus', () => { if (menuOpen) moveHl(opt); });
  });

  versionBtn.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    event.stopPropagation();
    setMenu(true);
    const list = sortedOpts();
    const pick = list.find((opt) => opt.getAttribute('aria-selected') === 'true') || list[0];
    pick.focus({ preventScroll: true });
  });

  versionMenu.addEventListener('keydown', (event) => {
    const list = sortedOpts();
    const at = list.indexOf(document.activeElement);
    let next = -1;
    if (event.key === 'ArrowDown') next = Math.min(list.length - 1, at + 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, at - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = list.length - 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    list[next].focus({ preventScroll: true });
  });

  /* ----------------------------------------------------------- feedback */

  function pop(selector) {
    const el = appScreen.querySelector(selector);
    if (!el) return;
    el.classList.remove('is-pop');
    void el.getBoundingClientRect();
    el.classList.add('is-pop');
    setTimeout(() => el.classList.remove('is-pop'), 460);
  }

  function deny(selectors) {
    selectors.forEach((selector) => {
      const el = appScreen.querySelector(selector);
      if (!el) return;
      el.classList.remove('is-deny');
      void el.getBoundingClientRect();
      el.classList.add('is-deny');
      setTimeout(() => el.classList.remove('is-deny'), 440);
    });
  }

  copyBtn.addEventListener('click', () => pop('[data-i="33"]'));

  clearBtn.addEventListener('click', () => {
    cleared = !cleared;
    appScreen.classList.toggle('is-logs-cleared', cleared);
    pop('[data-i="32"]');
    reflow();
  });

  roleBtn.addEventListener('click', () => deny(['[data-i="16"]', '[data-i="17"]', '[data-i="18"]', '[data-i="19"]']));
  banBtn.addEventListener('click', () => deny(['[data-i="20"]']));

  /* ------------------------------------------------------ bottom symbols */

  const symField = document.getElementById('appSymbols');
  const symCells = symField ? [...symField.querySelectorAll('.sym')] : [];
  const symSpaceTimers = new WeakMap();
  let symTimer = null;

  symCells.forEach((cell) => { cell.dataset.base = cell.dataset.kind; });

  function symSpaceCount() {
    let count = 0;
    for (const cell of symCells) if (cell.dataset.kind === 'space') count += 1;
    return count;
  }

  function pickSymKind(cell) {
    const current = cell.dataset.kind;
    const base = cell.dataset.base === 'equals' ? 'equals' : 'plus';
    const other = base === 'plus' ? 'equals' : 'plus';
    const canBlank = symSpaceCount() < Math.floor(symCells.length * .14);
    const roll = Math.random();

    if (current === 'space') return roll < .82 ? base : other;
    if (current === base) {
      if (roll < .3) return other;
      return canBlank ? 'space' : base;
    }
    if (roll < .92) return base;
    return canBlank ? 'space' : base;
  }

  function flipSym(cell, nextKind) {
    if (cell.dataset.busy === '1' || cell.dataset.kind === nextKind) return;
    if (appScreen.hidden || appScreen.classList.contains('is-minimized')) return;

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
        if (cell.dataset.kind === 'space') flipSym(cell, pickSymKind(cell));
      }, 2400 + Math.random() * 2400);
      symSpaceTimers.set(cell, timer);
    } else {
      const timer = symSpaceTimers.get(cell);
      if (timer) {
        clearTimeout(timer);
        symSpaceTimers.delete(cell);
      }
    }
  }

  function animateSym(count) {
    if (motionQuery.matches || document.hidden) return;
    if (appScreen.hidden || appScreen.classList.contains('is-minimized')) return;

    const pool = symCells.filter((cell) => cell.dataset.busy !== '1');
    const total = Math.min(count, pool.length);

    for (let i = 0; i < total; i += 1) {
      const index = Math.floor(Math.random() * pool.length);
      const [cell] = pool.splice(index, 1);
      setTimeout(() => flipSym(cell, pickSymKind(cell)), i * 26 + Math.random() * 60);
    }
  }

  function startAppSymbols() {
    if (symTimer || motionQuery.matches || !symCells.length) return;
    animateSym(8);
    symTimer = setInterval(() => animateSym(3 + Math.floor(Math.random() * 4)), 400);
  }

  function stopAppSymbols() {
    if (!symTimer) return;
    clearInterval(symTimer);
    symTimer = null;
  }

  motionQuery.addEventListener?.('change', () => {
    if (motionQuery.matches) stopAppSymbols();
    else startAppSymbols();
  });

  /* ----------------------------------------------------------- keyboard */

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (appScreen.hidden) return;
    if (menuOpen) {
      event.preventDefault();
      setMenu(false);
      return;
    }
    if (document.activeElement === serverInput) {
      serverInput.blur();
      return;
    }
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

  });

  document.addEventListener('hider:logout', backToLogin);
})();