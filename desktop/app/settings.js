(() => {
  'use strict';
  const api = window.hider;
  if (!api || !api.init) return;
  const app = document.getElementById('appWindow');
  const ui = app.querySelector('.app-ui');
  const LS = window.localStorage;
  const get = (k, d) => { try { const v = LS.getItem('hider.set.' + k); return v === null ? d : v === '1'; } catch { return d; } };
  const put = (k, v) => { try { LS.setItem('hider.set.' + k, v ? '1' : '0'); } catch { /* ignore */ } };

  /* ---------- shared panel manager: only one panel (settings | cos) is open at a time ---------- */
  const CLS = { settings: 'is-settings', cos: 'is-cos', cleaner: 'is-cleaner' };
  let cur = null;
  function show(name) {
    name = CLS[name] ? name : null;
    cur = name;
    Object.keys(CLS).forEach((k) => app.classList.toggle(CLS[k], k === name));
    ui.querySelectorAll('[data-panel-btn]').forEach((b) => b.setAttribute('aria-expanded', String(b.dataset.panelBtn === name)));
    document.dispatchEvent(new CustomEvent('hider:panel', { detail: name }));
  }
  window.hiderPanels = {
    current: () => cur,
    open: (n) => show(n),
    toggle: (n) => show(cur === n ? null : n),
    close: () => show(null)
  };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cur) { e.preventDefault(); show(null); } });
  document.addEventListener('click', (e) => {
    if (!cur) return;
    // composedPath is fixed at dispatch time, so it still works when the clicked chip/card was re-rendered by its own handler
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    if (path.some((n) => n && n.matches && n.matches('.set-panel, .cos-panel, .cln-panel, [data-panel-btn]'))) return;
    if (e.target.closest && e.target.closest('.set-panel, .cos-panel, .cln-panel, [data-panel-btn]')) return;
    show(null);
  });
  document.addEventListener('hider:logout', () => show(null));

  /* ---------- gear button (title bar, left of the cosmetics button) ---------- */
  ui.insertAdjacentHTML('afterbegin',
    '<button class="app-hit app-settings" id="appSettingsBtn" data-panel-btn="settings" type="button" aria-label="Settings" aria-expanded="false" title="Settings">' +
    '<svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg></button>');

  const ROWS = [
    { id: 'presence', title: 'Show Hider users', text: 'See other Hider users in game with a tag before their nick. When off, you see nobody and nobody sees you.' },
    { id: 'top', title: 'Always on top', text: 'Keep the Hider window above other windows.' },
    { id: 'copy', title: 'Copy address automatically', text: 'Put the address into the clipboard as soon as it is ready.' }
  ];
  ui.insertAdjacentHTML('beforeend',
    '<div class="set-panel" id="setPanel" role="dialog" aria-label="Settings">' +
    '<div class="set-head"><div class="set-title">Settings</div></div>' +
    ROWS.map((r) => '<div class="set-row"><div class="set-txt"><b>' + r.title + '</b><span>' + r.text + '</span></div>' +
      '<button class="set-sw" type="button" role="switch" aria-checked="false" aria-label="' + r.title + '" data-set="' + r.id + '"></button></div>').join('') +
    '</div>');

  const panel = document.getElementById('setPanel');
  const sw = (id) => panel.querySelector('[data-set="' + id + '"]');
  const setSw = (id, on) => sw(id).setAttribute('aria-checked', String(!!on));
  const isOn = (id) => sw(id).getAttribute('aria-checked') === 'true';

  document.getElementById('appSettingsBtn').addEventListener('click', () => window.hiderPanels.toggle('settings'));

  /* state */
  setSw('top', get('top', false));
  setSw('copy', get('copy', false));
  setSw('presence', true);
  window.hiderSettings = { autoCopy: () => isOn('copy') };
  if (api.setTop) api.setTop(isOn('top'));

  function syncPrefs(s) { if (s && s.prefs) setSw('presence', s.prefs.presence !== false); }
  api.init().then((r) => { if (r && r.state) syncPrefs(r.state); }).catch(() => {});
  api.on('state', syncPrefs);

  panel.addEventListener('click', async (e) => {
    const b = e.target.closest && e.target.closest('.set-sw');
    if (!b) return;
    const id = b.dataset.set;
    const next = !isOn(id);
    setSw(id, next);
    if (id === 'presence') { const r = await api.setPrefs({ presence: next }); if (r && r.prefs) setSw('presence', r.prefs.presence); }
    else { put(id, next); if (id === 'top' && api.setTop) api.setTop(next); }
  });
})();
