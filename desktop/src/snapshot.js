'use strict';
// Records the clientbound play-state stream coming from the real server so that a second client
// (observer) can be brought to exactly the same state later, and so a client that becomes
// controller can be re-synced. Pure bookkeeping: nothing here talks to sockets.
const { Inventory } = require('./inventory');
const { World } = require('./world');

const GSC_NUM = ['no_respawn_block_available', 'start_raining', 'stop_raining', 'change_game_mode', 'win_game', 'demo_event', 'play_arrow_hit_sound', 'rain_level_change', 'thunder_level_change', 'puffer_fish_sting', 'guardian_elder_effect', 'immediate_respawn', 'limited_crafting', 'level_chunks_load_start'];
const GSC_SKIP = new Set(['no_respawn_block_available', 'win_game', 'demo_event', 'play_arrow_hit_sound', 'puffer_fish_sting', 'guardian_elder_effect']);

// singletons: last packet with this name wins
const SINGLE = new Set([
  'update_view_distance', 'update_view_position', 'simulation_distance', 'spawn_position', 'difficulty', 'abilities',
  'initialize_world_border', 'world_border_center', 'world_border_lerp_size', 'world_border_size', 'world_border_warning_delay', 'world_border_warning_reach',
  'declare_commands', 'declare_recipes', 'tags', 'recipe_book_settings', 'server_data', 'playerlist_header', 'update_time', 'experience',
  'update_health', 'set_ticking_state', 'held_item_slot'
]);
const ENT_ATTACH = new Set(['entity_metadata', 'entity_equipment', 'entity_head_rotation', 'entity_update_attributes', 'set_passengers', 'attach_entity']);
const SPAWN = new Set(['spawn_entity', 'spawn_entity_living', 'spawn_entity_painting', 'spawn_entity_experience_orb', 'named_entity_spawn']);
const TEAM_MODE = { add: 0, create: 0, remove: 1, change: 2, update: 2, join: 3, add_players: 3, leave: 4, remove_players: 4 };
const BAR_ACTION = { add: 0, remove: 1, update_health: 2, update_title: 3, update_style: 4, update_flags: 5, health: 2, title: 3, style: 4, flags: 5 };

function num(v, map) { return typeof v === 'number' ? v : (map && map[v] !== undefined ? map[v] : -1); }
function uuidOf(e) { return String(e.UUID || e.uuid || (e.player && e.player.uuid) || ''); }

class Snapshot {
  constructor(ctx) {
    this.ctx = ctx; // { mc, build(name, params) -> Buffer|null }
    this.inv = new Inventory(ctx.mc);
    this.world = new World(ctx.mc); // block collision map for the pets (see world.js)
    this.resetAll();
  }

  resetAll() {
    this.login = null; this.respawn = null; this.selfId = null;
    this.singles = new Map();
    this.tab = new Map();
    this.objectives = new Map(); this.scores = new Map(); this.displays = new Map(); this.teams = new Map(); this.bars = new Map();
    this.maps = new Map(); this.payloads = new Map();
    this.openWindow = null;
    this.inv.reset();
    this.resetWorld();
  }

  resetWorld() {
    if (this.world) this.world.reset();
    this.chunks = new Map();
    this.entities = new Map();
    this.mbc = 0;
    this.openWindow = null;
  }

  chunkKey(x, z) { return x + ',' + z; }

  record(name, d, buf) {
    this.world.record(name, d); // never throws
    switch (name) {
      case 'login': this.resetAll(); this.login = { buf }; this.selfId = d.entityId; return;
      case 'respawn': this.resetWorld(); this.respawn = { buf }; return;
      case 'map_chunk': {
        const k = this.chunkKey(d.x, d.z);
        const e = this.chunks.get(k);
        if (e && !e.map && e.light) { e.map = buf; e.extra = new Map(); }
        else this.chunks.set(k, { map: buf, light: null, lightFirst: false, extra: new Map() });
        return;
      }
      case 'update_light': {
        const k = this.chunkKey(d.chunkX, d.chunkZ);
        let e = this.chunks.get(k);
        if (!e) { e = { map: null, light: null, lightFirst: true, extra: new Map() }; this.chunks.set(k, e); }
        e.light = buf; return;
      }
      case 'unload_chunk': this.chunks.delete(this.chunkKey(d.chunkX, d.chunkZ)); return;
      case 'block_change': {
        const l = d.location; const e = this.chunks.get(this.chunkKey(l.x >> 4, l.z >> 4));
        if (e) { const k = 'b' + l.x + ',' + l.y + ',' + l.z; e.extra.delete(k); e.extra.set(k, buf); this.cap(e); }
        return;
      }
      case 'multi_block_change': {
        const c = d.chunkCoordinates; const e = c && this.chunks.get(this.chunkKey(c.x, c.z));
        if (e) { e.extra.set('m' + (this.mbc++), buf); this.cap(e); }
        return;
      }
      case 'tile_entity_data': {
        const l = d.location; const e = this.chunks.get(this.chunkKey(l.x >> 4, l.z >> 4));
        if (e) { const k = 't' + l.x + ',' + l.y + ',' + l.z; e.extra.delete(k); e.extra.set(k, buf); this.cap(e); }
        return;
      }
      case 'game_state_change': {
        const r = typeof d.reason === 'number' ? GSC_NUM[d.reason] : d.reason;
        if (!r || GSC_SKIP.has(r)) return;
        this.singles.delete('gsc:' + r); this.singles.set('gsc:' + r, { buf, name }); return;
      }
      case 'custom_payload': {
        const ch = String(d.channel || '');
        if (/brand$/i.test(ch)) this.payloads.set(ch, buf);
        return;
      }
      case 'entity_status':
        if (d.entityId === this.selfId && d.entityStatus >= 24 && d.entityStatus <= 28) this.singles.set('es', { buf, name });
        return;
      case 'scoreboard_display_objective': this.displays.set(String(d.position), buf); return;
      case 'scoreboard_objective': {
        const a = num(d.action);
        if (a === 1) { this.objectives.delete(d.name); for (const k of [...this.scores.keys()]) if (k.endsWith('|' + d.name)) this.scores.delete(k); }
        else if (a === 0) this.objectives.set(d.name, Object.assign({}, d));
        else if (a === 2) { const o = this.objectives.get(d.name); if (o) { const act = o.action; Object.assign(o, d); o.action = act; } }
        return;
      }
      case 'scoreboard_score': {
        const k = d.itemName + '|' + d.scoreName;
        if (num(d.action) === 1) this.scores.delete(k); else { this.scores.delete(k); this.scores.set(k, buf); }
        return;
      }
      case 'reset_score': this.scores.delete((d.entity_name || d.entityName) + '|' + (d.objective_name || d.objectiveName)); return;
      case 'teams': return this.recordTeam(d, buf);
      case 'boss_bar': return this.recordBar(d, buf);
      case 'player_info': return this.recordTab(d);
      case 'player_remove': for (const u of (d.players || [])) this.tab.delete(String(u)); return;
      case 'map': { const k = String(d.itemDamage !== undefined ? d.itemDamage : d.mapId); this.maps.delete(k); this.maps.set(k, buf); return; }
      case 'window_items': {
        this.inv.setWindowItems(d.windowId, d.items, d.stateId, d.carriedItem); return;
      }
      case 'set_slot': this.inv.setSlot(d.windowId, d.slot, d.item, d.stateId); return;
      case 'set_cursor_item': this.inv.setCursor(d.contents); return;
      case 'set_player_inventory': this.inv.setPlayerInventory(d.slotId, d.contents); return;
      case 'open_window': this.openWindow = { buf, windowId: d.windowId }; this.inv.windows.delete(d.windowId); return;
      case 'close_window': this.inv.closeWindow(d.windowId); if (this.openWindow && this.openWindow.windowId === d.windowId) this.openWindow = null; return;
      case 'held_item_slot': this.inv.held = d.slot; this.singles.set(name, { buf, name }); return;
      case 'entity_destroy': for (const id of (d.entityIds || [])) this.entities.delete(id); return;
      case 'remove_entity_effect': { const e = this.entities.get(d.entityId); if (e) e.attached.delete('fx' + (d.effectId)); return; }
      case 'entity_effect': { const e = this.ent(d.entityId); if (e) { e.attached.delete('fx' + d.effectId); e.attached.set('fx' + d.effectId, { name, buf }); } return; }
      case 'rel_entity_move': case 'entity_move_look': {
        const e = this.entities.get(d.entityId);
        if (e && e.data) {
          if (typeof e.data.x === 'number') { e.data.x += d.dX / 4096; e.data.y += d.dY / 4096; e.data.z += d.dZ / 4096; }
          if (name === 'entity_move_look') { e.data.yaw = d.yaw; e.data.pitch = d.pitch; }
        }
        return;
      }
      case 'entity_look': { const e = this.entities.get(d.entityId); if (e && e.data) { e.data.yaw = d.yaw; e.data.pitch = d.pitch; } return; }
      case 'entity_teleport': case 'sync_entity_position': {
        const e = this.entities.get(d.entityId);
        if (e && e.data && typeof e.data.x === 'number') { e.data.x = d.x; e.data.y = d.y; e.data.z = d.z; }
        return;
      }
      default: break;
    }
    if (SPAWN.has(name)) {
      const id = d.entityId;
      const prev = this.entities.get(id);
      this.entities.set(id, { name, data: Object.assign({}, d), attached: prev && !prev.name ? prev.attached : new Map() });
      return;
    }
    if (ENT_ATTACH.has(name)) {
      const e = this.ent(d.entityId);
      if (e) { e.attached.delete(name); e.attached.set(name, { name, buf }); }
      return;
    }
    if (SINGLE.has(name)) { this.singles.set(name, { buf, name }); this.lastData = this.lastData || {}; if (name === 'abilities') this.abilities = d; return; }
    if (name === 'craft_progress_bar' && this.openWindow) { this.singles.set('cpb:' + d.windowId + ':' + d.property, { buf, name, late: true }); }
  }

  cap(e) { if (e.extra.size > 4000) { const k = e.extra.keys().next().value; e.extra.delete(k); } }

  ent(id) {
    let e = this.entities.get(id);
    if (!e && id === this.selfId) { e = { name: null, data: null, attached: new Map() }; this.entities.set(id, e); }
    return e;
  }

  recordTab(d) {
    const a = d.action;
    for (const entry of (d.data || [])) {
      const u = uuidOf(entry); if (!u) continue;
      if (a === 'remove_player') { this.tab.delete(u); continue; }
      const pk = { action: a, entry };
      const isAdd = a === 0 || (a && typeof a === 'object' && a.add_player === true);
      const sig = JSON.stringify(a && typeof a === 'object' ? a : String(a));
      let list = this.tab.get(u);
      if (isAdd || !list) { if (!isAdd && !list) { /* update for unknown uuid */ } this.tab.set(u, [{ sig, params: { action: a, data: [entry] } }]); continue; }
      const i = list.findIndex(x => x.sig === sig);
      const item = { sig, params: { action: a, data: [entry] } };
      if (i >= 0) list[i] = item; else list.push(item);
    }
  }

  recordTeam(d, buf) {
    const m = num(d.mode, TEAM_MODE);
    const t = d.team;
    if (m === 0) { this.teams.set(t, { base: Object.assign({}, d), players: new Set(d.players || []) }); return; }
    const e = this.teams.get(t);
    if (m === 1) { this.teams.delete(t); return; }
    if (!e) return;
    if (m === 2) { const upd = Object.assign({}, d); delete upd.team; delete upd.mode; delete upd.players; Object.assign(e.base, upd); return; }
    if (m === 3) { for (const p of (d.players || [])) e.players.add(p); return; }
    if (m === 4) { for (const p of (d.players || [])) e.players.delete(p); }
  }

  recordBar(d, buf) {
    const a = num(d.action, BAR_ACTION); const u = String(d.entityUUID);
    if (a === 0) { this.bars.set(u, Object.assign({}, d)); return; }
    if (a === 1) { this.bars.delete(u); return; }
    const b = this.bars.get(u); if (!b) return;
    const upd = Object.assign({}, d); delete upd.entityUUID; delete upd.action;
    Object.assign(b, upd);
  }

  /* ---------- replay ---------- */
  // opts: { observer: bool, abilitiesFor(d)->Buffer, position()->Buffer|null }
  replay(opts = {}) {
    const out = [];
    const push = (b) => { if (b) out.push(b); };
    const build = (n, p) => this.ctx.build(n, p);
    if (!this.login) return out;
    push(this.login.buf);
    if (this.respawn) push(this.respawn.buf);
    for (const b of this.payloads.values()) push(b);
    for (const [k, v] of this.singles) {
      if (k.startsWith('gsc:') && k === 'gsc:level_chunks_load_start') continue;
      if (v.late || k === 'held_item_slot') continue;
      if (v.name === 'abilities' && opts.abilitiesFor && this.abilities) { push(opts.abilitiesFor(this.abilities)); continue; }
      push(v.buf);
    }
    // tab list, scoreboard, teams, boss bars
    for (const list of this.tab.values()) for (const it of list) push(build('player_info', it.params));
    for (const o of this.objectives.values()) push(build('scoreboard_objective', o));
    for (const b of this.displays.values()) push(b);
    for (const [, t] of this.teams) push(build('teams', Object.assign({}, t.base, { players: [...t.players] })));
    for (const b of this.scores.values()) push(b);
    for (const b of this.bars.values()) push(build('boss_bar', b));
    for (const b of this.maps.values()) push(b);
    // chunks
    for (const e of this.chunks.values()) {
      if (e.lightFirst) { push(e.light); push(e.map); } else { push(e.map); push(e.light); }
      if (e.map) for (const b of e.extra.values()) push(b);
    }
    // entities: spawns first, then their state, then passenger links
    const links = [];
    for (const e of this.entities.values()) if (e.name && e.data) push(build(e.name, e.data));
    for (const e of this.entities.values()) {
      for (const [k, v] of e.attached) { if (k === 'set_passengers' || k === 'attach_entity') links.push(v.buf); else push(v.buf); }
    }
    for (const b of links) push(b);
    // inventory
    this.replayInventory(push, build);
    const pos = opts.position && opts.position();
    push(pos);
    const gsc = this.singles.get('gsc:level_chunks_load_start'); if (gsc) push(gsc.buf);
    return out;
  }

  inventoryPackets() {
    const out = [];
    this.replayInventory(b => b && out.push(b), (n, p) => this.ctx.build(n, p));
    return out;
  }

  replayInventory(push, build) {
    const inv = this.inv;
    const w0 = inv.windows.get(0);
    const held = this.singles.get('held_item_slot'); if (held) push(held.buf);
    // itemHook (set by the cosmetics manager) may show a stack differently (own sword -> cosmetic model); the model itself stays untouched
    const hook = (it, wid) => (this.itemHook ? this.itemHook(it, wid) : it);
    const sendWin = (id, w) => {
      const items = w.slots.map(s => hook(inv.out(s), id));
      const cursor = hook(inv.out(inv.cursor), id);
      if (inv.hasStateId) push(build('window_items', { windowId: id, stateId: w.stateId || 0, items, carriedItem: cursor }));
      else { push(build('window_items', { windowId: id, items })); push(build('set_slot', { windowId: -1, slot: -1, item: cursor })); }
    };
    if (w0) sendWin(0, w0);
    if (this.openWindow) {
      push(this.openWindow.buf);
      const w = inv.windows.get(this.openWindow.windowId);
      if (w) sendWin(this.openWindow.windowId, w);
      for (const v of this.singles.values()) if (v.late) push(v.buf);
    }
  }
}

module.exports = { Snapshot };

