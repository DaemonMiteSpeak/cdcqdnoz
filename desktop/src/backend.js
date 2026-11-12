'use strict';
// Hider backend (runs in the Electron main process).
//  - real login against the Hider relay on the VPS (token is stored, key is never stored)
//  - control WebSocket to the relay; the relay hands out an address and tunnels raw TCP of Minecraft
//    clients to this app; the app forwards every tunnel connection to its OWN embedded Minecraft proxy,
//    which talks to the real server from this PC (so the game server never sees the VPS IP).
//  - logs are kept on the relay (persisted per user) and mirrored here.
const EventEmitter = require('events');
const https = require('https');
const net = require('net');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const crypto = require('crypto');
const os = require('os');
const { execFileSync } = require('child_process');
const sec = require('./secure');
// The proxy engine (Session) ships ENCRYPTED in src/engine.bin and is decrypted in memory only
// with the key the relay delivers in the sealed hello - so it can't run offline or when cracked.
const { loadEngine } = require('./engineloader');
const versions = require('./versions');
const { normalize } = versions;

const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'relay-config.json'), 'utf8'));
const COSCAT = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'cosmetics', 'catalog.json'), 'utf8')); } catch { return { slots: [], items: [] }; } })();
const CA = fs.readFileSync(path.join(__dirname, 'relay.pem'));
const MAX_LOGS = 600;
// Ed25519 public identity of the real Hider server: a fake/emulated server cannot sign the handshake.
const SERVER_PUB = 'gRUT6RzeHqUk9oc8gactqqpJ-XOTIki-lV_0Sg-ZsrU';
const pad = () => crypto.randomBytes(1 + (crypto.randomBytes(1)[0] % 40)).toString('base64url');
let HWID = null;
function getHwid() {
  if (HWID) return HWID;
  const parts = [process.platform, process.arch];
  let guid = '';
  if (process.platform === 'win32') {
    try {
      const regPath = ['HKLM', 'SOFTWARE', 'Microsoft', 'Cryptography'].join(path.win32.sep);
      const out = execFileSync('reg', ['query', regPath, '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      const i = out.indexOf('REG_SZ');
      if (i !== -1) guid = out.slice(i + 6).trim().split(' ')[0];
    } catch { /* ignore */ }
  }
  parts.push(guid || os.hostname());
  try { const c = os.cpus(); if (c && c[0]) parts.push(c[0].model, String(c.length)); } catch { /* ignore */ }
  parts.push(String(Math.round(os.totalmem() / 1073741824)));
  HWID = crypto.createHash('sha256').update('hider-hwid-v1|' + parts.join('|')).digest('hex');
  return HWID;
}

function frame(id, data) {
  const h = Buffer.allocUnsafe(4);
  h.writeUInt32BE(id, 0);
  return Buffer.concat([h, data]);
}

class Backend extends EventEmitter {
  // opts: { dir, encrypt(str)->b64, decrypt(b64)->str, openExternal(url), copy(text), config }
  constructor(opts) {
    super();
    this.o = opts;
    this.cfg = Object.assign({}, CFG, opts.config || {});
    fs.mkdirSync(opts.dir, { recursive: true });
    this.file = path.join(opts.dir, 'session.json');
    this.store = this.readStore();
    this.token = null; this.profile = null;
    this.ws = null; this.wantWs = false; this.retry = 0; this.retryTimer = null; this.lastSeen = 0; this.watchdog = null;
    this.conn = 'offline';
    this.logs = [];
    this.sess = null; this.phase = 'idle'; this.address = ''; this.server = ''; this.version = ''; this.msa = false;
    this.tunnels = new Map(); this.ipByPort = new Map();
    this.pendingLogs = [];
    this.openWait = null;
    this.presence = { users: [] }; this.online = 0; this.lastIdent = '';
  }

  /* ---------- persistence ---------- */
  readStore() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return {}; } }
  saveStore() { try { fs.writeFileSync(this.file, JSON.stringify(this.store)); } catch { /* ignore */ } }
  lastUser() { return this.store.user || ''; }
  versions() { return this.srvVersions || this.cfg.versions || []; }
  prefs() { const p = this.store.prefs || {}; return { presence: p.presence !== false }; }
  setPrefs(p) {
    p = p || {};
    const cur = this.prefs();
    if (typeof p.presence === 'boolean') cur.presence = p.presence;
    this.store.prefs = cur; this.saveStore();
    this.applyPrefs(); this.sendPrefs(); this.pushState();
    return cur;
  }
  /* ---------- cosmetics (the relay host keeps the authoritative copy; this is the local cache) ---------- */
  catalog() { return COSCAT; }
  cosState() { const c = this.store.cos || {}; return { equipped: c.equipped || {}, dirty: !!c.dirty }; }
  cleanCos(eq) {
    const out = {}; if (!eq || typeof eq !== 'object') return out;
    for (const it of COSCAT.items) if (eq[it.slot] === it.id) out[it.slot] = it.id;
    return out;
  }
  setCosmetics(eq) {
    const equipped = this.cleanCos(eq);
    this.cosSeq = (this.cosSeq || 0) + 1;
    this.store.cos = { equipped, dirty: true }; this.saveStore();
    this.applyCosmetics();
    this.sendCosmetics();
    this.pushState();
    return { ok: true, equipped };
  }
  sendCosmetics() { this.sendJson({ t: 'cosmetics', equipped: this.cosState().equipped, seq: this.cosSeq || 0 }); }
  setCosSelfView(v) { this.store.cosSelf = !!v; this.saveStore(); this.applyCosSelf(); this.pushState(); return { ok: true, selfView: !!v }; }
  applyCosSelf() { if (this.sess && this.sess.cos) { try { this.sess.cos.setSelfView(!!this.store.cosSelf); } catch { /* ignore */ } } }
  applyCosmetics() { if (this.sess && this.sess.cos) { try { this.sess.cos.setOwn(this.cosState().equipped); } catch { /* ignore */ } } }
  applyPrefs() { if (this.sess) this.sess.nt.setEnabled(this.prefs().presence); }
  sendPrefs() { this.sendJson({ t: 'prefs', visible: this.prefs().presence }); }
  // tell the relay which in-game nick/server this user is on (other Hider users get labeled with it)
  sendIdent() {
    const s = this.sess; let nick = null;
    if (s && !s.closed && s.ready) nick = (s.up && s.up.username) || s.nick || null;
    const server = nick ? this.server : '';
    const key = nick ? nick + '@' + server : '';
    if (key === this.lastIdent) return;
    this.lastIdent = key;
    this.sendJson({ t: 'ident', nick, server });
  }

  /* ---------- state ---------- */
  getState() {
    const s = this.sess;
    return {
      authed: !!this.profile, profile: this.profile, conn: this.conn, phase: this.phase,
      address: this.address, server: this.server, version: this.version, msa: this.msa,
      clients: s ? s.clientsInfo() : [], canSwitch: !!(s && !s.closed && s.canSwitch()),
      prefs: this.prefs(), online: this.online, cosmetics: this.cosState().equipped
    };
  }
  pushState() { this.emit('state', this.getState()); }

  addLog(e, send) {
    const entry = { ts: e.ts || Date.now(), sev: e.sev || 'info', tag: e.tag || '', msg: String(e.msg || '') };
    this.logs.push(entry);
    if (this.logs.length > MAX_LOGS) this.logs.shift();
    this.emit('log', entry);
    if (send) {
      if (this.ws && this.ws.readyState === 1 && this.ws._hk && this.conn === 'online') this.sendJson({ t: 'log', e: entry });
      else { this.pendingLogs.push(entry); if (this.pendingLogs.length > 300) this.pendingLogs.shift(); }
    }
    return entry;
  }
  setLogs(arr) { this.logs = arr.slice(-MAX_LOGS); this.emit('logs', this.logs); }

  /* ---------- login: everything goes through the encrypted, server-authenticated channel ---------- */
  authPayload() {
    const hwid = getHwid();
    if (this.loginCreds) return { t: 'auth', mode: 'login', username: this.loginCreds.username, key: this.loginCreds.key, hwid };
    if (this.token) return { t: 'auth', mode: 'resume', token: this.token, hwid };
    return null;
  }

  authWait(ms) {
    return new Promise(resolve => {
      let done = false;
      const fin = (v) => { if (done) return; done = true; clearTimeout(t); this.off('hello', onH); this.off('auth-failed', onF); resolve(v); };
      const onH = () => fin({ ok: true });
      const onF = (reason) => fin({ ok: false, error: reason || 'invalid' });
      const t = setTimeout(() => fin({ ok: false, error: 'network' }), ms);
      this.once('hello', onH);
      this.once('auth-failed', onF);
      this.connectWs();
    });
  }

  async login(username, key) {
    username = String(username || '').trim(); key = String(key || '');
    if (!username || !key) return { ok: false, error: 'empty' };
    this.disconnectWs();
    this.token = null; this.helloSeen = false;
    this.loginCreds = { username, key };
    const r = await this.authWait(12000);
    this.loginCreds = null;
    if (!r.ok) { this.disconnectWs(); this.token = null; this.profile = null; this.pushState(); return r; }
    return { ok: true, profile: this.profile };
  }

  waitOnline(ms) {
    if (this.conn === 'online') return Promise.resolve(true);
    return new Promise(resolve => {
      const t = setTimeout(() => { this.off('hello', h); resolve(this.conn === 'online'); }, ms);
      const h = () => { clearTimeout(t); resolve(true); };
      this.once('hello', h);
    });
  }

  // silent login with a stored token (still HWID-checked by the server)
  async resume() {
    if (!this.store.token || !this.o.decrypt) return { ok: false };
    let tok = null;
    try { tok = this.o.decrypt(this.store.token); } catch { /* ignore */ }
    if (!tok) return { ok: false };
    this.token = tok; this.loginCreds = null;
    const r = await this.authWait(9000);
    if (!r.ok) {
      this.disconnectWs(); this.token = null;
      if (r.error !== 'network') { delete this.store.token; this.saveStore(); }
      return { ok: false, error: r.error };
    }
    return { ok: true, profile: this.profile };
  }

  logout() {
    this.closeSession('logout');
    this.disconnectWs();
    this.token = null; this.profile = null; this.logs = []; this.helloSeen = false; this.loginCreds = null; this.srvVersions = null;
    delete this.store.token; delete this.store.cos; this.cosSeq = 0; this.saveStore();
    this.pushState();
  }

  /* ---------- control websocket ---------- */
  sendJson(o) { const ws = this.ws; if (ws && ws.readyState === 1 && ws._hk) { try { ws.send(sec.seal(ws._hk.tx, Object.assign({}, o, { _p: pad() }))); } catch { /* ignore */ } } }

  connectWs() {
    clearTimeout(this.retryTimer);
    this.wantWs = true;
    if (this.ws) { try { this.ws.terminate(); } catch { /* ignore */ } this.ws = null; }
    this.conn = 'connecting'; this.pushState();
    const url = 'wss://' + this.cfg.host + ':' + this.cfg.port + '/ws';
    const ws = new WebSocket(url, { ca: CA, handshakeTimeout: 10000, perMessageDeflate: false, maxPayload: 16 * 1024 * 1024 });
    this.ws = ws;
    ws._hk = null;
    const hs = sec.clientHello(SERVER_PUB);
    ws.on('open', () => { this.lastSeen = Date.now(); try { ws.send(JSON.stringify(hs.hello)); } catch { /* ignore */ } });
    ws.on('ping', () => { this.lastSeen = Date.now(); });
    ws.on('pong', () => { this.lastSeen = Date.now(); });
    ws.on('unexpected-response', (_req, res) => {
      if (res.statusCode === 401 || res.statusCode === 404) { this.wantWs = false; this.emit('auth-failed', 'invalid'); }
    });
    ws.on('error', () => { /* handled by close */ });
    ws.on('message', (data, isBinary) => {
      this.lastSeen = Date.now();
      if (isBinary) { if (ws._hk) this.onBinary(data); return; }
      if (!ws._hk) {
        try { ws._hk = hs.finish(JSON.parse(data.toString())); } catch {
          this.wantWs = false;
          this.addLog({ sev: 'err', tag: 'NET', msg: 'Server identity check failed: this is not the real Hider server.' });
          this.emit('auth-failed', 'server-auth');
          try { ws.terminate(); } catch { /* ignore */ }
          return;
        }
        const a = this.authPayload();
        if (!a) { this.wantWs = false; try { ws.terminate(); } catch { /* ignore */ } return; }
        try { ws.send(sec.seal(ws._hk.tx, Object.assign(a, { _p: pad() }))); } catch { /* ignore */ }
        return;
      }
      let m; try { m = sec.open(ws._hk.rx, data.toString()); } catch { return; }
      this.onMessage(m);
    });
    ws.on('close', (code) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.dropTunnels();
      const was = this.conn === 'online';
      this.conn = 'offline';
      if (was) this.addLog({ sev: 'warn', tag: 'NET', msg: 'Connection to Hider server lost. Reconnecting...' });
      this.pushState();
      if (code === 4000) { this.wantWs = false; this.addLog({ sev: 'warn', tag: 'NET', msg: 'This account was opened on another device. Press Get address to take over again.' }); return; }
      if (code === 4003 || code === 4005) { this.wantWs = false; return; }
      if (this.wantWs && this.token) {
        const wait = Math.min(1000 * Math.pow(2, this.retry++), 10000);
        this.retryTimer = setTimeout(() => this.connectWs(), wait);
      }
    });
    clearInterval(this.watchdog);
    this.watchdog = setInterval(() => {
      if (!this.ws) return;
      if (Date.now() - this.lastSeen > 50000) { try { this.ws.terminate(); } catch { /* ignore */ } return; }
      this.sendJson({ t: 'ping' });
    }, 15000);
  }

  disconnectWs() {
    this.wantWs = false;
    clearTimeout(this.retryTimer); clearInterval(this.watchdog);
    this.dropTunnels();
    if (this.ws) { const w = this.ws; this.ws = null; try { w.close(); } catch { /* ignore */ } }
    this.conn = 'offline';
  }

  onMessage(m) {
    switch (m.t) {
      case 'hello': {
        this.retry = 0; this.conn = 'online';
        this.profile = { name: m.name, tag: m.tag, until: m.until, created: m.created };
        if (m.token) { this.token = m.token; this.store.token = this.o.encrypt ? this.o.encrypt(m.token) : null; }
        if (m.name) this.store.user = m.name;
        this.saveStore();
        if (m.protoPatches) { try { versions.installPatches(m.protoPatches); } catch (e) { /* ignore */ } }
        if (m.engineKey && !this.engine) {
          try { this.engine = loadEngine(m.engineKey); }
          catch (e) { this.addLog({ sev: 'err', tag: 'PROXY', msg: 'Engine unlock failed: ' + ((e && e.message) || e) }); }
        }
        if (Array.isArray(m.versions) && m.versions.length) this.srvVersions = m.versions.map(String);
        if (this.engine && this.engine.setCosmeticAssets && !this.cosAssets) this.sendJson({ t: 'cosreq' });
        if (!this.helloSeen) { this.setLogs(m.history || []); this.helloSeen = true; }
        this.flushLogs();
        this.lastIdent = ''; this.sendPrefs(); this.sendIdent();
        { const c = this.cosState(); if (c.dirty) this.sendCosmetics(); else { this.store.cos = { equipped: this.cleanCos(m.cosmetics), dirty: false }; this.saveStore(); this.applyCosmetics(); } }
        this.pendingResume = true;
        this.emit('hello');
        this.pushState();
        // if a local session is running and the relay did not resume it, re-open it
        setTimeout(() => {
          if (this.pendingResume && this.sess && !this.sess.closed && this.ws) {
            this.pendingResume = false;
            this.addLog({ sev: 'warn', tag: 'RELAY', msg: 'Address expired while offline, creating a new one…' }, true);
            this.sendJson({ t: 'open', server: this.server, version: this.version });
          }
        }, 400);
        break;
      }
      case 'resumed': {
        this.pendingResume = false;
        this.address = m.address;
        this.addLog({ sev: 'info', tag: 'NET', msg: 'Reconnected, address ' + m.address + ' is still active' });
        this.pushState();
        break;
      }
      case 'opened': {
        this.pendingResume = false;
        this.address = m.address;
        if (this.openWait) { this.openWait.resolve(m); this.openWait = null; }
        this.pushState();
        break;
      }
      case 'presence': {
        this.presence = { users: Array.isArray(m.users) ? m.users : [] };
        this.online = m.online | 0;
        if (this.sess) { this.sess.nt.setPresence(this.presence.users); this.sess.cos.setPresence(this.presence.users); }
        this.pushState();
        break;
      }
      case 'cosmetics': {
        if (m.ack) { if (m.seq === (this.cosSeq || 0) || !this.cosSeq) { this.store.cos = { equipped: this.cleanCos(m.equipped), dirty: false }; this.saveStore(); this.applyCosmetics(); this.pushState(); } }
        break;
      }
      case 'authfail': {
        this.wantWs = false;
        if (m.reason === 'hwid') this.addLog({ sev: 'err', tag: 'AUTH', msg: 'This key is bound to another PC (HWID). Ask the admin to reset it.' });
        this.emit('auth-failed', String(m.reason || 'invalid'));
        break;
      }
      case 'kill': {
        // the server ended this session (subscription expired / revoked / signed in elsewhere)
        this.wantWs = false;
        const map = { expired: 'Your subscription has expired.', revoked: 'Your access was revoked by the admin.', deleted: 'This account no longer exists.', 'another-device': 'Signed in on another device.' };
        this.addLog({ sev: 'err', tag: 'AUTH', msg: map[m.reason] || 'Session ended by the server.' });
        this.closeSession('server ended session', true);
        this.token = null; this.profile = null; this.helloSeen = false;
        delete this.store.token; this.saveStore();
        this.emit('auth-failed', String(m.reason || 'revoked'));
        this.pushState();
        break;
      }
      case 'cosassets': {
        if (this.engine && this.engine.setCosmeticAssets && m && m.catalog && m.items) {
          try { if (this.engine.setCosmeticAssets({ catalog: m.catalog, items: m.items })) { this.cosAssets = true; this.applyCosmetics(); } } catch { /* ignore */ }
        }
        break;
      }
      case 'closed': break;
      case 'error': {
        if (m.for === 'open' && this.openWait) { this.openWait.reject(new Error(m.message)); this.openWait = null; }
        else this.addLog({ sev: 'err', tag: 'RELAY', msg: String(m.message) });
        break;
      }
      case 'log': if (m.e) this.addLog(m.e, false); break;
      case 'c_open': this.tunnelOpen(m.id, m.ip); break;
      case 'c_close': {
        const t = this.tunnels.get(m.id);
        if (t) { this.tunnels.delete(m.id); t.sock.destroy(); }
        break;
      }
      default: break;
    }
  }

  flushLogs() {
    const q = this.pendingLogs; this.pendingLogs = [];
    for (const e of q) this.sendJson({ t: 'log', e });
  }

  /* ---------- tunnel: relay connection <-> local proxy ---------- */
  tunnelOpen(id, ip) {
    const s = this.sess;
    if (!s || s.closed || !s.port0) { this.sendJson({ t: 'c_close', id }); return; }
    const sock = net.connect({ host: '127.0.0.1', port: s.port0 });
    sock.setNoDelay(true);
    const t = { sock, ip, port: 0 };
    this.tunnels.set(id, t);
    sock.on('connect', () => { t.port = sock.localPort; this.ipByPort.set(t.port, ip); });
    sock.on('data', d => {
      const ws = this.ws;
      if (!ws || ws.readyState !== 1) return;
      ws.send(frame(id, d), { binary: true, compress: false });
      if (ws.bufferedAmount > 4e6 && !sock.isPaused()) {
        sock.pause();
        const iv = setInterval(() => { if (!this.ws || this.ws.bufferedAmount < 5e5 || sock.destroyed) { clearInterval(iv); sock.resume(); } }, 40);
      }
    });
    sock.on('error', () => { /* close follows */ });
    sock.on('close', () => {
      if (t.port) this.ipByPort.delete(t.port);
      if (this.tunnels.get(id) === t) { this.tunnels.delete(id); this.sendJson({ t: 'c_close', id }); }
    });
  }

  onBinary(data) {
    if (data.length < 5) return;
    const t = this.tunnels.get(data.readUInt32BE(0));
    if (t && !t.sock.destroyed) t.sock.write(data.subarray(4));
  }

  dropTunnels() {
    for (const t of this.tunnels.values()) t.sock.destroy();
    this.tunnels.clear(); this.ipByPort.clear();
  }

  /* ---------- sessions ---------- */
  async open(server, version, msa) {
    if (this.sess) return { ok: false, error: 'busy' };
    server = String(server || '').trim();
    version = normalize(version);
    if (!server || /\s/.test(server)) return { ok: false, error: 'bad_server' };
    if (this.conn !== 'online') { if (!this.ws && this.token) this.connectWs(); await this.waitOnline(10000); }
    if (!this.ws || this.ws.readyState !== 1 || this.conn !== 'online') return { ok: false, error: 'offline' };
    const Session = this.engine && this.engine.Session;
    if (typeof Session !== 'function') { this.addLog({ sev: 'err', tag: 'PROXY', msg: 'Engine not unlocked by the server yet.' }, true); return { ok: false, error: 'engine' }; }
    this.phase = 'connecting'; this.server = server; this.version = version; this.msa = !!msa; this.address = '';
    this.pushState();
    let s;
    try {
      s = new Session({
        id: 'main', target: server, version,
        cosmetics: {},
        auth: msa ? {
          mode: 'microsoft', folder: path.join(this.o.dir, 'auth'), label: this.profile && this.profile.name,
          onCode: (c) => { try { this.o.copy && this.o.copy(c.user_code); this.o.openExternal && this.o.openExternal(c.verification_uri); } catch { /* ignore */ } }
        } : { mode: 'offline' },
        ipLookup: (port) => this.ipByPort.get(port) || ''
      });
      s.on('log', e => this.addLog(e, true));
      s.on('update', () => { this.pushState(); this.sendIdent(); });
      s.nt.setEnabled(this.prefs().presence); s.nt.setPresence(this.presence.users);
      s.cos.setPresence(this.presence.users); s.cos.setOwn(this.cosState().equipped); s.cos.setSelfView(!!this.store.cosSelf);
      s.on('closed', () => this.onSessionClosed(s));
      await s.start();
    } catch (e) {
      this.addLog({ sev: 'err', tag: 'PROXY', msg: 'Cannot start: ' + e.message }, true);
      try { s && s.stop('start failed'); } catch { /* ignore */ }
      this.sess = null; this.phase = 'idle'; this.pushState();
      return { ok: false, error: 'start', message: e.message };
    }
    this.sess = s;
    try {
      const m = await new Promise((resolve, reject) => {
        this.openWait = { resolve, reject };
        setTimeout(() => { if (this.openWait) { this.openWait = null; reject(new Error('relay did not answer')); } }, 10000);
        this.sendJson({ t: 'open', server, version });
      });
      this.phase = 'ready'; this.address = m.address; this.sendIdent();
      this.addLog({ sev: 'info', tag: 'PROXY', msg: 'Session ready: ' + server + ' (' + version + '), join via ' + m.address }, true);
      this.pushState();
      return { ok: true, address: m.address };
    } catch (e) {
      this.addLog({ sev: 'err', tag: 'RELAY', msg: 'Cannot create address: ' + e.message }, true);
      this.closeSession('open failed', true);
      return { ok: false, error: 'relay', message: e.message };
    }
  }

  onSessionClosed(s) {
    if (this.sess !== s) return;
    this.sess = null; this.phase = 'idle'; this.address = '';
    this.dropTunnels();
    this.sendJson({ t: 'close' });
    this.sendIdent();
    this.pushState();
  }

  closeSession(reason, silent) {
    const s = this.sess;
    if (!s) return false;
    if (!silent) this.addLog({ sev: 'info', tag: 'PROXY', msg: 'Session stopped (' + reason + ')' }, true);
    s.stop(reason);
    if (this.sess === s) this.onSessionClosed(s);
    return true;
  }

  stop() { return this.closeSession('stopped by user'); }

  switchRole() {
    const s = this.sess;
    if (!s || !s.canSwitch()) return false;
    const ok = s.switchRole();
    this.pushState();
    return ok;
  }

  clearLogs() {
    this.logs = [];
    this.sendJson({ t: 'clear' });
    this.emit('logs', this.logs);
  }

  shutdown() {
    try { this.closeSession('app quit', true); } catch { /* ignore */ }
    this.disconnectWs();
  }
}

module.exports = { Backend };
