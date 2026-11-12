'use strict';
// "Riders": invisible virtual entities (text_display / item_display / armor stands) that the proxy injects into the
// stream sent to the attached clients and mounts on real players with set_passengers (pure attachment: no per-tick
// teleports, so there is no lag behind the player). Used for the line above the nick and for cosmetics.
//  - ids come from a reserved high range, the real server never sees them (use_entity on them is swallowed)
//  - our passengers are merged into every set_passengers the real server sends for the same vehicle
//  - state is dropped on respawn / login / start_configuration and re-created for new player spawns
const crypto = require('crypto');

const BASE_ID = 1900000000;
const ST_PLAY = 'play';
const INVIS_EFFECT = 14;

function uuidFor(vid) {
  const h = crypto.createHash('md5').update('rider' + vid).digest();
  h[6] = (h[6] & 0x0f) | 0x40; h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString('hex');
  return x.slice(0, 8) + '-' + x.slice(8, 12) + '-' + x.slice(12, 16) + '-' + x.slice(16, 20) + '-' + x.slice(20);
}

class Riders {
  constructor(session) {
    this.s = session;
    const E = session.mcData.entitiesByName;
    this.playerType = E.player && E.player.id;
    this.types = { text_display: E.text_display && E.text_display.id, item_display: E.item_display && E.item_display.id, armor_stand: E.armor_stand && E.armor_stand.id };
    this.legacy = this.types.text_display === undefined;      // 1.16.5: no display entities, armor stands only
    this.metaNames = this.findMetaNames();
    this.sources = [];
    this.next = BASE_ID;
    this.timer = null; this.broken = false;
    this.yawTimer = null;
    this.resetState();
  }

  /* ---------- rotation tracking (cosmetics follow the head / body yaw of their player) ---------- */
  static ang(b) { return b * 360 / 256; }                       // protocol byte angle -> degrees
  static toByte(deg) { let b = Math.round(deg * 256 / 360) % 256; if (b > 127) b -= 256; if (b < -128) b += 256; return b; }
  static wrap(d) { d = ((d + 180) % 360 + 360) % 360 - 180; return d; }
  rotOf(eid) {
    let r = this.rot.get(eid);
    if (!r) { r = { head: 0, cur: 0, steps: 0, body: 0, init: false, px: null, pz: null, mx: 0, mz: 0, mt: 0, mchg: 0, swingUntil: 0, t: 0 }; this.rot.set(eid, r); }
    return r;
  }
  // head yaw reported by the server (the client eases towards it over 3 ticks)
  setHead(eid, deg) {
    const r = this.rotOf(eid); r.head = deg;
    if (!r.init) { r.body = deg; r.cur = deg; r.steps = 0; r.init = true; } else r.steps = 3;
  }
  noteSwing(eid) { if (eid !== null && eid !== undefined) this.rotOf(eid).swingUntil = Date.now() + 6 * 50; }
  // yaw (degrees) a rider of `follow` kind has to look at; both values are kept up to date by tickYaw (client emulation, 20 Hz)
  yawOf(eid, follow) {
    const r = this.rotOf(eid);
    if (eid === this.selfEid && this.s.pos) { r.head = this.s.pos.yaw; r.cur = r.head; if (!r.init) { r.body = r.head; r.init = true; } }
    return follow === 'head' ? r.cur : r.body;
  }
  // one game tick of the vanilla body-turn logic (LivingEntity.tick + tickHeadTurn) for one player
  stepBody(r, now) {
    const yRot = r.cur;
    let f1 = r.body;
    if (now - r.mt < Math.max(110, r.mchg * 50 + 60) && r.mag > 0.05) {
      const f4 = Math.atan2(r.mz, r.mx) * 180 / Math.PI - 90;
      const f5 = Math.abs(Riders.wrap(yRot) - f4);
      f1 = (f5 > 95 && f5 < 265) ? f4 - 180 : f4;
    }
    if (now < r.swingUntil) f1 = yRot;
    r.body += Riders.wrap(f1 - r.body) * 0.3;
    const h = Riders.wrap(yRot - r.body);
    if (Math.abs(h) > 50) r.body += h - Math.sign(h) * 50;
    r.body = Riders.wrap(r.body);
  }
  simulate(eid, pos, now) {
    const r = this.rotOf(eid);
    if (eid === this.selfEid && this.s.pos) { r.head = this.s.pos.yaw; r.cur = r.head; r.steps = 0; if (!r.init) { r.body = r.head; r.init = true; } }
    if (!r.t) r.t = now - 50;
    let n = Math.min(6, Math.floor((now - r.t) / 50)); if (n < 1) return;
    const n0 = n; r.t += n * 50; if (now - r.t > 500) r.t = now;
    // horizontal movement since the previous look
    if (pos && typeof pos.x === 'number' && typeof pos.z === 'number') {
      if (r.px !== null) {
        const dx = pos.x - r.px, dz = pos.z - r.pz, m = Math.hypot(dx, dz);
        if (m > 1e-4 && m < 8) {
          r.mx = dx; r.mz = dz; r.mag = m / n0; r.mchg = 0; r.mt = now;
        }
      }
      r.px = pos.x; r.pz = pos.z;
    }
    while (n-- > 0) {
      if (r.steps > 0 && eid !== this.selfEid) { r.cur = Riders.wrap(r.cur + Riders.wrap(r.head - r.cur) / r.steps); r.steps--; }
      this.stepBody(r, now);
    }
  }
  tickYaw() {
    this.yawTimer = null;
    let any = false; const out = []; const now = Date.now();
    const players = this.live.size ? this.players() : new Map();
    const done = new Set();
    for (const l of this.live.values()) {
      if (!l.parts.some(p => p.follow)) continue;
      any = true;
      if (!done.has(l.eid)) { done.add(l.eid); this.simulate(l.eid, players.get(l.eid), now); }
      l.parts.forEach((p, i) => {
        if (!p.follow) return;
        const y = this.yawOf(l.eid, p.follow);
        if (l.yaw && l.yaw[i] !== undefined && Riders.toByte(y) === Riders.toByte(l.yaw[i])) return;
        if (!l.yaw) l.yaw = [];
        l.yaw[i] = y;
        out.push(this.s.build('entity_look', { entityId: l.ids[i], yaw: Riders.toByte(y), pitch: 0, onGround: false }));
      });
    }
    for (const b of out) this.send(b);
    if (any) { this.yawTimer = setTimeout(() => this.tickYaw(), 50); this.yawTimer.unref && this.yawTimer.unref(); }
  }
  ensureYawTick() { if (!this.yawTimer && !this.broken) { this.yawTimer = setTimeout(() => this.tickYaw(), 50); this.yawTimer.unref && this.yawTimer.unref(); } }

  resetState() {
    this.flags = new Map();          // eid -> entity flags byte (bit 0x20 = invisible)
    this.invisFx = new Set();        // eids with the invisibility effect (self only gets effect packets)
    this.dead = new Set();
    this.gm = new Map();             // uuid -> gamemode
    this.real = new Map();           // vehicle eid -> passengers the real server put on it
    this.live = new Map();           // `${eid}|${key}` -> { vids:[...], sig, eid }
    this.owned = new Set();          // every vid that exists on the clients
    this.rot = new Map();            // eid -> { head, body, moved }
    this.pose = new Map();           // eid -> pose name
    this.selfEid = null;
  }

  reset() { this.resetState(); clearTimeout(this.timer); this.timer = null; clearTimeout(this.yawTimer); this.yawTimer = null; }
  addSource(src) { this.sources.push(src); this.schedule(); }
  owns(id) { return typeof id === 'number' && id >= BASE_ID; }
  newId() { return this.next++; }

  /* ---------- protocol helpers ---------- */
  findMetaNames() {
    const t = this.s.mcData.protocol.types;
    const e = t.entityMetadataEntry;
    const out = {};
    try {
      const mp = JSON.stringify(e).match(/"mappings":(\{[^}]*\})/);
      const m = mp ? JSON.parse(mp[1]) : {};
      for (const [k, v] of Object.entries(m)) out[v] = +k;
    } catch { /* legacy */ }
    return out;
  }
  // logical type -> value of the `type` field in entity_metadata
  mt(name) {
    if (this.legacy) return ({ byte: 0, int: 1, float: 2, string: 3, component: 4, optional_component: 5, item_stack: 6, boolean: 7 })[name];
    const alias = { vector3: ['vector3', 'vec3'], quaternion: ['quaternion'], boolean: ['boolean', 'bool'], item_stack: ['item_stack', 'slot'], component: ['component', 'chat'], optional_component: ['optional_component', 'optional_chat'] };
    for (const n of (alias[name] || [name])) if (this.metaNames[n] !== undefined) return n;
    return name;
  }

  send(buf, exclude) {
    if (!buf) return;
    for (const p of this.s.peers) if (p.attached && p !== exclude) p.send(buf, ST_PLAY);
  }

  spawnBuf(vid, kind, pos, yawDeg) {
    const s = this.s; const type = this.types[kind];
    const uuid = uuidFor(vid);
    const p = pos || { x: 0, y: 0, z: 0 }; const yb = Riders.toByte(yawDeg || 0);
    if (this.legacy) {
      return s.buildAny('spawn_entity_living', [
        { entityId: vid, entityUUID: uuid, type, x: p.x, y: p.y, z: p.z, yaw: yb, pitch: 0, headPitch: 0, velocity: { x: 0, y: 0, z: 0 } },
        { entityId: vid, entityUUID: uuid, type, x: p.x, y: p.y, z: p.z, yaw: yb, pitch: 0, headPitch: 0, velocityX: 0, velocityY: 0, velocityZ: 0 }
      ]);
    }
    return s.buildAny('spawn_entity', [
      { entityId: vid, objectUUID: uuid, type, x: p.x, y: p.y, z: p.z, pitch: 0, yaw: yb, headPitch: 0, objectData: 0, velocity: { x: 0, y: 0, z: 0 } },
      { entityId: vid, objectUUID: uuid, type, x: p.x, y: p.y, z: p.z, pitch: 0, yaw: yb, objectData: 0, velocity: { x: 0, y: 0, z: 0 } },
      { entityId: vid, objectUUID: uuid, type, x: p.x, y: p.y, z: p.z, pitch: 0, yaw: yb, headPitch: 0, objectData: 0, velocityX: 0, velocityY: 0, velocityZ: 0 }
    ]);
  }

  // meta: [{ key, type:'byte'|..., value }]
  metaBuf(vid, meta) {
    const metadata = meta.map(m => ({ key: m.key, type: this.mt(m.type), value: m.value }));
    return this.s.build('entity_metadata', { entityId: vid, metadata });
  }
  destroyBuf(vids) { return this.s.build('entity_destroy', { entityIds: vids }); }

  // passengers = what the real server put on the vehicle + ours
  passengerBuf(eid) {
    const mine = [];
    for (const l of this.live.values()) if (l.eid === eid) mine.push(...l.mount);
    const real = (this.real.get(eid) || []).filter(v => !this.owned.has(v));
    return this.s.build('set_passengers', { entityId: eid, passengers: real.concat(mine) });
  }

  /* ---------- players ---------- */
  players() {
    const s = this.s; const out = new Map();
    const tabName = new Map();
    for (const [uuid, list] of s.snap.tab) {
      for (const it of list) {
        const e = it.params && it.params.data && it.params.data[0]; if (!e) continue;
        const n = e.name || (e.player && e.player.name);
        if (n) { tabName.set(String(uuid).toLowerCase(), String(n)); break; }
      }
    }
    for (const [eid, e] of s.snap.entities) {
      if (!e.name || !e.data) continue;
      let uuid = null;
      if (e.name === 'named_entity_spawn') uuid = e.data.playerUUID;
      else if (e.name === 'spawn_entity' && e.data.type === this.playerType) uuid = e.data.objectUUID;
      if (!uuid) continue;
      const u = String(uuid).toLowerCase();
      const hidden = ((this.flags.get(eid) || 0) & 0x20) !== 0 || this.dead.has(eid) || this.gm.get(u) === 3;
      if (!this.rot.has(eid) && typeof e.data.yaw === 'number') this.setHead(eid, Riders.ang(e.data.yaw));
      out.set(eid, { eid, uuid: u, name: tabName.get(u) || null, x: e.data.x, y: e.data.y, z: e.data.z, hidden, pose: this.pose.get(eid) || 'standing' });
    }
    if (this.selfEid !== null && s.pos && !out.has(this.selfEid)) {
      const nm = (s.up && s.up.username) || s.nick || null;
      out.set(this.selfEid, { eid: this.selfEid, uuid: 'self', self: true, name: nm, x: s.pos.x, y: s.pos.y, z: s.pos.z, hidden: this.dead.has(this.selfEid), pose: this.pose.get(this.selfEid) || 'standing' });
    }
    return out;
  }

  /* ---------- sync ---------- */
  schedule() {
    if (this.timer || this.broken) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try { this.sync(); } catch (e) { this.s.log('warn', 'RIDE', 'rider sync failed: ' + e.message); }
    }, 30);
    this.timer.unref && this.timer.unref();
  }

  // want: Map(`${eid}|${key}`) -> { eid, kind:'text_display'|'item_display'|'armor_stand', parts:[{kind, meta, mountOn?}], sig }
  collect() {
    const players = this.players(); const want = new Map();
    for (const src of this.sources) {
      let list = [];
      try { list = src.list(players) || []; } catch (e) { this.s.log('warn', 'RIDE', 'source failed: ' + e.message); }
      for (const w of list) {
        const p = players.get(w.eid);
        if (!p || p.hidden) continue;
        want.set(w.eid + '|' + w.key, w);
      }
    }
    return want;
  }

  sync(only) {
    const s = this.s;
    if (!s.ready || !s.snap || this.broken) return;
    const want = this.collect();
    const out = []; const touched = new Set();
    for (const [k, l] of [...this.live]) {
      if (!want.has(k)) {
        out.push(this.destroyBuf(l.vids)); for (const v of l.vids) this.owned.delete(v);
        this.live.delete(k); touched.add(l.eid);
      }
    }
    const players = this.players();
    for (const [k, w] of want) {
      const cur = this.live.get(k);
      const sig = JSON.stringify(w.parts.map(p => [p.kind, p.meta]));
      const shape = JSON.stringify(w.parts.map(p => [p.kind, p.mountOn, p.follow]));
      if (cur && cur.sig === sig) continue;
      if (cur && cur.shape === shape) {                    // same entities, other metadata -> update in place
        w.parts.forEach((p, i) => { if (JSON.stringify(p.meta) !== JSON.stringify(cur.parts[i].meta)) out.push(this.metaBuf(cur.ids[i], p.meta)); });
        cur.sig = sig; cur.parts = w.parts; continue;
      }
      if (cur) { out.push(this.destroyBuf(cur.vids)); for (const v of cur.vids) this.owned.delete(v); this.live.delete(k); }
      const vids = []; const mount = []; const bufs = []; const pl = players.get(w.eid);
      const pos = pl ? { x: pl.x, y: pl.y, z: pl.z } : null;
      const ids = w.parts.map(() => this.newId());
      let ok = true;
      w.parts.forEach((p, i) => {
        const sp = this.spawnBuf(ids[i], p.kind, pos, p.follow ? this.yawOf(w.eid, p.follow) : 0); const mb = this.metaBuf(ids[i], p.meta);
        if (!sp || !mb) { ok = false; return; }
        bufs.push(sp, mb); vids.push(ids[i]);
      });
      if (!ok) { this.broken = true; s.log('warn', 'RIDE', 'cannot build rider packets, riders disabled'); return; }
      w.parts.forEach((p, i) => { if (p.mountOn === undefined) mount.push(ids[i]); });
      for (const v of vids) this.owned.add(v);
      const entry = { vids, sig, shape, eid: w.eid, mount, parts: w.parts, ids, yaw: w.parts.map(p => p.follow ? this.yawOf(w.eid, p.follow) : undefined) };
      if (w.parts.some(p => p.follow)) this.ensureYawTick();
      this.live.set(k, entry); touched.add(w.eid);
      out.push(...bufs);
      // chained parts (1.16.5 stand on a stand)
      w.parts.forEach((p, i) => { if (p.mountOn !== undefined) out.push(s.build('set_passengers', { entityId: ids[p.mountOn], passengers: [ids[i]] })); });
    }
    for (const eid of touched) out.push(this.passengerBuf(eid));
    for (const b of out) this.send(b, only);
  }

  // destroy every rider on the clients and build them again (roles were switched / a client may have lost them)
  refreshAll() {
    const eids = new Set(); const out = [];
    for (const l of this.live.values()) { out.push(this.destroyBuf(l.vids)); for (const v of l.vids) this.owned.delete(v); eids.add(l.eid); }
    this.live.clear();
    for (const b of out) this.send(b);
    for (const eid of eids) this.send(this.passengerBuf(eid));
    this.schedule();
  }

  // a client just received the snapshot: bring it up to date with our entities
  replayTo(peer) {
    const s = this.s; const eids = new Set();
    for (const l of this.live.values()) {
      const pl = this.players().get(l.eid);
      l.parts.forEach((p, i) => {
        peer.send(this.spawnBuf(l.ids[i], p.kind, pl, p.follow ? this.yawOf(l.eid, p.follow) : 0), ST_PLAY); peer.send(this.metaBuf(l.ids[i], p.meta), ST_PLAY);
      });
      l.parts.forEach((p, i) => { if (p.mountOn !== undefined) peer.send(s.build('set_passengers', { entityId: l.ids[p.mountOn], passengers: [l.ids[i]] }), ST_PLAY); });
      eids.add(l.eid);
    }
    for (const eid of eids) peer.send(this.passengerBuf(eid), ST_PLAY);
  }

  /* ---------- stream hooks (called from Session.onUp) ---------- */
  // returns the buffer to forward to the clients
  filter(name, d, buf) {
    if (name === 'set_passengers') {
      this.real.set(d.entityId, (d.passengers || []).slice());
      for (const l of this.live.values()) if (l.eid === d.entityId) return this.passengerBuf(d.entityId) || buf;
    }
    return buf;
  }

  // called after the packet was forwarded and recorded in the snapshot
  observe(name, d) {
    switch (name) {
      case 'login': this.reset(); this.selfEid = d.entityId; return;
      case 'respawn': case 'start_configuration': { const se = this.selfEid; this.reset(); if (name === 'respawn') this.selfEid = se; return; }
      case 'entity_look': case 'entity_move_look': this.setHead(d.entityId, Riders.ang(d.yaw)); return;
      case 'animation': if (d.animation === 0 || d.animation === 3) this.noteSwing(d.entityId); return;
      case 'entity_head_rotation': this.setHead(d.entityId, Riders.ang(d.headYaw)); return;
      case 'entity_teleport': case 'sync_entity_position': {
        if (typeof d.yaw === 'number') this.setHead(d.entityId, this.s.pv >= 768 || name === 'sync_entity_position' ? d.yaw : Riders.ang(d.yaw));
        return;
      }
      case 'spawn_entity': case 'named_entity_spawn': case 'spawn_entity_living':
        this.dead.delete(d.entityId); this.schedule(); return;
      case 'entity_destroy': {
        const gone = new Set(d.entityIds || []);
        for (const id of gone) { this.flags.delete(id); this.dead.delete(id); this.real.delete(id); this.invisFx.delete(id); }
        let any = false;
        for (const [k, l] of [...this.live]) if (gone.has(l.eid)) {
          this.send(this.destroyBuf(l.vids)); for (const v of l.vids) this.owned.delete(v); this.live.delete(k); any = true;
        }
        if (any || gone.size) this.schedule();
        return;
      }
      case 'entity_metadata': {
        const f = (d.metadata || []).find(m => m.key === 0);
        if (f && typeof f.value === 'number') { this.flags.set(d.entityId, f.value & 0xff); this.schedule(); }
        const ps = (d.metadata || []).find(m => m.key === 6);
        if (ps) {
          const POSES = ['standing', 'fall_flying', 'sleeping', 'swimming', 'spin_attack', 'crouching', 'long_jumping', 'dying'];
          const v = typeof ps.value === 'number' ? POSES[ps.value] : String(ps.value);
          if (v && this.pose.get(d.entityId) !== v) { this.pose.set(d.entityId, v); this.schedule(); }
        }
        return;
      }
      case 'entity_status': if (d.entityStatus === 3) { this.dead.add(d.entityId); this.schedule(); } return;
      case 'entity_effect': if (d.effectId === INVIS_EFFECT) { this.invisFx.add(d.entityId); this.schedule(); } return;
      case 'remove_entity_effect': if (d.effectId === INVIS_EFFECT) { this.invisFx.delete(d.entityId); this.schedule(); } return;
      case 'player_info': {
        for (const e of (d.data || [])) {
          const u = String(e.uuid || e.UUID || (e.player && e.player.uuid) || '').toLowerCase();
          if (u && e.gamemode !== undefined) this.gm.set(u, e.gamemode);
        }
        this.schedule(); return;
      }
      case 'player_remove': case 'update_health': this.schedule(); return;
      default: return;
    }
  }
}

module.exports = { Riders, BASE_ID };
