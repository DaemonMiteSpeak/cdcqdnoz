'use strict';
// Hider labels: a Hider user that stands on the same server as you gets
//   - a SECOND LINE above the nick: "[tag]" (#FF7A7A, plus the grey Hider name when it differs from the nick).
//     It is an invisible text_display (armor stand pair on 1.16.5) mounted on the player with set_passengers
//     (see riders.js), the real nickname above the head stays clean;
//   - "[tag]" in front of the name in the tab list (player_info update_display_name; the server's own display
//     name / team prefix, suffix and colour are kept).
// Matching is by in-game nick + server address (host:port, default 25565) and only players from the tab list
// are marked.
const nbt = require('prismarine-nbt');
const crypto = require('crypto');

const ST_PLAY = 'play';
const TAG_COLOR = '#FF7A7A';
const DIM_COLOR = '#A0A0A0';
const COLORS = ['black', 'dark_blue', 'dark_green', 'dark_aqua', 'dark_red', 'dark_purple', 'gold', 'gray', 'dark_gray', 'blue', 'green', 'aqua', 'red', 'light_purple', 'yellow', 'white'];
const NICK_Y = 0.32;           // our own copy of the nick (the client hides the real name tag of a player that carries riders)
const LINE_Y = 0.82;           // height of the second line above the point where the nametag is anchored

function normHost(target) {
  let t = String(target || '').trim().toLowerCase();
  if (!t) return '';
  let host = t; let port = 25565;
  const m = t.match(/^(.*?):(\d{1,5})$/);
  if (m) { host = m[1]; port = parseInt(m[2], 10); }
  host = host.replace(/\.+$/, '');
  return host + ':' + port;
}

class Nametags {
  constructor(session) {
    this.s = session;
    this.enabled = true; this.users = [];
    this.cur = new Map();        // tab uuid -> { name, sig }   labels currently applied in the tab list
    this.srvName = new Map();    // tab uuid -> display name the real server set (chat value or undefined)
    this.timer = null; this.broken = false; this.lastCount = -1;
    this.nbtMode = !!session.mcData.supportFeature('chatPacketsUseNbtComponents');
    this.host = normHost(session.host + (session.port ? ':' + session.port : ''));
    session.riders.addSource({ list: players => this.riderList(players) });
  }

  /* ---------- configuration ---------- */
  setEnabled(v) { v = v !== false; if (v === this.enabled) return; this.enabled = v; this.schedule(); }
  setPresence(users) { this.users = Array.isArray(users) ? users : []; this.schedule(); }
  reset() { this.cur.clear(); this.srvName.clear(); clearTimeout(this.timer); this.timer = null; this.lastCount = -1; }

  schedule() {
    this.s.riders.schedule();
    if (this.timer || this.broken) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try { this.sync(); } catch (e) { this.s.log('warn', 'TAGS', 'nametag sync failed: ' + e.message); }
    }, 30);
    this.timer.unref && this.timer.unref();
  }
  afterTeams() { this.schedule(); }
  filterTeams(d, buf) { return buf; }       // teams are not touched any more

  // every server player_info packet: remember the server's own display names, re-apply our labels after it
  onTab(d) {
    if (d && d.data) {
      const a = d.action; const isObj = a && typeof a === 'object';
      const upd = isObj ? !!a.update_display_name : (a === 'update_display_name' || a === 3);
      const add = isObj ? !!a.add_player : (a === 'add_player' || a === 0);
      for (const e of d.data) {
        const u = String(e.uuid || e.UUID || (e.player && e.player.uuid) || '').toLowerCase(); if (!u) continue;
        if (upd || (add && e.displayName !== undefined)) this.srvName.set(u, e.displayName === null ? undefined : e.displayName);
        if (this.cur.has(u) && (upd || add)) this.cur.get(u).sig = null;   // the client forgot our name: send it again
      }
    }
    this.schedule();
  }

  /* ---------- helpers ---------- */
  tabIndex() {
    const out = new Map();     // in-game name -> uuid (lower case)
    for (const [uuid, list] of this.s.snap.tab) {
      for (const it of list) {
        const e = it.params && it.params.data && it.params.data[0]; if (!e) continue;
        const n = e.name || (e.player && e.player.name);
        if (n) { out.set(String(n), String(uuid).toLowerCase()); break; }
      }
    }
    return out;
  }

  teamOf(name) {
    for (const [, e] of this.s.snap.teams) if (e.players.has(name)) return e.base;
    return null;
  }

  desired() {
    const out = new Map();
    if (!this.enabled) return out;
    const hid = new Map();
    for (const u of this.users) {
      if (!u || !u.nick) continue;
      if (normHost(u.server) !== this.host) continue;
      hid.set(String(u.nick).toLowerCase(), u);
    }
    for (const n of this.tabIndex().keys()) {
      const u = hid.get(n.toLowerCase());
      let spec;
      if (!u) continue;                                       // labels only for real Hider users (no debug mode any more)
      // "<username> [tag]": username = the Hider account name (falls back to the in-game nick)
      spec = [{ text: String(u.name || n) + ' ', color: '#FFFFFF' }, { text: '[' + (u.tag || 'wtf') + ']', color: TAG_COLOR }];
      out.set(n, { spec, key: JSON.stringify(spec), real: !!u });
    }
    return out;
  }

  /* ---------- chat components ---------- */
  isEmptyChat(v) {
    if (v === undefined || v === null) return true;
    if (typeof v === 'string') { const t = v.trim(); return !t || t === '{"text":""}' || t === '""'; }
    if (v.type === 'string') return !String(v.value || '');
    if (v.type === 'compound') { try { const j = JSON.stringify(nbt.simplify(v)); return j === '{}' || j === '{"text":""}'; } catch { return false; } }
    return false;
  }
  // one chat value (as the protocol delivers it) -> an item usable inside "extra"
  item(v) {
    if (this.nbtMode) {
      if (v && v.type === 'compound' && v.value) return v.value;
      if (v && v.type === 'string') return { text: nbt.string(String(v.value)) };
      return { text: nbt.string(String(v)) };
    }
    let o; try { o = JSON.parse(v); } catch { o = { text: String(v) }; }
    return typeof o === 'object' && o ? o : { text: String(o) };
  }
  part(c) {
    if (this.nbtMode) { const o = { text: nbt.string(c.text) }; if (c.color) o.color = nbt.string(c.color); return o; }
    return c.color ? { text: c.text, color: c.color } : { text: c.text };
  }
  wrap(items) {
    return this.nbtMode ? nbt.comp({ text: nbt.string(''), extra: nbt.list(nbt.comp(items)) }) : JSON.stringify({ text: '', extra: items });
  }
  // text of the label line (also the label shown in the tab list)
  lineChat(spec) { return this.wrap(spec.map(c => this.part(c))); }

  // the name as it should be shown in the tab list, with the label in front
  tabChat(spec, name, uuid) {
    const items = spec.map(c => this.part(c)); items.push(this.part({ text: ' ' }));
    const srv = this.srvName.get(uuid);
    if (!this.isEmptyChat(srv)) items.push(this.item(srv));
    else {
      const tb = this.teamOf(name);
      if (tb && !this.isEmptyChat(tb.prefix)) items.push(this.item(tb.prefix));
      const f = tb && typeof tb.formatting === 'number' && tb.formatting >= 0 && tb.formatting < 16 ? COLORS[tb.formatting] : null;
      items.push(this.part(f ? { text: name, color: f } : { text: name }));
      if (tb && !this.isEmptyChat(tb.suffix)) items.push(this.item(tb.suffix));
    }
    return this.wrap(items);
  }

  /* ---------- tab list: display names ---------- */
  mkDisplay(uuid, chat) {
    const s = this.s;
    // 1.19.3+ (protocol 761): action is a bit set, before that a numbered action (silently mis-encoded if mixed up)
    if (s.pv >= 761) return s.build('player_info', { action: { update_display_name: true }, data: [{ uuid, displayName: chat }] });
    return s.build('player_info', { action: 'update_display_name', data: [{ uuid, displayName: chat }] });
  }

  send(buf, exclude) { if (!buf) return; for (const p of this.s.peers) if (p.attached && p !== exclude) p.send(buf, ST_PLAY); }

  sync(exclude) {
    const s = this.s;
    if (!s.ready || this.broken || !s.snap) return;
    const want = this.desired(); const idx = this.tabIndex();
    const byUuid = new Map();
    for (const [n, w] of want) { const u = idx.get(n); if (u) byUuid.set(u, { n, w }); }
    const out = [];
    for (const [u, c] of [...this.cur]) {
      if (byUuid.has(u)) continue;
      if (s.snap.tab.has(u)) out.push(this.mkDisplay(u, this.srvName.get(u)));
      this.cur.delete(u);
    }
    for (const [u, { n, w }] of byUuid) {
      const tb = this.teamOf(n);
      const sig = w.key + '|' + JSON.stringify(this.srvName.get(u) || null) + '|' + (tb ? JSON.stringify([tb.prefix, tb.suffix, tb.formatting]) : '');
      const c = this.cur.get(u);
      if (c && c.sig === sig) continue;
      const b = this.mkDisplay(u, this.tabChat(w.spec, n, u));
      if (!b) { this.broken = true; s.log('warn', 'TAGS', 'cannot build player_info packet, tab labels disabled'); break; }
      out.push(b); this.cur.set(u, { name: n, sig, w });
    }
    for (const b of out) this.send(b, exclude);
    let real = 0; for (const w of want.values()) if (w.real) real++;
    const cnt = want.size * 1000 + real;
    if (cnt !== this.lastCount) {
      this.lastCount = cnt;
      if (want.size || real) s.log('info', 'TAGS', 'Labels: ' + want.size + ' player(s), Hider users: ' + real);
    }
    s.riders.schedule();
  }

  // a client just got the snapshot (the server's own tab entries): bring it up to date with the labels
  replayTo(peer) {
    try { this.sync(peer); } catch (e) { this.s.log('warn', 'TAGS', 'nametag sync failed: ' + e.message); }
    for (const [u, c] of this.cur) {
      const b = this.mkDisplay(u, this.tabChat(c.w.spec, c.name, u));
      if (b) peer.send(b, ST_PLAY);
    }
  }

  /* ---------- the line above the nick (riders) ---------- */
  riderList(players) {
    if (!this.enabled || this.broken) return [];
    const want = this.desired(); const out = [];
    for (const p of players.values()) {
      if (p.eid === this.s.snap.selfId || !p.name) continue;
      const w = want.get(p.name); if (!w) continue;
      out.push({ eid: p.eid, key: 'tag', parts: this.lineParts(w.spec).concat(this.nickParts(p)) });
    }
    return out;
  }

  // the client does not draw the name tag of an entity that has passengers (LivingEntityRenderer: !isVehicle), so the nick is a rider too
  nickParts(p) {
    // DISABLED: the client now draws the real name tag (and the belowname health) itself, our copy showed up as a duplicate nick
    return [];
    // eslint-disable-next-line no-unreachable
    return [{
      kind: 'text_display',
      meta: [
        { key: 11, type: 'vector3', value: { x: 0, y: NICK_Y, z: 0 } },
        { key: 15, type: 'byte', value: 3 },
        { key: 23, type: 'component', value: this.nickChat(p.name, p.uuid) },
        { key: 25, type: 'int', value: 0x40000000 },                      // vanilla-like translucent background
        { key: 27, type: 'byte', value: 2 }                                // see-through, like the vanilla name tag
      ]
    }];
  }
  nickChat(name, uuid) {
    const srv = this.srvName.get(uuid);
    if (!this.isEmptyChat(srv)) return this.wrap([this.item(srv)]);
    const items = []; const tb = this.teamOf(name);
    if (tb && !this.isEmptyChat(tb.prefix)) items.push(this.item(tb.prefix));
    const f = tb && typeof tb.formatting === 'number' && tb.formatting >= 0 && tb.formatting < 16 ? COLORS[tb.formatting] : null;
    items.push(this.part(f ? { text: name, color: f } : { text: name }));
    if (tb && !this.isEmptyChat(tb.suffix)) items.push(this.item(tb.suffix));
    return this.wrap(items);
  }

  lineParts(spec) {
    const r = this.s.riders;
    if (r.legacy) {
      // 1.16.5: no display entities. A small invisible stand rides the player and carries a marker stand whose
      // custom name is the line (a marker stand has no height, the name hangs 0.5 above the stand).
      return [
        { kind: 'armor_stand', meta: [{ key: 0, type: 'byte', value: 0x20 }, { key: 14, type: 'byte', value: 0x01 }] },
        { kind: 'armor_stand', mountOn: 0, meta: [{ key: 0, type: 'byte', value: 0x20 }, { key: 2, type: 'optional_component', value: this.lineChat(spec) }, { key: 3, type: 'boolean', value: true }, { key: 14, type: 'byte', value: 0x11 }] }
      ];
    }
    return [{
      kind: 'text_display',
      meta: [
        { key: 11, type: 'vector3', value: { x: 0, y: LINE_Y, z: 0 } },   // translation
        // billboard: vertical (1). With "center" (3) the game applies the translation AFTER turning the text towards the camera,
        // so the offset was rotated by the camera pitch/yaw and the line slid around the head when the camera moved.
        // Vertical only turns the text around the Y axis, so "0.82 up" always stays straight above the head.
        { key: 15, type: 'byte', value: 1 },
        { key: 23, type: 'component', value: this.lineChat(spec) },
        { key: 25, type: 'int', value: 0x40000000 },                       // vanilla-like translucent background, same as the nick
        { key: 27, type: 'byte', value: 2 }                                // see-through, like the vanilla name tag
      ]
    }];
  }
}

module.exports = { Nametags, normHost };
