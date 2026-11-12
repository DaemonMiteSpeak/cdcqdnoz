(() => {
  'use strict';
  // Cleaner tab: visual only for now (nothing is really deleted). Scan -> pick what to remove -> Clean,
  // with a progress bar, a result per category and a "last cleaned" stamp.
  const app = document.getElementById('appWindow');
  if (!app || !window.hiderPanels) return;
  const ui = app.querySelector('.app-ui');
  const LS = window.localStorage;
  const lsGet = (k) => { try { return LS.getItem('hider.cln.' + k); } catch { return null; } };
  const lsPut = (k, v) => { try { LS.setItem('hider.cln.' + k, v); } catch { /* ignore */ } };

  const ICON = {
    clients: 'M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z',
    folders: 'M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z',
    system: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z'
  };
  const ITEMS = [
    { id: 'clients', title: 'Clients, mods and loaders', text: 'Game clients, installed mods and mod loaders', min: 140, max: 520, files: [6, 38] },
    { id: 'folders', title: 'Folders and logs', text: 'Client and Baritone folders, logs and leftovers', min: 20, max: 160, files: [30, 240] },
    { id: 'system', title: 'Services and recycle bin', text: 'Related services, programs and recycle bin data', min: 8, max: 90, files: [4, 25] }
  ];

  /* ---------- title bar button (left of settings) ---------- */
  ui.insertAdjacentHTML('afterbegin',
    '<button class="app-hit app-cleaner" id="appCleanerBtn" data-panel-btn="cleaner" type="button" aria-label="Cleaner" aria-expanded="false" title="Cleaner">' +
    '<svg viewBox="0 0 24 24"><path d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z"/></svg></button>');

  ui.insertAdjacentHTML('beforeend',
    '<div class="cln-panel" id="clnPanel" role="dialog" aria-label="Cleaner">' +
    '<div class="cln-head"><div class="cln-title">Cleaner</div><div class="cln-last" id="clnLast"></div></div>' +
    ITEMS.map((r) => '<div class="cln-card" data-cln="' + r.id + '">' +
      '<div class="cln-ico"><svg viewBox="0 0 24 24"><path d="' + ICON[r.id] + '"/></svg></div>' +
      '<div class="cln-txt"><b>' + r.title + '</b><span>' + r.text + '</span></div>' +
      '<div class="cln-stat"><span class="cln-size"></span><i class="cln-spin"></i>' +
      '<svg class="cln-ok" viewBox="0 0 12 12"><path d="M2 6.4 4.8 9 10 3.2"/></svg></div>' +
      '<button class="cln-pick" type="button" role="checkbox" aria-checked="true" aria-label="' + r.title + '" tabindex="-1">' +
      '<svg viewBox="0 0 12 12"><path d="M2.4 6.4 4.9 8.8 9.6 3.4"/></svg></button>' +
      '<div class="cln-cbar"><i></i></div></div>').join('') +
    '<div class="cln-foot">' +
    '<div class="cln-sumrow"><span class="cln-sum" id="clnSum"></span><span class="cln-pct" id="clnPct"></span></div>' +
    '<div class="cln-bar"><i id="clnBar"></i></div>' +
    '<button class="cln-go" id="clnGo" type="button"></button></div>' +
    '</div>');

  const panel = document.getElementById('clnPanel');
  const go = document.getElementById('clnGo');
  const sum = document.getElementById('clnSum');
  const pct = document.getElementById('clnPct');
  const bar = document.getElementById('clnBar');
  const last = document.getElementById('clnLast');
  const cards = {};
  ITEMS.forEach((r) => { cards[r.id] = panel.querySelector('.cln-card[data-cln="' + r.id + '"]'); });

  document.getElementById('appCleanerBtn').addEventListener('click', () => window.hiderPanels.toggle('cleaner'));

  /* ---------- state ---------- */
  let phase = 'idle';          // idle | scanning | ready | cleaning | done
  let token = 0;               // bumped on reset so a running scan/clean stops
  const found = {};            // id -> { mb, files, on }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const fmt = (mb) => (mb >= 1000 ? (mb / 1024).toFixed(2) + ' GB' : Math.round(mb) + ' MB');
  const pad = (n) => String(n).padStart(2, '0');
  const total = () => ITEMS.reduce((a, r) => a + (found[r.id] && found[r.id].on ? found[r.id].mb : 0), 0);
  const chosen = () => ITEMS.filter((r) => found[r.id] && found[r.id].on);
  const setBar = (f) => { bar.style.width = Math.max(0, Math.min(1, f)) * 100 + '%'; pct.textContent = phase === 'scanning' || phase === 'cleaning' ? Math.round(f * 100) + '%' : ''; };
  const cardBar = (id, f) => { cards[id].querySelector('.cln-cbar > i').style.width = f * 100 + '%'; };

  function paintLast() {
    const t = Number(lsGet('last'));
    if (!t) { last.textContent = 'Never cleaned'; return; }
    const d = new Date(t);
    last.textContent = 'Last cleaned ' + pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function paint() {
    panel.dataset.phase = phase;
    ITEMS.forEach((r) => {
      const c = cards[r.id], f = found[r.id];
      const pick = c.querySelector('.cln-pick');
      c.classList.toggle('is-scan', c.dataset.state === 'scan');
      pick.setAttribute('aria-checked', String(!f || f.on));
      pick.tabIndex = phase === 'ready' ? 0 : -1;
      pick.disabled = phase !== 'ready';
      c.classList.toggle('is-off', !!f && !f.on && phase === 'ready');
    });
    if (phase === 'idle') { sum.textContent = 'Scan to see what can be removed'; go.textContent = 'Scan'; go.disabled = false; setBar(0); }
    else if (phase === 'scanning') { go.textContent = 'Scanning...'; go.disabled = true; }
    else if (phase === 'ready') {
      const n = chosen().length, mb = total();
      sum.textContent = n ? fmt(mb) + ' can be freed' : 'Nothing selected';
      go.textContent = n ? 'Clean ' + fmt(mb) : 'Clean'; go.disabled = !n;
    } else if (phase === 'cleaning') { go.textContent = 'Cleaning...'; go.disabled = true; }
    else if (phase === 'done') { go.textContent = 'Scan again'; go.disabled = false; }
  }

  function cardState(id, st, text) {
    const c = cards[id];
    c.dataset.state = st;
    c.querySelector('.cln-size').textContent = text || '';
  }

  function reset() {
    token++;
    phase = 'idle';
    for (const k of Object.keys(found)) delete found[k];
    ITEMS.forEach((r) => { cardState(r.id, 'idle', 'Not scanned'); cardBar(r.id, 0); });
    paint();
  }

  async function scan() {
    const my = ++token;
    phase = 'scanning';
    for (const k of Object.keys(found)) delete found[k];
    ITEMS.forEach((r) => { cardState(r.id, 'wait', 'Waiting'); cardBar(r.id, 0); });
    paint(); setBar(0);
    sum.textContent = 'Scanning...';
    for (let i = 0; i < ITEMS.length; i++) {
      const r = ITEMS[i];
      cardState(r.id, 'scan', 'Scanning');
      paint();
      const steps = 12;
      for (let s = 1; s <= steps; s++) {
        await sleep(rand(60, 110));
        if (my !== token) return;
        setBar((i + s / steps) / ITEMS.length);
      }
      const mb = rand(r.min, r.max), files = Math.round(rand(r.files[0], r.files[1]));
      found[r.id] = { mb, files, on: true };
      cardState(r.id, 'found', fmt(mb));
      cards[r.id].title = files + ' items';
    }
    phase = 'ready';
    setBar(1); pct.textContent = '';
    paint();
  }

  async function clean() {
    const my = ++token;
    const list = chosen();
    if (!list.length) return;
    phase = 'cleaning';
    ITEMS.forEach((r) => { if (!found[r.id] || !found[r.id].on) cardState(r.id, 'skip', 'Skipped'); else cardState(r.id, 'wait', 'Waiting'); });
    paint(); setBar(0);
    sum.textContent = 'Cleaning...';
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      cardState(r.id, 'clean', 'Cleaning');
      const steps = 16;
      for (let s = 1; s <= steps; s++) {
        await sleep(rand(50, 95));
        if (my !== token) return;
        cardBar(r.id, s / steps);
        setBar((i + s / steps) / list.length);
      }
      cardState(r.id, 'done', 'Cleaned');
      cardBar(r.id, 0);
    }
    lsPut('last', String(Date.now()));
    paintLast();
    phase = 'done';
    sum.textContent = fmt(total()) + ' freed';
    setBar(1); pct.textContent = '';
    paint();
  }

  panel.addEventListener('click', (e) => {
    const pick = e.target.closest && e.target.closest('.cln-pick');
    const card = e.target.closest && e.target.closest('.cln-card');
    if (!card || phase !== 'ready' || !(pick || e.target.closest('.cln-txt, .cln-stat, .cln-ico'))) return;
    const f = found[card.dataset.cln];
    if (!f) return;
    f.on = !f.on;
    paint();
  });

  go.addEventListener('click', () => {
    if (go.disabled) return;
    if (phase === 'idle' || phase === 'done') scan();
    else if (phase === 'ready') clean();
  });

  document.addEventListener('hider:logout', reset);
  paintLast();
  reset();
})();
