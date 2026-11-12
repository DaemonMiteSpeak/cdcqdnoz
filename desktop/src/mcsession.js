'use strict';
// One Hider session = one local Minecraft server (what players reach through the relay tunnel)
// + one upstream connection to the real server (made from the user's own PC/IP).
//  - 1st client with a nick  -> Controller (its packets go to the real server)
//  - further clients, same nick -> Observers (see the same state, cannot act)
const EventEmitter = require('events');
const mc = require('minecraft-protocol');
const minecraftData = require('minecraft-data');
const nbt = require('prismarine-nbt');
const { createSerializer } = require('minecraft-protocol/src/transforms/serializer');
const { Snapshot } = require('./snapshot');
const { normalize } = require('./versions');
const { Nametags } = require('./nametags');
const { Riders } = require('./riders');
const { Cosmetics } = require('./cosmetics/manager');
const RB = require('./rolebutton');

const ST = { LOGIN: 'login', PLAY: 'play', CONFIG: 'configuration' };
const SYNTH_TID = 1000000000;

function chatText(v) {
  try {
    if (v === undefined || v === null) return '';
    if (typeof v === 'string') {
      try { return chatText(JSON.parse(v)); } catch { return v; }
    }
    if (v && v.type === 'compound') return chatText(nbt.simplify(v));
    if (typeof v === 'object') {
      let s = '';
      if (v.text !== undefined) s += String(v.text);
      if (v.translate && !s) s += String(v.translate);
      if (Array.isArray(v.extra)) for (const e of v.extra) s += chatText(e);
      if (Array.isArray(v)) for (const e of v) s += chatText(e);
      return s.replace(/\u00a7./g, '');
    }
    return String(v);
  } catch { return ''; }
}

class Peer {
  constructor(session, client) {
    this.s = session; this.client = client;
    this.nick = client.username; this.role = null;
    this.attached = false; this.dead = false;
    this.queue = []; this.early = [];
    this.joined = Date.now(); this.lastKA = Date.now(); this.ping = 0; this.kaSent = 0;
    this.ip = ''; this.kaTimer = null; this.lastResync = 0; this.closedWin = false;
    client.on('state', () => this.flush());
  }
  send(buf, st) {
    if (this.dead || !buf) return;
    if (this.queue.length || this.client.state !== st) { this.queue.push([buf, st]); if (this.queue.length > 20000) this.queue.splice(0, 5000); return; }
    try { this.client.writeRaw(buf); } catch { /* socket gone */ }
  }
  flush() {
    while (this.queue.length && this.queue[0][1] === this.client.state) {
      const [b] = this.queue.shift();
      try { this.client.writeRaw(b); } catch { /* socket gone */ }
    }
  }
}

class Session extends EventEmitter {
  // opts: { id, target:'host[:port]', version, auth:{mode, folder, onCode}, ipLookup(port) }
  constructor(opts) {
    super();
    this.id = opts.id; this.version = normalize(opts.version); this.opts = opts;
    const t = String(opts.target || '').trim();
    const m = t.match(/^(.*?)(?::(\d{1,5}))?$/);
    this.host = m[1]; this.port = m[2] ? parseInt(m[2], 10) : undefined;
    this.mcData = minecraftData(this.version);
    if (!this.mcData) throw new Error('Unsupported version ' + this.version);
    this.pv = this.mcData.version.version;
    this.cfgMode = !!this.mcData.supportFeature('hasConfigurationState');
    this.ser = createSerializer({ state: ST.PLAY, isServer: true, version: this.version });
    this.serCfg = this.cfgMode ? createSerializer({ state: ST.CONFIG, isServer: true, version: this.version }) : null;
    this.snap = new Snapshot({ mc: this.mcData, build: (n, p) => this.build(n, p) });
    this.peers = [];
    this.srvPacks = new Map();            // resource packs the server sent in the play phase and nobody else tracks (replayed to late observers)
    this.riders = new Riders(this);
    this.nt = new Nametags(this);
    this.cos = new Cosmetics(this, opts.cosmetics);
    this.nick = null;
    this.primary = null;                  // the first client of the session: the only one that gets the "Switch roles" button
    this.dlgIndex = -1; this.playTags = null;
    this.up = null; this.ready = false; this.cfgLog = [];
    this.pos = null; this.moveDirty = false; this.lastMirror = 0;
    this.serverTids = new Set(); this.dedupe = new Set(); this.synthTid = SYNTH_TID;
    this.sneaking = false; this.sprinting = false; this.inputs = null;
    this.port0 = 0; this.closed = false; this.upReason = '';
    this.stats = { parseErrors: 0 };
  }

  log(sev, tag, msg) { this.emit('log', { sev, tag, msg }); }

  /* ---------- local server ---------- */
  start() {
    return new Promise((resolve, reject) => {
      const self = this;
      this.server = mc.createServer({
        'online-mode': false, host: '127.0.0.1', port: 0, version: this.version, maxPlayers: 16,
        keepAlive: false, hideErrors: true, motd: '\u00a7aHider \u00a77proxy \u2192 ' + this.host,
        beforePing(resp) {
          resp.description = { text: '\u00a7aHider \u00a77\u2192 ' + self.host };
          resp.players = { max: 16, online: self.peers.length, sample: [] };
          return resp;
        }
      });
      this.server.on('error', e => { this.log('err', 'PROXY', 'Local server error: ' + e.message); });
      this.server.on('listening', () => { this.port0 = this.server.socketServer.address().port; resolve(this.port0); });
      this.server.on('login', client => this.onLogin(client));
      this.server.on('connection', client => {
        client.once('set_protocol', p => {
          if (p.nextState === 2 && p.protocolVersion !== this.pv) this.log('warn', 'PROXY', 'Client protocol ' + p.protocolVersion + ' does not match selected version ' + this.version);
        });
        client.on('error', () => { /* handled by end */ });
      });
      setTimeout(() => reject(new Error('local server did not start')), 8000).unref();
    });
  }

  build(name, params) {
    try { return this.ser.createPacketBuffer({ name, params }); } catch (e) { return null; }
  }
  buildCfg(name, params) {
    try { return this.serCfg ? this.serCfg.createPacketBuffer({ name, params }) : null; } catch (e) { return null; }
  }
  buildAny(name, variants) {
    for (const p of variants) { const b = this.build(name, p); if (b) return b; }
    return null;
  }
  hasPacket(name, dir = 'toClient') {
    const t = this.mcData.protocol.play[dir].types; return !!(t && t['packet_' + name]);
  }

  /* ---------- peers ---------- */
  controller() { return this.peers.find(p => p.role === 'controller'); }
  observers() { return this.peers.filter(p => p.role === 'observer'); }
  attachedObservers() { return this.peers.filter(p => p.role === 'observer' && p.attached); }

  clientsInfo() {
    return this.peers.map(p => ({ nick: p.nick, role: p.role, ip: p.ip, ping: p.ping, attached: p.attached }));
  }
  changed() { this.emit('update'); }

  kick(peer, text) {
    const c = peer.client;
    try {
      if (c.state === ST.CONFIG) {
        const reason = c._supportFeature('chatPacketsUseNbtComponents') ? nbt.comp({ text: nbt.string(text) }) : JSON.stringify({ text });
        c.write('disconnect', { reason });
      }
      c.end(text);
    } catch { try { c.socket && c.socket.destroy(); } catch { /* ignore */ } }
  }

  onLogin(client) {
    const peer = new Peer(this, client);
    try { peer.ip = (this.opts.ipLookup && this.opts.ipLookup(client.socket.remotePort)) || ''; } catch { /* ignore */ }
    if (this.closed) return this.kick(peer, 'Session closed');
    if (this.peers.length && this.nick && client.username.toLowerCase() !== this.nick.toLowerCase()) {
      this.log('warn', 'PROXY', 'Rejected ' + client.username + ': nick must be ' + this.nick);
      return this.kick(peer, 'Hider: this address is already used by "' + this.nick + '". Join with the same nick.');
    }
    if (this.peers.length >= 2) return this.kick(peer, 'Hider: too many clients');
    if (!this.peers.length) { this.nick = client.username; peer.role = 'controller'; this.primary = peer; } else peer.role = 'observer';
    this.peers.push(peer);
    this.log('info', 'CLIENT', client.username + ' joined as ' + (peer.role === 'controller' ? 'Controller' : 'Observer') + (peer.ip ? ' (' + peer.ip + ')' : ''));

    client.on('packet', (d, meta, buf) => { try { this.onPeerPacket(peer, d, meta, buf); } catch (e) { this.log('err', 'PROXY', 'peer packet ' + meta.name + ': ' + e.message); } });
    client.on('end', () => this.onPeerEnd(peer));
    client.on('error', e => { /* connection will end */ });

    if (this.cfgMode) {
      client.removeAllListeners('login_acknowledged');
      client.once('login_acknowledged', () => { client.state = ST.CONFIG; this.tryAttach(peer); });
    }
    if (!this.up) this.connectUpstream();
    this.tryAttach(peer);
    this.changed();
  }

  tryAttach(peer) {
    if (peer.attached || peer.dead || !this.ready) return;
    if (this.cos.packs && this.cos.packs.pending) { this.cos.packs.idle(() => this.tryAttach(peer)); return; }
    if (peer.client.state !== (this.cfgMode ? ST.CONFIG : ST.PLAY)) return;
    this.attach(peer);
  }

  attach(peer) {
    peer.attached = true;
    const isCtl = peer.role === 'controller';
    if (this.cfgMode) for (const b of this.cfgReplay(peer)) peer.send(b, ST.CONFIG);
    const list = this.snap.replay({
      abilitiesFor: isCtl ? null : (d => this.abilitiesBuf(d)),
      position: this.pos ? (() => this.positionBuf()) : null
    });
    for (const b of list) peer.send(b, ST.PLAY);
    if (peer.switchBtn && this.playTags) { const tb = this.build('tags', { tags: RB.addTag(this.playTags.tags, this.dlgIndex) }); if (tb) peer.send(tb, ST.PLAY); }
    this.nt.replayTo(peer);
    if (this.cos.packs) this.cos.packs.replayTo(peer);
    // the server resource pack: an observer that joins later is offered the same pack the main client already loaded
    if (!isCtl) for (const b of this.srvPacks.values()) peer.send(b, ST.PLAY);
    this.cos.replayTo(peer);
    this.riders.replayTo(peer);
    if (this.cos.pets) this.cos.pets.replayTo(peer);
    peer.lastKA = Date.now();
    this.startKA(peer);
    if (isCtl) this.flushEarly(peer);
    else this.log('info', 'SYNC', peer.nick + ' synchronised with the session (' + list.length + ' packets)');
    this.changed();
  }

  flushEarly(peer) {
    if (this.up && this.up.state === ST.PLAY) {
      for (const e of peer.early) { try { this.up.writeRaw(this.up.serializer.createPacketBuffer({ name: e.name, params: e.d })); } catch { /* packet not valid in this state */ } }
      peer.early = [];
    }
  }

  startKA(peer) {
    clearInterval(peer.kaTimer);
    peer.kaTimer = setInterval(() => {
      if (peer.dead) return clearInterval(peer.kaTimer);
      if (peer.client.state !== ST.PLAY || peer.queue.length) return;
      if (Date.now() - peer.lastKA > 30000) { this.kick(peer, 'Timed out'); return; }
      peer.kaSent = Date.now();
      peer.send(this.build('keep_alive', { keepAliveId: Math.floor(Math.random() * 2147483648) }), ST.PLAY);
    }, 4000);
    peer.kaTimer.unref && peer.kaTimer.unref();
  }

  onPeerEnd(peer) {
    if (peer.dead) return;
    peer.dead = true; clearInterval(peer.kaTimer);
    const i = this.peers.indexOf(peer); if (i >= 0) this.peers.splice(i, 1);
    this.log('info', 'CLIENT', peer.nick + ' left (' + (peer.role === 'controller' ? 'Controller' : 'Observer') + ')');
    if (peer.role === 'controller') {
      const next = this.peers.find(p => p.role === 'observer');
      if (next && this.up) this.promote(next, 'Controller left');
    }
    if (!this.peers.length) { this.nick = null; this.primary = null; this.closeUpstream('no clients'); }
    this.changed();
  }

  /* ---------- role switching ---------- */
  // Configuration replay for a peer. The first client gets one extra dialog (registry entry + pause_screen_additions
  // tag) so that its pause menu shows a "Switch roles" button; everybody else gets the server's packets untouched.
  cfgReplay(peer) {
    const plain = this.cfgLog.map(p => p.buf);
    peer.switchBtn = false;
    if (peer !== this.primary || !RB.supported(this.pv)) return plain;
    try {
      const r = RB.patchConfig(this.cfgLog, (n, p) => this.buildCfg(n, p));
      if (r.error) { this.log('warn', 'ROLE', 'Pause-menu button unavailable: ' + r.error + ' (use /' + RB.COMMAND + ')'); return plain; }
      peer.switchBtn = true; this.dlgIndex = r.index;
      return r.bufs;
    } catch (e) {
      this.log('warn', 'ROLE', 'Pause-menu button failed: ' + e.message + ' (use /' + RB.COMMAND + ')');
      return plain;
    }
  }

  isSwitchRequest(peer, name, d) {
    if (name === 'custom_click_action') return !!d && d.id === RB.ACTION_ID;
    return peer === this.primary && RB.isCommand(name, d);
  }

  // only the first client may switch, whatever role it has right now
  switchRequest(peer) {
    if (peer !== this.primary) return;
    const now = Date.now();
    if (now - (peer.lastSwitch || 0) < 1000) return;
    peer.lastSwitch = now;
    if (!this.switchRole()) this.notify(peer, '\u00a7cNo second client to switch with');
  }

  canSwitch() { return this.peers.filter(p => p.attached).length >= 2 && !!this.controller() && this.observers().some(p => p.attached); }

  switchRole() {
    if (!this.canSwitch()) return false;
    const old = this.controller(); const next = this.observers().find(p => p.attached);
    this.releaseInputs();
    old.role = 'observer'; next.role = 'controller';
    // keep rotation order: the old controller goes to the end
    this.peers.splice(this.peers.indexOf(old), 1); this.peers.push(old);
    const ab = this.snap.abilities && this.abilitiesBuf(this.snap.abilities);
    if (ab) old.send(ab, ST.PLAY);
    this.resyncController(next);
    try { this.cos.afterRoleSwitch(); } catch (e) { this.log('warn', 'COS', 'refresh after role switch failed: ' + e.message); }
    this.notify(old, '\u00a7eYou are now an Observer');
    this.notify(next, '\u00a7aYou are now the Controller');
    this.log('info', 'ROLE', 'Roles switched: ' + next.nick + ' (#' + 2 + ') is now Controller');
    this.changed();
    return true;
  }

  promote(peer, why) {
    peer.role = 'controller';
    if (peer.attached) { this.releaseInputs(); this.resyncController(peer); this.notify(peer, '\u00a7aYou are now the Controller'); }
    this.log('info', 'ROLE', why + ': ' + peer.nick + ' promoted to Controller');
  }

  resyncController(peer) {
    const real = this.snap.singles.get('abilities');
    if (real) peer.send(real.buf, ST.PLAY);
    const pb = this.pos && this.positionBuf();
    if (pb) peer.send(pb, ST.PLAY);
    for (const b of this.snap.inventoryPackets()) peer.send(b, ST.PLAY);
    if (peer.early.length) this.flushEarly(peer);
  }

  releaseInputs() {
    if (!this.up || this.up.state !== ST.PLAY) return;
    const id = this.snap.selfId;
    if (this.sneaking) { this.sneaking = false; this.tryUp('entity_action', [{ entityId: id, actionId: 'stop_sneaking', jumpBoost: 0 }, { entityId: id, actionId: 1, jumpBoost: 0 }]); }
    if (this.sprinting) { this.sprinting = false; this.tryUp('entity_action', [{ entityId: id, actionId: 'stop_sprinting', jumpBoost: 0 }, { entityId: id, actionId: 4, jumpBoost: 0 }]); }
    if (this.inputs && this.hasPacket('player_input', 'toServer')) {
      this.inputs = null;
      this.tryUp('player_input', [{ inputs: { forward: false, backward: false, left: false, right: false, jump: false, shift: false, sprint: false } }, { inputs: 0 }]);
    }
  }

  tryUp(name, variants) {
    for (const p of variants) {
      try { const b = this.up.serializer.createPacketBuffer({ name, params: p }); this.up.writeRaw(b); return true; } catch { /* next */ }
    }
    return false;
  }

  notify(peer, text) {
    if (!peer || !peer.attached) return;
    const json = JSON.stringify({ text });
    const n = nbt.comp({ text: nbt.string(text) });
    const zero = '00000000-0000-0000-0000-000000000000';
    const cands = [
      ['action_bar', [{ text: n }, { text: json }]],
      ['system_chat', [{ content: n, isActionBar: true }, { content: json, isActionBar: true }, { content: json, type: 2 }]],
      ['chat', [{ message: json, position: 2, sender: zero }]]
    ];
    for (const [name, vars] of cands) {
      if (!this.hasPacket(name)) continue;
      const b = this.buildAny(name, vars);
      if (b) { peer.send(b, ST.PLAY); return; }
    }
  }

  /* ---------- position helpers ---------- */
  positionBuf() {
    const p = this.pos; if (!p) return null;
    const tid = this.synthTid++;
    const base = { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, teleportId: tid };
    let v;
    if (this.pv >= 768) v = [{ ...base, dx: 0, dy: 0, dz: 0, flags: {} }, { ...base, dx: 0, dy: 0, dz: 0, flags: 0 }];
    else v = [{ ...base, flags: 0, dismountVehicle: false }];
    return this.buildAny('position', v);
  }

  abilitiesBuf(d) {
    const flags = (d.flags | 0x06) & 0xff;
    return this.build('abilities', Object.assign({}, d, { flags: flags > 127 ? flags - 256 : flags, flyingSpeed: 0 }));
  }

  mirrorTick() {
    const obs = this.attachedObservers();
    if (!obs.length || !this.pos) return;
    const now = Date.now();
    if (!this.moveDirty && now - this.lastMirror < 400) return;
    this.moveDirty = false; this.lastMirror = now;
    const b = this.positionBuf(); if (!b) return;
    for (const o of obs) o.send(b, ST.PLAY);
  }

  applyServerPosition(d) {
    const f = d.flags; const p = this.pos || { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    const rel = (k, bit) => (typeof f === 'number' ? !!(f & bit) : !!(f && (f[k] || (k === 'yaw' && f.yRot) || (k === 'pitch' && f.xRot))));
    this.pos = {
      x: rel('x', 1) ? p.x + d.x : d.x, y: rel('y', 2) ? p.y + d.y : d.y, z: rel('z', 4) ? p.z + d.z : d.z,
      yaw: rel('yaw', 8) ? p.yaw + d.yaw : d.yaw, pitch: rel('pitch', 16) ? p.pitch + d.pitch : d.pitch
    };
    if (d.teleportId !== undefined) { this.serverTids.add(d.teleportId); if (this.serverTids.size > 400) this.serverTids.delete(this.serverTids.values().next().value); }
  }

  /* ---------- upstream ---------- */
  connectUpstream() {
    const o = this.opts;
    const auth = o.auth || { mode: 'offline' };
    const copts = { host: this.host, version: this.version, hideErrors: true, skipValidation: true, closeTimeout: 20000, connectTimeout: 20000 };
    if (this.port) copts.port = this.port;
    if (auth.mode === 'microsoft') {
      copts.auth = 'microsoft'; copts.username = auth.label || 'hider'; copts.profilesFolder = auth.folder;
      copts.onMsaCode = (c) => { this.log('warn', 'AUTH', 'Microsoft sign-in: open ' + c.verification_uri + ' and enter code ' + c.user_code); auth.onCode && auth.onCode(c); };
    } else { copts.auth = 'offline'; copts.username = this.nick; }
    this.log('info', 'NET', 'Connecting to ' + this.host + (this.port ? ':' + this.port : '') + ' as ' + this.nick + ' (' + (auth.mode === 'microsoft' ? 'Microsoft' : 'offline') + ')');
    this.ready = false; this.cfgLog = []; this.upReason = ''; this.playTags = null;
    let up;
    try { up = mc.createClient(copts); } catch (e) { this.log('err', 'NET', 'Upstream failed: ' + e.message); this.failPeers('Hider: ' + e.message); return; }
    this.up = up;
    up.on('packet', (d, meta, buf) => { if (this.up !== up) return; try { this.onUp(d, meta, buf); } catch (e) { this.log('err', 'PROXY', 'upstream packet ' + meta.name + ': ' + (e.stack || e.message)); } });
    up.on('error', e => {
      if (this.up !== up) return;
      const m = String(e && e.message || e);
      if (/Parse error|Chunk size|PartialReadError|Read error/i.test(m)) { this.stats.parseErrors++; if (this.stats.parseErrors <= 5) this.log('warn', 'PROXY', 'Unparsed packet skipped: ' + m.slice(0, 140)); return; }
      this.upReason = this.upReason || m; this.log('err', 'NET', 'Upstream error: ' + m);
    });
    up.on('end', reason => { if (this.up === up) this.onUpEnd(reason); });
    up.on('connect', () => this.log('info', 'NET', 'Connected to ' + this.host));
    up.on('disconnect', p => { this.upReason = chatText(p.reason); });
    up.on('kick_disconnect', p => { this.upReason = chatText(p.reason); });
  }

  closeUpstream(why) {
    const up = this.up; if (!up) return;
    this.up = null; this.ready = false; this.cfgLog = []; this.pos = null;
    this.snap.resetAll(); this.serverTids.clear(); this.nt.reset(); this.riders.reset(); this.cos.reset(); this.srvPacks.clear();
    this.sneaking = false; this.sprinting = false; this.inputs = null;
    try { up.end(why); } catch { /* ignore */ }
    this.log('info', 'NET', 'Disconnected from ' + this.host + ' (' + why + ')');
  }

  failPeers(text) {
    for (const p of [...this.peers]) this.kick(p, text);
  }

  onUpEnd(reason) {
    const why = this.upReason || (typeof reason === 'string' ? reason : 'connection closed');
    this.log(this.upReason ? 'warn' : 'info', 'NET', 'Server closed the connection: ' + why);
    const up = this.up; this.up = null; this.ready = false; this.cfgLog = []; this.pos = null;
    this.snap.resetAll(); this.serverTids.clear(); this.nt.reset(); this.riders.reset(); this.cos.reset(); this.srvPacks.clear();
    this.sneaking = false; this.sprinting = false; this.inputs = null;
    try { up && up.end(); } catch { /* ignore */ }
    this.failPeers('Disconnected from ' + this.host + (why ? ': ' + why : ''));
  }

  fwdUp(buf, st) {
    if (this.up && this.up.state === st) { try { this.up.writeRaw(buf); } catch { /* ignore */ } }
  }

  onUp(d, meta, buf) {
    const st = meta.state; const name = meta.name;
    if (st === ST.LOGIN) { if (name === 'disconnect') this.upReason = chatText(d.reason); return; }
    if (st === ST.CONFIG) {
      if (name === 'keep_alive') return;
      if (name === 'disconnect') { this.upReason = chatText(d.reason); for (const p of this.peers) if (p.attached) p.send(buf, ST.CONFIG); return; }
      if (name === 'ping') { const c = this.controller(); if (c && c.attached) c.send(buf, ST.CONFIG); return; }
      if (name === 'cookie_request' || name === 'store_cookie' || name === 'transfer') return;
      if ((name === 'add_resource_pack' || name === 'remove_resource_pack') && this.cos.packs) {
        const entry = { name, buf }; const took = this.cos.packs.handleUp(ST.CONFIG, name, d, buf, entry);
        if (took) { this.cfgLog.push(entry); return; }
      }
      this.cfgLog.push({ name, buf, d: (name === 'registry_data' || name === 'tags') ? d : undefined });
      for (const p of this.peers) if (p.attached) p.send(buf, ST.CONFIG);
      return;
    }
    // play
    if (name === 'keep_alive') return;
    if (name === 'kick_disconnect') {
      this.upReason = chatText(d.reason);
      for (const p of this.peers) if (p.attached) p.send(buf, ST.PLAY);
      return;
    }
    if (name === 'start_configuration') {
      this.ready = false; this.cfgLog = []; this.playTags = null; this.snap.resetAll(); this.pos = null; this.nt.reset(); this.riders.reset(); this.cos.reset(); this.srvPacks.clear();
      for (const p of this.peers) p.switchBtn = false;
      this.log('info', 'NET', 'Server requested reconfiguration (server switch)');
      for (const p of this.peers) if (p.attached) p.send(buf, ST.PLAY);
      return;
    }
    if (name === 'cookie_request' || name === 'transfer' || name === 'store_cookie') return;
    if ((name === 'add_resource_pack' || name === 'remove_resource_pack') && this.cos.packs && this.cos.packs.handleUp(ST.PLAY, name, d, buf)) return;
    if (name === 'resource_pack_send' || name === 'add_resource_pack') this.srvPacks.set(d.uuid || 'single', buf);
    else if (name === 'remove_resource_pack') { if (d.uuid) this.srvPacks.delete(d.uuid); else this.srvPacks.clear(); }
    try { this.snap.record(name, d, buf); } catch (e) { this.log('warn', 'PROXY', 'snapshot ' + name + ': ' + e.message); }
    if (name === 'position') this.applyServerPosition(d);
    if (name === 'tags') this.playTags = d;
    const firstLogin = name === 'login' && !this.ready;
    if (name === 'login' && this.ready) this.nt.reset();
    let out = buf;
    if (name === 'teams') out = this.nt.filterTeams(d, buf);
    else if (name === 'set_passengers') out = this.riders.filter(name, d, buf);
    else if (name === 'entity_equipment') out = this.cos.filterEquipment(d, buf);
    else if (name === 'window_items' || name === 'set_slot' || name === 'set_cursor_item' || name === 'set_player_inventory') out = this.cos.filterInventory(name, d, buf);
    else if (name === 'entity_destroy') this.cos.onDestroy(d.entityIds);
    for (const p of this.peers) {
      if (!p.attached) continue;
      if (p.role === 'observer' && name === 'abilities') { p.send(this.abilitiesBuf(d) || buf, ST.PLAY); continue; }
      if (name === 'tags' && p.switchBtn && this.dlgIndex >= 0) {
        const tb = this.build('tags', { tags: RB.addTag(d.tags, this.dlgIndex) });
        if (tb) { p.send(tb, ST.PLAY); continue; }
      }
      if (out) p.send(out, ST.PLAY);
    }
    this.riders.observe(name, d);
    this.cos.observe(name);
    if (name === 'teams') this.nt.afterTeams();
    else if (name === 'player_info' || name === 'player_remove') this.nt.onTab(d);
    if (name === 'login') {
      if (firstLogin) this.log('info', 'NET', 'Joined ' + this.host + ' (version ' + this.version + ')');
      this.ready = true;
      for (const p of [...this.peers]) this.tryAttach(p);
      if (!this.mirrorTimer) { this.mirrorTimer = setInterval(() => this.mirrorTick(), 50); this.mirrorTimer.unref && this.mirrorTimer.unref(); }
    }
  }

  /* ---------- packets from clients ---------- */
  dedupeOnce(key) {
    if (this.dedupe.has(key)) return false;
    this.dedupe.add(key);
    if (this.dedupe.size > 300) this.dedupe.delete(this.dedupe.values().next().value);
    return true;
  }

  onPeerPacket(peer, d, meta, buf) {
    const st = meta.state; const name = meta.name;
    if (st !== ST.PLAY && st !== ST.CONFIG) return;
    if (name === 'resource_pack_receive' && this.cos.packs && this.cos.packs.handleClient(name, d)) return;
    if (name === 'keep_alive') { peer.lastKA = Date.now(); if (peer.kaSent) { peer.ping = Date.now() - peer.kaSent; } return; }
    if (st === ST.CONFIG) {
      if (name === 'custom_click_action' && d.id === RB.ACTION_ID) return;      // our own button, never goes upstream
      if (name === 'finish_configuration') { peer.client.state = ST.PLAY; return; }
      if (name === 'select_known_packs' || name === 'pong' || name === 'cookie_response' || name === 'accept_code_of_conduct') return;
      if (peer.role === 'controller') {
        if ((name === 'settings' || name === 'custom_payload') && !(this.up && this.up.state === ST.CONFIG)) peer.early.push({ name, d });
        else this.fwdUp(buf, ST.CONFIG);
      }
      return;
    }
    if (name === 'configuration_acknowledged') { peer.client.state = ST.CONFIG; return; }
    if (!peer.attached) {
      if (peer.role === 'controller' && (name === 'settings' || name === 'custom_payload' || name === 'client_information')) peer.early.push({ name, d });
      return;
    }
    if (this.isSwitchRequest(peer, name, d)) { this.switchRequest(peer); return; }
    if (name === 'teleport_confirm') {
      if (this.serverTids.has(d.teleportId)) { this.serverTids.delete(d.teleportId); this.fwdUp(buf, ST.PLAY); }
      return;
    }
    if (name === 'pong') { if (this.dedupeOnce('p' + d.id)) this.fwdUp(buf, ST.PLAY); return; }
    if (name === 'transaction') { if (this.dedupeOnce('t' + d.windowId + ':' + d.action)) this.fwdUp(buf, ST.PLAY); return; }
    if (peer.role === 'controller') this.onController(peer, d, name, buf); else this.onObserver(peer, d, name, buf);
  }

  onController(peer, d, name, buf) {
    const inv = this.snap.inv;
    switch (name) {
      case 'position': case 'position_look': case 'look': {
        const p = this.pos || (this.pos = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });
        if (name !== 'look') { p.x = d.x; p.y = d.y; p.z = d.z; }
        if (name !== 'position') { p.yaw = d.yaw; p.pitch = d.pitch; }
        this.moveDirty = true;
        break;
      }
      case 'arm_animation': this.riders.noteSwing(this.riders.selfEid); break;
      case 'held_item_slot': {
        inv.held = d.slotId;
        const b = this.build('held_item_slot', { slot: d.slotId });
        const hs = this.snap.singles.get('held_item_slot');
        this.snap.singles.set('held_item_slot', { name: 'held_item_slot', buf: b || (hs && hs.buf) });
        for (const o of this.attachedObservers()) o.send(b, ST.PLAY);
        break;
      }
      case 'window_click': {
        const r = inv.click(d);
        if (r) {
          for (const c of r.changed) for (const o of this.attachedObservers()) o.send(this.build('set_slot', c), ST.PLAY);
          if (r.cursor) this.sendCursor(this.attachedObservers());
        }
        break;
      }
      case 'set_creative_slot': {
        // the item comes from our own (cosmetic) view of the inventory: the real server must never see our item_model
        const clean = this.cos.unrewrite(d.item);
        if (clean !== d.item) {
          d = Object.assign({}, d, { item: clean });
          try { buf = this.up.serializer.createPacketBuffer({ name, params: d }); } catch { return; }
        }
        inv.setSlot(0, d.slot, d.item, undefined);
        const w = inv.win(0);
        const b = this.build('set_slot', { windowId: 0, slot: d.slot, item: d.item, stateId: w ? w.stateId : 0 });
        for (const o of this.attachedObservers()) o.send(b, ST.PLAY);
        break;
      }
      case 'close_window': {
        inv.closeWindow(d.windowId);
        if (this.snap.openWindow && this.snap.openWindow.windowId === d.windowId) this.snap.openWindow = null;
        const b = this.build('close_window', { windowId: d.windowId });
        for (const o of this.attachedObservers()) o.send(b, ST.PLAY);
        break;
      }
      case 'entity_action': {
        const a = d.actionId;
        if (a === 'start_sneaking' || a === 0) this.sneaking = true;
        else if (a === 'stop_sneaking' || a === 1) this.sneaking = false;
        else if (a === 'start_sprinting' || a === 3) this.sprinting = true;
        else if (a === 'stop_sprinting' || a === 4) this.sprinting = false;
        break;
      }
      case 'player_input': this.inputs = d.inputs; break;
      case 'use_entity': if (this.riders.owns(d.target)) return; break;   // our virtual entities never reach the real server
      default: break;
    }
    this.fwdUp(buf, ST.PLAY);
  }

  sendCursor(targets) {
    const inv = this.snap.inv;
    const it = inv.out(inv.cursor);
    const b = inv.hasCursorPacket ? this.build('set_cursor_item', { contents: it }) : this.build('set_slot', { windowId: -1, slot: -1, item: it, stateId: 0 });
    for (const o of targets) o.send(b, ST.PLAY);
  }

  onObserver(peer, d, name, buf) {
    const inv = this.snap.inv;
    const now = Date.now();
    switch (name) {
      case 'window_click': case 'set_creative_slot': {
        if (now - peer.lastResync < 120) return;
        peer.lastResync = now;
        for (const b of this.snap.inventoryPackets()) peer.send(b, ST.PLAY);
        break;
      }
      case 'held_item_slot': {
        const hs = this.snap.singles.get('held_item_slot'); if (hs) peer.send(hs.buf, ST.PLAY);
        break;
      }
      case 'close_window': peer.closedWin = true; break;
      case 'block_dig': case 'block_place': case 'use_item': case 'use_item_on': {
        if (d.sequence !== undefined && this.hasPacket('acknowledge_player_digging')) {
          const b = this.buildAny('acknowledge_player_digging', [{ sequenceId: d.sequence }]);
          if (b) peer.send(b, ST.PLAY);
        } else if (d.location && now - (peer.lastChunkFix || 0) > 150) {
          peer.lastChunkFix = now;
          const lx = d.location.x >> 4; const lz = d.location.z >> 4;
          for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const e = this.snap.chunks.get((lx + dx) + ',' + (lz + dz)); if (!e) continue;
            if (e.lightFirst) { peer.send(e.light, ST.PLAY); peer.send(e.map, ST.PLAY); } else { peer.send(e.map, ST.PLAY); peer.send(e.light, ST.PLAY); }
            if (e.map) for (const b of e.extra.values()) peer.send(b, ST.PLAY);
            if (dx === 0 && dz === 0 && d.location.y !== undefined) break;
          }
        }
        break;
      }
      case 'chat': case 'chat_message': case 'chat_command': case 'chat_command_signed':
        if (now - (peer.lastNote || 0) > 3000) { peer.lastNote = now; this.notify(peer, '\u00a7cObserver: chat is disabled'); }
        break;
      default: break;
    }
  }

  /* ---------- shutdown ---------- */
  stop(reason = 'Session closed') {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.mirrorTimer);
    try { this.cos.dispose(); } catch { /* ignore */ }
    for (const p of [...this.peers]) this.kick(p, 'Hider: ' + reason);
    this.closeUpstream('session closed');
    try { this.server && this.server.close(); } catch { /* ignore */ }
    this.emit('closed');
  }
}

module.exports = { Session, chatText, setCosmeticAssets: require('./cosmetics/manager').setCosmeticAssets };
