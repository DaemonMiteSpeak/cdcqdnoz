'use strict';
// Resource-pack plumbing: serves ONE merged pack (server pack + the converted models) from 127.0.0.1 and keeps the
// client <-> server resource pack dialogue consistent.
//   server pack present            -> download, merge, serve, forward the packet with our url/sha1 (same uuid)
//   server sends nothing           -> push a stand-alone pack (own uuid) as soon as something has to be displayed
//   server pack later/changed/gone -> follows the server's packets (stand-alone pack is dropped / restored)
//   statuses of the client         -> forwarded to the server unchanged, those of the stand-alone pack are swallowed
//   download / merge failure       -> the original packet is forwarded untouched
const http = require('http'), https = require('https'), crypto = require('crypto');
const { readZipEx } = require('./zip');

const sha1 = b => crypto.createHash('sha1').update(b).digest('hex');
const ST_CFG = 'configuration', ST_PLAY = 'play';

class PackServer {
  constructor() { this.map = new Map(); this.srv = null; this.port = 0; this.starting = null; }
  start() {
    if (this.srv) return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => {
        const e = this.map.get(req.url.split('?')[0]);
        if (!e || (req.method !== 'GET' && req.method !== 'HEAD')) { res.statusCode = 404; return res.end(); }
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': e.length, 'Cache-Control': 'no-store' });
        if (req.method === 'HEAD') return res.end();
        res.end(e);
      });
      srv.on('error', reject);
      srv.listen(0, '127.0.0.1', () => { this.srv = srv; this.port = srv.address().port; srv.unref(); resolve(); });
    });
    return this.starting;
  }
  async add(buf) {
    await this.start();
    const p = '/' + crypto.randomBytes(9).toString('hex') + '/' + crypto.randomBytes(5).toString('hex') + '.zip';
    this.map.set(p, buf);
    return 'http://127.0.0.1:' + this.port + p;
  }
  drop(url) { try { this.map.delete(new URL(url).pathname); } catch { /* ignore */ } }
  stop() { try { this.srv && this.srv.close(); } catch { /* ignore */ } this.srv = null; this.starting = null; this.map.clear(); }
}

function download(url, opts, depth) {
  opts = opts || {}; depth = depth || 0;
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(url); } catch { return reject(new Error('bad url')); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return reject(new Error('unsupported scheme'));
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, { headers: { 'User-Agent': 'Minecraft Java/1' }, timeout: opts.timeout || 45000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); if (depth > 5) return reject(new Error('too many redirects'));
        return download(new URL(res.headers.location, u).toString(), opts, depth + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('http ' + res.statusCode)); }
      const max = opts.max || 400 * 1024 * 1024; const chunks = []; let n = 0;
      res.on('data', c => { n += c.length; if (n > max) { req.destroy(new Error('pack too large')); return; } chunks.push(c); });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

class PackManager {
  // s: Session; cos: object with { available(), pack (CosmeticPack), wantStandalone() }
  constructor(s, cos, server) {
    this.s = s; this.cos = cos; this.server = server || new PackServer();
    this.cache = new Map();          // key (server sha1 | url) -> { url, hash }
    this.merged = new Map();         // uuid(server) -> { url, hash }
    this.serverPacks = new Set();    // uuids the server currently has on the client
    this.own = null;                 // { uuid, url, hash } of the stand-alone pack
    this.pending = 0; this.waiters = [];
    this.playPacks = [];             // add packets (play phase) to replay to late peers: { uuid, buf }
  }
  get active() { return !!(this.cos && this.cos.available()); }
  idle(cb) { if (!this.pending) cb(); else this.waiters.push(cb); }
  _done() { if (!--this.pending) { const w = this.waiters.splice(0); for (const f of w) f(); } }
  reset() { this.serverPacks.clear(); this.merged.clear(); this.own = null; this.playPacks = []; }
  dispose() { this.server.stop(); }

  log(sev, msg) { this.s.log(sev, 'PACK', msg); }
  newUuid() { return crypto.randomUUID(); }

  // ---- server -> client ----
  // returns true when the packet is taken over (the manager forwards it itself, possibly asynchronously)
  handleUp(state, name, d, buf, entry) {
    if (!this.active) return false;
    if (name === 'add_resource_pack') { this.onAdd(state, d, buf, entry); return true; }
    if (name === 'remove_resource_pack') this.onRemove(state, d);   // forwarded by the caller as usual
    return false;
  }

  emit(state, name, params, entry) {
    const s = this.s;
    const buf = state === ST_CFG ? s.buildCfg(name, params) : s.build(name, params);
    if (!buf) return null;
    if (entry) entry.buf = buf;
    return buf;
  }
  deliver(state, buf) { for (const p of this.s.peers) if (p.attached) p.send(buf, state === ST_CFG ? ST_CFG : ST_PLAY); }

  async onAdd(state, d, origBuf, entry) {
    this.pending++;
    const orig = () => { if (state === ST_PLAY) this.playPacks.push({ uuid: d.uuid, buf: origBuf }); this.deliver(state, origBuf); };
    try {
      const uuid = d.uuid;
      this.serverPacks.add(uuid);
      let m = null;
      const key = (d.hash && /^[0-9a-f]{40}$/i.test(d.hash)) ? d.hash.toLowerCase() : null;
      if (key && this.cache.has(key)) m = this.cache.get(key);
      if (!m) {
        const body = await download(d.url);
        const h = sha1(body);
        if (key && h !== key) throw new Error('server pack hash mismatch');
        const ck = h; m = this.cache.get(ck);
        if (!m) {
          const base = readZipEx(body);
          const out = this.cos.pack.build(this.s.version, this.s.pv, base);
          m = { url: await this.server.add(out), hash: sha1(out) };
          this.cache.set(ck, m);
        }
        if (key) this.cache.set(key, m);
      }
      this.merged.set(uuid, m);
      const params = { uuid, url: m.url, hash: m.hash, forced: d.forced, promptMessage: d.promptMessage };
      const buf = this.emit(state, 'add_resource_pack', params, entry);
      if (!buf) throw new Error('cannot serialise packet');
      if (state === ST_PLAY) this.playPacks.push({ uuid, buf });
      this.deliver(state, buf);
      this.log('info', 'server pack merged (' + this.cache.size + ' cached)');
      this.dropOwn();
    } catch (e) {
      this.log('warn', 'server pack passed through unchanged: ' + e.message);
      orig();
    } finally { this._done(); }
  }

  onRemove(state, d) {
    if (d.uuid) { this.serverPacks.delete(d.uuid); this.merged.delete(d.uuid); this.playPacks = this.playPacks.filter(p => p.uuid !== d.uuid); }
    else { this.serverPacks.clear(); this.merged.clear(); this.playPacks = this.playPacks.filter(p => this.own && p.uuid === this.own.uuid); }
    if (!this.serverPacks.size) setTimeout(() => this.ensureOwn(), 50);
  }

  // ---- stand-alone pack ----
  needOwn() { return this.active && !this.serverPacks.size && this.cos.wantStandalone(); }
  async ensureOwn() {
    if (this.own || !this.needOwn() || this.ownBusy) return;
    if (this.s.up && this.s.up.state !== ST_PLAY) return;
    this.ownBusy = true;
    try {
      const out = this.cos.pack.build(this.s.version, this.s.pv, null);
      const url = await this.server.add(out);
      this.own = { uuid: this.newUuid(), url, hash: sha1(out) };
      const buf = this.s.build('add_resource_pack', { uuid: this.own.uuid, url, hash: this.own.hash, forced: false, promptMessage: undefined });
      if (!buf) throw new Error('cannot serialise packet');
      this.playPacks.push({ uuid: this.own.uuid, buf });
      this.deliver(ST_PLAY, buf);
      this.log('info', 'pack sent');
    } catch (e) { this.log('warn', 'pack not sent: ' + e.message); this.own = null; }
    finally { this.ownBusy = false; }
  }
  dropOwn() {
    if (!this.own) return;
    const o = this.own; this.own = null;
    this.playPacks = this.playPacks.filter(p => p.uuid !== o.uuid);
    const buf = this.s.build('remove_resource_pack', { uuid: o.uuid });
    if (buf) this.deliver(ST_PLAY, buf);
    this.server.drop(o.url);
  }

  // ---- client -> server ----
  // true = swallow
  handleClient(name, d) {
    if (name !== 'resource_pack_receive') return false;
    return !!(this.own && d && d.uuid === this.own.uuid);
  }

  replayTo(peer) { for (const p of this.playPacks) peer.send(p.buf, ST_PLAY); }
}

module.exports = { PackManager, PackServer, download, sha1 };
