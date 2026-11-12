(() => {
  'use strict';

  const api = window.hider;
  if (!api || !api.init) return;

  const $ = (id) => document.getElementById(id);
  const loginWin = $('window');
  const app = $('appWindow');
  const form = $('loginForm');
  const user = $('username');
  const pass = $('password');
  const ui = app.querySelector('.app-ui');
  const srv = $('appServer');
  const verLabel = $('appVersionLabel');
  const verOpts = [...app.querySelectorAll('.app-version-opt')];
  const fx = window.hiderFx;
  const LS = window.localStorage;
  const ls = (k, v) => { try { if (v === undefined) return LS.getItem('hider.' + k); LS.setItem('hider.' + k, v); } catch { /* ignore */ } return null; };

  let st = { authed: false, phase: 'idle', clients: [], address: '', canSwitch: false };
  let logs = [];
  let filter = 'all';
  let busy = false;

  /* ---------- small helpers ---------- */
  function intercept(sel, fn) {
    document.addEventListener('click', (e) => {
      const t = e.target.closest && e.target.closest(sel);
      if (!t) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      fn(e);
    }, true);
  }
  function flash(sel, cls, ms) {
    app.querySelectorAll(sel).forEach((el) => {
      el.classList.remove(cls);
      void el.getBoundingClientRect();
      el.classList.add(cls);
      setTimeout(() => el.classList.remove(cls), ms);
    });
  }
  const deny = (sels) => flash(sels.join(','), 'is-deny', 440);
  const pop = (sel) => flash(sel, 'is-pop', 460);
  const pad = (n) => String(n).padStart(2, '0');
  const hms = (ts) => { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };
  const dmy = (ts) => { const d = new Date(ts); return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear(); };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- live layer ---------- */
  ui.insertAdjacentHTML('beforeend',
    '<div class="live-get" id="liveGet"><svg viewBox="0 0 12 12"><path d="M2 6.4 4.8 9 10 3.2"/></svg><span id="liveGetText">Ready</span></div>' +
    '<div class="live-ava" id="liveAva"><img id="banAvatar" alt="" draggable="false"><span id="banLetter"></span></div>' +
    '<div class="live-online" id="liveOnline"><i></i><span id="onlineText"></span></div>' +
    '<div class="live-ban" id="liveBan"><div class="nm"><span id="banName"></span><b id="banTag"></b></div><div class="dt" id="banDate"></div></div>' +
    '<div class="live-chip" id="liveChip" title="Copy address"><span id="chipText"></span><svg viewBox="0 0 12 12"><rect x="4" y="4" width="6.5" height="6.5" rx="1.4"/><path d="M8 2.6V2.3A.8.8 0 0 0 7.2 1.5H2.3A.8.8 0 0 0 1.5 2.3v4.9a.8.8 0 0 0 .8.8h.3"/></svg></div>' +
    '<div class="live-clients" id="liveClients"></div>' +
    '<div class="live-logs" id="liveLogs"></div>');
  const elGetText = $('liveGetText');
  const elChip = $('liveChip');
  const elClients = $('liveClients');
  const elLogs = $('liveLogs');

  loginWin.insertAdjacentHTML('beforeend', '<div class="login-err" id="loginErr"></div>');
  const loginErr = $('loginErr');

  /* ---------- profile ring: the share of the subscription that is still left (lifetime = always a full circle) ---------- */
  const RING = { cx: 999.5, cy: 422.5, r: 18.5 };
  const ringEl = app.querySelector('[data-i="56"]');
  const num = (n) => (Math.round(n * 1000) / 1000).toString();
  function ringFrac() {
    const p = st.profile;
    if (!p || !p.until) return 1;                                   // lifetime (or no profile yet): full circle
    const from = p.created > 0 && p.created < p.until ? p.created : 0;
    if (!from) return 1;                                            // start date unknown: cannot compute, show full
    return Math.max(0, Math.min(1, (p.until - Date.now()) / (p.until - from)));
  }
  function ringPath(f) {
    const { cx, cy, r } = RING;
    if (f >= 0.9995) return 'M' + num(cx) + ' ' + num(cy - r) + 'A' + r + ' ' + r + ' 0 1 1 ' + num(cx) + ' ' + num(cy + r) + 'A' + r + ' ' + r + ' 0 1 1 ' + num(cx) + ' ' + num(cy - r) + 'Z';
    if (f <= 0.0005) return 'M' + num(cx) + ' ' + num(cy) + 'Z';
    const a = f * Math.PI * 2;                                      // clockwise from 12 o'clock
    const x = cx + r * Math.sin(a), y = cy - r * Math.cos(a);
    return 'M' + num(cx) + ' ' + num(cy) + 'L' + num(cx) + ' ' + num(cy - r) + 'A' + r + ' ' + r + ' 0 ' + (f > 0.5 ? 1 : 0) + ' 1 ' + num(x) + ' ' + num(y) + 'Z';
  }
  function updateRing() { if (ringEl) ringEl.setAttribute('d', ringPath(ringFrac())); }
  setInterval(updateRing, 30000);

  /* ---------- Telegram avatar (falls back to the first letter of the username) ---------- */
  const avaImg = $('banAvatar');
  const avaLetter = $('banLetter');
  let avaSrc = '';
  avaImg.addEventListener('error', () => { avaImg.style.display = 'none'; avaLetter.style.display = 'flex'; });
  avaImg.addEventListener('load', () => { avaImg.style.display = 'block'; avaLetter.style.display = 'none'; });
  function setAvatar(p) {
    avaLetter.textContent = String(p.name || '?').charAt(0).toUpperCase();
    if (p.avatarData) {
      if (avaSrc !== p.avatarData) { avaSrc = p.avatarData; avaImg.src = p.avatarData; }
    } else {
      avaSrc = ''; avaImg.removeAttribute('src'); avaImg.style.display = 'none'; avaLetter.style.display = 'flex';
    }
  }

  /* ---------- render ---------- */
  function render() {
    app.classList.toggle('is-authed', !!st.authed);
    app.classList.toggle('is-ph-connecting', st.phase === 'connecting');
    app.classList.toggle('is-ph-ready', st.phase === 'ready');
    app.classList.toggle('is-role-on', !!st.canSwitch);
    app.classList.toggle('is-ban-on', st.phase !== 'idle');
    app.classList.toggle('has-clients', st.clients.length > 0);
    app.classList.toggle('has-address', !!st.address && st.phase === 'ready');
    elGetText.textContent = st.phase === 'connecting' ? 'Connecting\u2026' : 'Ready';
    srv.readOnly = st.phase !== 'idle';
    if (st.address) $('chipText').textContent = st.address;

    if (st.profile) {
      $('banName').textContent = st.profile.name;
      setAvatar(st.profile);
      const n = st.online | 0;
      $('onlineText').textContent = n + ' online';
      $('liveOnline').title = (st.onlineUsers || []).map((u) => u.name + (u.nick ? ' (' + u.nick + ')' : '')).join(', ');
      $('banTag').textContent = st.profile.tag || '';
      const from = st.profile.created ? dmy(st.profile.created) : dmy(Date.now());
      $('banDate').textContent = from + ' to ' + (st.profile.until ? dmy(st.profile.until) : 'lifetime');
    }
    updateRing();

    const rows = st.clients.map((c, i) => {
      const ctl = c.role === 'controller';
      return '<div class="cl"><div class="cl-n">' + esc(c.nick) + ' #' + (i + 1) + '</div><div class="cl-s">' +
        (c.attached ? 'client online' : 'connecting\u2026') + '</div><div class="cl-r' + (ctl ? '' : ' w') + '">' + (ctl ? 'manager' : 'watching') + '</div></div>';
    }).join('');
    const sig = st.clients.map((c) => c.nick + c.role + c.attached).join('|');
    if (elClients.dataset.sig !== sig) { elClients.dataset.sig = sig; elClients.innerHTML = rows; }
  }

  function setState(s) { st = Object.assign({}, st, s); render(); }

  /* ---------- logs ---------- */
  const SEV = { info: ['INFO', 's-info'], warn: ['WARNING', 's-warn'], err: ['Error', 's-err'] };
  const show = (e) => filter === 'all' || (filter === 'warn' && e.sev === 'warn') || (filter === 'err' && e.sev === 'err');
  const rowHtml = (e) => {
    const [lab, cls] = SEV[e.sev] || SEV.info;
    return '<div class="lg' + (e.sev === 'err' ? ' is-err' : '') + '"><span class="t">[' + hms(e.ts) + ']</span> <span class="' + cls + '">[' + lab + ']</span> <span class="m">' + esc(e.msg) + '</span></div>';
  };
  function renderLogs() {
    const list = logs.filter(show);
    elLogs.innerHTML = list.length ? list.map(rowHtml).join('') : '';
    elLogs.scrollTop = elLogs.scrollHeight;
  }
  function pushLog(e) {
    logs.push(e);
    if (logs.length > 600) logs.shift();
    if (!show(e)) return;
    const atEnd = elLogs.scrollHeight - elLogs.scrollTop - elLogs.clientHeight < 24;
    elLogs.insertAdjacentHTML('beforeend', rowHtml(e));
    while (elLogs.children.length > 600) elLogs.firstChild.remove();
    if (atEnd) elLogs.scrollTop = elLogs.scrollHeight;
  }
  const localLog = (sev, msg) => pushLog({ ts: Date.now(), sev, tag: 'APP', msg });

  app.querySelectorAll('.app-tab').forEach((tab) => tab.addEventListener('click', () => { filter = tab.dataset.filter; renderLogs(); }));
  intercept('#appClear', async () => { pop('[data-i="32"]'); logs = []; renderLogs(); await api.clearLogs(); });
  intercept('#appCopy', () => {
    pop('[data-i="33"]');
    const text = logs.filter(show).map((e) => '[' + hms(e.ts) + '] [' + (SEV[e.sev] || SEV.info)[0] + '] ' + e.msg).join('\n');
    api.copy(text);
  });

  /* ---------- actions ---------- */
  const msaOn = () => app.classList.contains('is-account-on');
  const version = () => verLabel.textContent.trim();

  function cleanServer(v) { return String(v || '').trim().replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '').trim(); }

  async function getAddress() {
    if (st.phase !== 'idle' || busy) return;
    const server = cleanServer(srv.value);
    if (!server || /\s/.test(server)) { deny(['[data-i="21"]', '[data-i="22"]']); srv.focus(); return; }
    srv.value = server;
    ls('server', server); ls('version', version()); ls('msa', msaOn() ? '1' : '0');
    busy = true;
    setState({ phase: 'connecting' });
    const tok = fx.on(app, 'Getting address\u2026');
    let r;
    try { r = await api.open(server, version(), msaOn()); } catch { r = { ok: false, error: 'internal' }; }
    await fx.min(tok, 950);
    busy = false;
    fx.off(app, !!r.ok);
    if (r.ok && window.hiderSettings && window.hiderSettings.autoCopy() && r.address) api.copy(r.address);
    if (!r.ok) {
      const msg = { bad_server: 'Enter a valid server address', offline: 'No connection to the Hider server', busy: 'A session is already running', engine: 'App engine is locked \u2014 reconnect or contact the admin' }[r.error];
      if (msg) localLog('err', msg);
      deny(['[data-i="12"]', '[data-i="13"]']);
      setState({ phase: 'idle', address: '' });
    }
  }
  intercept('#appGet', getAddress);
  srv.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); getAddress(); } });

  intercept('#appRole', async () => {
    if (!st.canSwitch) return deny(['[data-i="16"]', '[data-i="17"]', '[data-i="18"]', '[data-i="19"]']);
    const r = await api.switchRole();
    if (!r || !r.ok) deny(['[data-i="16"]', '[data-i="17"]', '[data-i="18"]', '[data-i="19"]']);
  });
  intercept('#appBan', async () => {
    if (st.phase === 'idle') return deny(['[data-i="20"]']);
    if (busy) return;
    busy = true;
    const tok = fx.on(app, 'Closing session\u2026');
    try { await api.stop(); } catch { /* ignore */ }
    await fx.min(tok, 800);
    busy = false;
    fx.off(app, true);
  });

  intercept('#liveChip', () => {
    if (!st.address) return;
    api.copy(st.address);
    elChip.classList.add('is-copied');
    setTimeout(() => elChip.classList.remove('is-copied'), 700);
  });

  /* the server field / version / toggle are remembered */
  verOpts.forEach((o) => o.addEventListener('click', () => { if (st.phase !== 'idle') return; ls('version', o.dataset.version); }));
  document.addEventListener('click', (e) => {
    // keep the version list closed while a session runs
    if (st.phase !== 'idle' && e.target.closest && e.target.closest('#appVersion')) { e.stopImmediatePropagation(); }
  }, true);

  /* ---------- sign in / out ---------- */
  function setErr(msg) {
    loginErr.textContent = msg || '';
    loginErr.classList.toggle('is-on', !!msg);
  }
  function shake() {
    loginWin.classList.remove('shake');
    void loginWin.offsetWidth;
    loginWin.classList.add('shake');
    setTimeout(() => loginWin.classList.remove('shake'), 420);
  }
  const ERR = { hwid: 'This account is bound to another PC. Reset HWID in the Telegram bot (Profile)', 'server-auth': 'Server identity check failed (fake server)', proto: 'Protocol error, update the app',
    empty: 'Enter your Telegram username and license key', invalid: 'Invalid Telegram username or license key', expired: 'Your subscription has expired. Renew it in the Telegram bot', banned: 'This account is blocked', unavailable: 'Server is busy, try again in a moment', network: 'Cannot reach the Hider server',
    rate: 'Too many attempts, wait a minute', internal: 'Something went wrong'
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (busy) return;
    const u = user.value.trim();
    const k = pass.value;
    if (!u || !k) { setErr(ERR.empty); shake(); (u ? pass : user).focus({ preventScroll: true }); return; }
    busy = true;
    setErr('');
    loginWin.classList.add('submitting', 'is-wait');
    const tok = fx.on(loginWin, 'Signing in\u2026');
    let r;
    try { r = await api.login(u, k); } catch { r = { ok: false, error: 'internal' }; }
    loginWin.classList.remove('submitting', 'is-wait');
    if (!r.ok) {
      await fx.min(tok, 450);
      busy = false;
      fx.off(loginWin, false);
      setErr(ERR[r.error] || ERR.internal); shake();
      return;
    }
    await fx.min(tok, 900);
    await toApp();
    busy = false;
  });
  [user, pass].forEach((el) => el.addEventListener('input', () => setErr('')));

  // login window is blurred: swap to the app page behind the blur, then lift it and replay the entrance
  async function toApp() {
    fx.on(app, 'Signing in\u2026');
    enter(true);
    await fx.sleep(380);
    fx.clear(loginWin);
    await fx.sleep(120);
    fx.off(app, true);
  }

  function enter(hold) {
    pass.value = '';
    pass.dispatchEvent(new Event('input'));
    ls('user', user.value.trim());
    document.dispatchEvent(new CustomEvent('hider:login', { detail: { hold: !!hold } }));
  }

  intercept('#appCardArrow', async () => {
    if (busy) return;
    busy = true;
    const tok = fx.on(app, 'Signing out\u2026');
    try { await api.logout(); } catch { /* ignore */ }
    logs = []; renderLogs();
    setState({ authed: false, phase: 'idle', clients: [], address: '', profile: null, canSwitch: false });
    await fx.min(tok, 800);
    fx.on(loginWin, '');
    document.dispatchEvent(new CustomEvent('hider:logout'));
    await fx.sleep(400);
    fx.clear(app);
    fx.off(loginWin, false);
    busy = false;
  });
  $('appCardArrow').setAttribute('aria-label', 'Sign out');
  $('appCardArrow').title = 'Sign out';

  /* ---------- backend events ---------- */
  api.on('state', (s) => setState(s));
  api.on('log', pushLog);
  api.on('logs', (a) => { logs = a.slice(); renderLogs(); });

  /* ---------- init ---------- */
  (async () => {
    // remembered fields; the demo prefill from the mock-up is gone
    srv.value = ls('server') || '';
    srv.placeholder = 'Server address';
    const v = ls('version');
    const pick = verOpts.find((o) => o.dataset.version === v) || verOpts.find((o) => o.dataset.version === '1.21.11') || verOpts[0];
    if (pick) { verOpts.forEach((o) => o.setAttribute('aria-selected', String(o === pick))); verLabel.textContent = pick.dataset.version; }
    if (ls('msa') === '1') { app.classList.add('is-account-on'); $('appToggle').setAttribute('aria-checked', 'true'); }

    let init;
    try { init = await api.init(); } catch { init = { ok: false }; }
    user.value = (init && init.lastUser) || ls('user') || '';
    pass.value = '';
    user.placeholder = 'Telegram username';
    pass.placeholder = 'License key';
    user.dispatchEvent(new Event('input'));
    pass.dispatchEvent(new Event('input'));
    if (init && init.ok) {
      logs = (init.logs || []).slice();
      st = Object.assign(st, init.state || {});
      renderLogs(); render();
      if (st.authed) { enter(); return; }
      // silent sign-in with the stored token
      if (init.lastUser) {
        let r;
        const tok = fx.on(loginWin, 'Signing in\u2026');
        try { r = await api.resume(); } catch { r = { ok: false }; }
        if (r && r.ok) { await fx.min(tok, 800); await toApp(); } else fx.off(loginWin, false);
      }
    }
  })();
})();
