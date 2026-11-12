(() => {
  'use strict';
  if (window.HIDER_COSMETICS_UI === false) return;   // set window.HIDER_COSMETICS_UI = false to hide the cosmetics tab again
  const api = window.hider;
  if (!api || !api.cosCatalog || !window.hiderPanels) return;
  const app = document.getElementById('appWindow');
  const ui = app.querySelector('.app-ui');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const previewSrc = (it) => it.mob ? 'assets/cosmetics/' + it.id + '.png' : it.preview;

  /* ---------- title bar button (hanger) ---------- */
  ui.insertAdjacentHTML('afterbegin',
    '<button class="app-hit app-cos" id="appCosBtn" data-panel-btn="cos" type="button" aria-label="Cosmetics" aria-expanded="false" title="Cosmetics">' +
    '<svg viewBox="0 0 24 24"><path d="M21.6 18.2 13 11.75v-.91c1.65-.49 2.8-2.17 2.43-4.05-.26-1.31-1.3-2.4-2.61-2.7C10.54 3.57 8.5 5.3 8.5 7.5h2c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5c0 .84-.69 1.52-1.53 1.5-.54-.01-.97.45-.97.99v1.76L2.4 18.2c-.77.58-.36 1.8.6 1.8h18c.96 0 1.37-1.22.6-1.8zM6 18l6-4.5 6 4.5H6z"/></svg></button>');

  ui.insertAdjacentHTML('beforeend',
    '<div class="cos-panel" id="cosPanel" role="dialog" aria-label="Cosmetics">' +
    '<div class="cos-head"><div class="cos-title">Cosmetics</div>' +
    '<div class="cos-chips" id="cosChips" aria-label="Equipped"></div>' +
    '<div class="cos-actions"><button class="cos-clear cos-self" id="cosSelf" type="button" role="switch" aria-checked="false" title="Show your cosmetics on yourself (on for third-person camera, off for first person)">Show on me: Off</button>' +
    '<button class="cos-clear" id="cosClear" type="button">Remove all</button></div></div>' +
    '<div class="cos-tabs" id="cosTabs" role="tablist"></div>' +
    '<div class="cos-grid" id="cosGrid" role="tabpanel"></div>' +
    '</div>');

  const $ = (id) => document.getElementById(id);
  const elChips = $('cosChips'), elTabs = $('cosTabs'), elGrid = $('cosGrid'), elClear = $('cosClear'), elSelf = $('cosSelf');
  let selfView = false;
  const paintSelf = () => { elSelf.classList.toggle('is-on', selfView); elSelf.setAttribute('aria-checked', String(selfView)); elSelf.textContent = 'Show on me: ' + (selfView ? 'On' : 'Off'); };
  elSelf.addEventListener('click', () => { selfView = !selfView; paintSelf(); api.setCosSelf(selfView).catch(() => {}); });
  let cat = { slots: [], items: [] };
  let eq = {};
  let tab = null;

  const slotTitle = (id) => { const s = cat.slots.find((x) => x.id === id); return s ? s.title : id; };
  const itemOf = (slot, id) => cat.items.find((x) => x.slot === slot && x.id === id);

  function paintChips() {
    const slots = cat.slots.filter((s) => eq[s.id] && itemOf(s.id, eq[s.id]));
    elChips.innerHTML = slots.length
      ? slots.map((s) => '<button class="cos-chip" type="button" data-slot="' + esc(s.id) + '" title="Remove"><span>' + esc(s.title) + '</span><b>' +
        esc(itemOf(s.id, eq[s.id]).name) + '</b><i aria-hidden="true"></i></button>').join('')
      : '<span class="cos-none">Nothing equipped</span>';
    elClear.disabled = !slots.length;
  }

  function paintTabs() {
    elTabs.innerHTML = cat.slots.map((s) => {
      const n = cat.items.filter((x) => x.slot === s.id).length;
      return '<button class="cos-tab' + (s.id === tab ? ' is-on' : '') + '" type="button" role="tab" aria-selected="' + (s.id === tab) +
        '" data-slot="' + esc(s.id) + '"' + (n ? '' : ' disabled') + '>' + esc(s.title) + (eq[s.id] ? '<i></i>' : '') + '</button>';
    }).join('');
  }

  function paintGrid() {
    const items = cat.items.filter((x) => x.slot === tab);
    elGrid.scrollTop = 0;
    elGrid.innerHTML = items.length
      ? items.map((it, n) => '<button class="cos-card' + (eq[it.slot] === it.id ? ' is-on' : '') + '" type="button" style="--n:' + n + '" data-slot="' + esc(it.slot) +
        '" data-id="' + esc(it.id) + '" aria-pressed="' + (eq[it.slot] === it.id) + '"><span class="cos-thumb"><img alt="" draggable="false" src="' + esc(previewSrc(it)) +
        '"></span><span class="cos-name">' + esc(it.name) + '</span><span class="cos-state">' + (eq[it.slot] === it.id ? 'Equipped' : 'Tap to equip') +
        '</span><i class="cos-check" aria-hidden="true"></i></button>').join('')
      : '<div class="cos-empty">Nothing here yet</div>';
  }

  // cheap repaint after an equip change: only card state, chips and the tab dots
  function paintState() {
    paintChips();
    elTabs.querySelectorAll('.cos-tab').forEach((t) => {
      const has = !!eq[t.dataset.slot];
      const dot = t.querySelector('i');
      if (has && !dot) t.insertAdjacentHTML('beforeend', '<i></i>');
      if (!has && dot) dot.remove();
    });
    elGrid.querySelectorAll('.cos-card').forEach((c) => {
      const on = eq[c.dataset.slot] === c.dataset.id;
      c.classList.toggle('is-on', on);
      c.setAttribute('aria-pressed', String(on));
      c.querySelector('.cos-state').textContent = on ? 'Equipped' : 'Tap to equip';
    });
  }

  function clean(v) {
    const out = {};
    if (v && typeof v === 'object') for (const it of cat.items) if (v[it.slot] === it.id) out[it.slot] = it.id;
    return out;
  }

  let pending = 0;
  async function apply(next) {
    eq = next;
    paintState();
    pending++;
    try { await api.setCosmetics(Object.assign({}, next)); } catch { /* the backend keeps it locally and sends it when the relay is back */ }
    pending--;
  }

  elChips.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.cos-chip');
    if (!b) return;
    const next = Object.assign({}, eq); delete next[b.dataset.slot]; apply(next);
  });
  elClear.addEventListener('click', () => { if (Object.keys(eq).length) apply({}); });
  elTabs.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.cos-tab');
    if (!b || b.disabled || b.dataset.slot === tab) return;
    tab = b.dataset.slot;
    elTabs.querySelectorAll('.cos-tab').forEach((t) => { const on = t === b; t.classList.toggle('is-on', on); t.setAttribute('aria-selected', String(on)); });
    paintGrid();
  });
  elGrid.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.cos-card');
    if (!b) return;
    const next = Object.assign({}, eq);
    if (next[b.dataset.slot] === b.dataset.id) delete next[b.dataset.slot]; else next[b.dataset.slot] = b.dataset.id;
    apply(next);
  });
  $('appCosBtn').addEventListener('click', () => window.hiderPanels.toggle('cos'));

  // the host is the source of truth: whatever the backend reports (hello / ack) is shown here
  function fromState(s) {
    if (!s || !s.cosmetics || pending) return;
    const next = clean(s.cosmetics);
    if (JSON.stringify(next) === JSON.stringify(eq)) return;
    eq = next;
    if (cat.slots.length) paintState();
  }

  api.cosCatalog().then((r) => {
    if (!r || !r.catalog) return;
    cat = r.catalog;
    eq = clean(r.equipped);
    selfView = !!r.selfView; paintSelf();
    tab = (cat.slots.find((s) => cat.items.some((x) => x.slot === s.id)) || cat.slots[0] || {}).id || null;
    paintTabs(); paintChips(); paintGrid();
  }).catch(() => {});
  api.init().then((r) => { if (r && r.state) fromState(r.state); }).catch(() => {});
  api.on('state', fromState);
  // a re-login restores the host copy: the catalog call returns the freshly cached equipped set
  document.addEventListener('hider:panel', (e) => {
    if (e.detail !== 'cos') return;
    api.cosCatalog().then((r) => { if (r && typeof r.selfView === 'boolean') { selfView = r.selfView; paintSelf(); } if (r && r.equipped && !pending) { const n = clean(r.equipped); if (JSON.stringify(n) !== JSON.stringify(eq)) { eq = n; paintState(); } } }).catch(() => {});
  });
})();
