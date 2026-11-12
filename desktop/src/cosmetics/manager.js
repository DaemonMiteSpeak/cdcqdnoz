'use strict';
// Cosmetics for one proxy session: decides who wears what, rewrites the held weapon (item_model component) of the players,
// spawns the animated pets (pets.js) and drives the resource pack.
// Only two categories exist: WEAPON (the sword in the hand is replaced by the model, nothing is drawn on the back) and PET.
// Cosmetics are shown ONLY for Hider users (presence list of the host) and for the own player; there is no debug mode.
// Active for 1.21.4+ (item_model component / items/*.json definitions); older versions simply have no cosmetics.
const { CosmeticPack, loadCatalog, setAssets } = require('./pack');
const { PackManager, PackServer } = require('./packs');
const { Pets } = require('./pets');
const { quatOf } = require('./rig');
const { normHost } = require('../nametags');

const ENABLED = process.env.HIDER_COSMETICS !== '0';   // on by default; HIDER_COSMETICS=0 switches the whole thing off
const MIN_PV = 769;                                    // item_model component / items/*.json definitions: 1.21.4+
const WEAPON_RE = /(_sword|_axe|_spear)$|^(trident|mace)$/;
const PLAYER_SCALE = 0.9375;
const ROT_Y180 = [[-1, 0, 0], [0, 1, 0], [0, 0, -1]];      // source models look to -Z, entities look to +Z at yaw 0
const SPAWNS = new Set(['named_entity_spawn', 'spawn_entity', 'player_info', 'player_remove']);

let SHARED = null;      // one local pack server per app run

class Cosmetics {
  constructor(session, opts) {
    this.s = session; opts = opts || {};
    this.supported = ENABLED && session.pv >= MIN_PV && !session.riders.legacy && !!session.mcData.itemsByName.stick;
    this.cat = null; this.pack = null; this.pets = null; this.packs = null;
    this.own = {}; this.selfView = false; this.users = []; this.hostKey = normHost(session.host + (session.port ? ':' + session.port : ''));
    this.mainhand = new Map();           // eid -> { item, name, slot }
    this.held = new Map();               // eid -> ref (weapon rewrite currently applied)
    this.winLen = new Map();             // container window id -> number of slots (the last 36 are the player's own inventory)
    this.petsNeed = false; this.heldTimer = null; this.heldSoon = null;
    if (this.supported) {
      try {
        this.cat = loadCatalog();
        this.pack = new CosmeticPack();
        if (!SHARED) SHARED = new PackServer();
        this.packs = new PackManager(session, this, SHARED);
        // the weapon of the player itself lives in his own inventory: swords there are shown with the cosmetic model
        session.snap.itemHook = (item, windowId) => this.selfItem(item, windowId);
        this.pets = new Pets(session, this); this.pets.start();
        // safety net: whatever made the vanilla sword show up again (late spawn, odd server packet), it is put back within 1.5 s
        this.heldTimer = setInterval(() => { try { this.syncHeld(); } catch { /* ignore */ } }, 1500); this.heldTimer.unref && this.heldTimer.unref();
      } catch (e) { this.supported = false; this.pack = null; this.pets = null; session.log('warn', 'COS', 'cosmetics disabled: ' + e.message); }
    }
  }
  available() { return this.supported && !!this.pack; }
  // does anybody on screen wear something that needs the pack on the client?
  othersWear() { return this.users.some(u => u && u.nick && u.cos && (!u.server || normHost(u.server) === this.hostKey) && (u.cos.weapon || u.cos.pet)); }
  wantStandalone() {
    const customPet = id => { const item = id && this.cat && this.cat.items.find(x => x.id === id); return !!(item && !item.mob); };
    return Object.keys(this.own).some(slot => slot !== 'pet') || customPet(this.own.pet)
      || this.users.some(u => u && u.nick && u.cos && (!u.server || normHost(u.server) === this.hostKey) && (u.cos.weapon || customPet(u.cos.pet)));
  }
  dispose() { clearInterval(this.heldTimer); clearTimeout(this.heldSoon); if (this.pets) this.pets.stop(); }
  reset() { this.mainhand.clear(); this.held.clear(); this.winLen.clear(); this.petsNeed = false; if (this.packs) this.packs.reset(); if (this.pets) this.pets.clearAll(false); }
  // stream hook (Session.onUp, after the packet was forwarded)
  observe(name) {
    if (this.pets) this.pets.observe(name);
    if (SPAWNS.has(name) && this.mainhand.size && !this.heldSoon) {
      this.heldSoon = setTimeout(() => { this.heldSoon = null; try { this.syncHeld(); } catch { /* ignore */ } }, 80);
      this.heldSoon.unref && this.heldSoon.unref();
    }
  }
  // somebody (own player or a Hider user in presence) may have a pet: lets the pet loop sleep otherwise
  mayHavePets() {
    if (!this.pets || !this.cat) return false;
    const hasPet = id => { const it = id && this.cat.items.find(x => x.id === id); return !!(it && it.slot === 'pet'); };
    if (hasPet(this.own.pet)) return true;
    return this.users.some(u => u && u.cos && hasPet(u.cos.pet));
  }
  // roles were switched: bring the screens of both clients to a known state again
  afterRoleSwitch() {
    if (!this.available()) return;
    try { if (this.packs) this.packs.ensureOwn(); } catch { /* ignore */ }
    try { this.s.riders.refreshAll(); } catch { /* ignore */ }
    try { if (this.pets) this.pets.refreshAll(); } catch { /* ignore */ }
    this.held.clear();
    for (const [eid, mh] of this.mainhand) { const ref = this.heldRefFor(eid, mh.name); if (ref) this.held.set(eid, ref); this.sendHand(eid, mh, ref); }
    this.resendInventory();
  }

  /* ---------- state from the app ---------- */
  setOwn(eq) {
    const prevWeapon = this.own.weapon;
    this.own = this.clean(eq); this.changed();
    if (this.packs && Object.keys(this.own).length) this.packs.ensureOwn();
    if (this.own.weapon !== prevWeapon) this.resendInventory();
  }
  // third-person camera: kept for the app (pets of the own player are always shown, the weapon lives in the hand)
  setSelfView(v) { v = !!v; if (v === this.selfView) return; this.selfView = v; this.changed(); }
  setPresence(users) {
    this.users = Array.isArray(users) ? users : []; this.changed();
    if (this.packs && this.othersWear()) this.packs.ensureOwn();
  }
  clean(eq) {
    const out = {}; if (!eq || typeof eq !== 'object' || !this.cat) return out;
    for (const it of this.cat.items) if (eq[it.slot] === it.id) out[it.slot] = it.id;
    return out;
  }
  changed() { if (!this.supported) return; this.syncHeld(); if (this.pets) this.pets.refreshAll(); }

  /* ---------- who wears what ---------- */
  userFor(name) {
    if (!name) return null;
    const n = String(name).toLowerCase();
    for (const u of this.users) if (u && u.nick && String(u.nick).toLowerCase() === n && normHost(u.server) === this.hostKey) return u;
    return null;
  }
  // only the own player and Hider users (same host) wear cosmetics
  equippedFor(p) {
    if (p.self) return this.own;
    const u = this.userFor(p.name);
    return u ? this.clean(u.cos) : null;
  }

  /* ---------- item_display helpers (used by pets.js) ---------- */
  stack(ref) {
    const stick = this.s.mcData.itemsByName.stick.id;
    return { itemCount: 1, itemId: stick, addedComponentCount: 1, removedComponentCount: 0, components: [{ type: 'item_model', data: ref }], removeComponents: [] };
  }

  /* ---------- held weapon (item_model rewrite) ---------- */
  heldRefFor(eid, itemName) {
    if (!this.available() || !itemName || !WEAPON_RE.test(itemName)) return null;
    const p = this.s.riders.players().get(eid); if (!p || p.self) return null;
    const eq = this.equippedFor(p); const id = eq && eq.weapon; if (!id) return null;
    const it = this.pack.items.get(id);
    return it && it.held ? it.held.ref : null;
  }
  rewritten(item, ref) {
    const comps = (item.components || []).filter(c => c.type !== 'item_model').concat([{ type: 'item_model', data: ref }]);
    return Object.assign({}, item, { addedComponentCount: comps.length, components: comps });
  }
  // returns a buffer to forward instead of `buf`, or `buf` itself
  filterEquipment(d, buf) {
    if (!this.available() || !Array.isArray(d.equipments)) return buf;
    let changed = false; const eqs = d.equipments.map(e => {
      if ((e.slot & 0x7f) !== 0) return e;
      if (!e.item || !e.item.itemCount || e.item.itemId === undefined) { this.mainhand.delete(d.entityId); this.held.delete(d.entityId); return e; }
      const def = this.s.mcData.items[e.item.itemId]; const name = def && def.name;
      this.mainhand.set(d.entityId, { item: e.item, name, slot: e.slot });
      const ref = this.heldRefFor(d.entityId, name);
      if (ref) { this.held.set(d.entityId, ref); changed = true; return Object.assign({}, e, { item: this.rewritten(e.item, ref) }); }
      this.held.delete(d.entityId); return e;
    });
    if (!changed) return buf;
    return this.s.build('entity_equipment', Object.assign({}, d, { equipments: eqs })) || buf;
  }
  sendHand(eid, mh, ref) {
    const item = ref ? this.rewritten(mh.item, ref) : mh.item;
    const b = this.s.build('entity_equipment', { entityId: eid, equipments: [{ slot: mh.slot, item }] });
    this.s.riders.send(b);
  }
  // players whose cosmetics changed (or whose hand packet came before we knew who they are): resend their main hand
  syncHeld() {
    if (!this.available() || !this.s.ready) return;
    for (const [eid, mh] of this.mainhand) {
      const ref = this.heldRefFor(eid, mh.name); const cur = this.held.get(eid) || null;
      if (ref === cur) continue;
      if (ref) this.held.set(eid, ref); else this.held.delete(eid);
      this.sendHand(eid, mh, ref);
    }
  }
  onDestroy(ids) { for (const id of ids || []) { this.mainhand.delete(id); this.held.delete(id); } }
  // a client just received the snapshot (which holds the vanilla hand packets): put the cosmetic weapons back for it
  replayTo(peer) {
    if (!this.available()) return;
    for (const [eid, ref] of this.held) {
      const mh = this.mainhand.get(eid); if (!mh) continue;
      const b = this.s.build('entity_equipment', { entityId: eid, equipments: [{ slot: mh.slot, item: this.rewritten(mh.item, ref) }] });
      if (b) peer.send(b, 'play');
    }
  }

  /* ---------- the player's own weapon: every sword in his inventory is drawn with the cosmetic model ---------- */
  // item_model ref of the equipped weapon (null = nothing to do)
  selfWeaponRef() {
    if (!this.available()) return null;
    const id = this.own.weapon; const it = id && this.pack.items.get(id);
    return it && it.held ? it.held.ref : null;
  }
  // one item stack of the own inventory -> the same stack (nothing to change) or a copy with the cosmetic item_model
  selfItem(item, windowId) {
    if (windowId !== 0 && windowId !== -1) return item;           // player inventory (and the cursor) only, not chest slots
    const ref = this.selfWeaponRef(); if (!ref || !item || !item.itemCount || item.itemId === undefined) return item;
    const def = this.s.mcData.items[item.itemId];
    return def && WEAPON_RE.test(def.name) ? this.rewritten(item, ref) : item;
  }
  // server -> client inventory packets of the own player (called from Session.onUp), returns the buffer to forward.
  // Containers (chest, crafting table ...) contain the player's own inventory as their last 36 slots: those are rewritten too,
  // otherwise opening a chest showed the vanilla sword again.
  filterInventory(name, d, buf) {
    if (name === 'window_items' && d.windowId !== 0 && Array.isArray(d.items)) this.winLen.set(d.windowId, d.items.length);
    if (!this.selfWeaponRef()) return buf;
    let p = null;
    switch (name) {
      case 'window_items': {
        if (!Array.isArray(d.items)) return buf;
        const n = d.items.length;
        const from = d.windowId === 0 ? 0 : Math.max(0, n - 36);
        const items = d.items.map((i, k) => (k >= from ? this.selfItem(i, 0) : i));
        const carried = d.carriedItem === undefined ? undefined : this.selfItem(d.carriedItem, 0);
        if (items.every((i, k) => i === d.items[k]) && carried === d.carriedItem) return buf;
        p = Object.assign({}, d, { items }); if (carried !== undefined) p.carriedItem = carried;
        break;
      }
      case 'set_slot': {
        let ok = d.windowId === 0 || d.windowId === -1;
        if (!ok) { const n = this.winLen.get(d.windowId); ok = n !== undefined && d.slot >= n - 36; }
        if (!ok) return buf;
        const item = this.selfItem(d.item, 0); if (item === d.item) return buf;
        p = Object.assign({}, d, { item }); break;
      }
      case 'set_cursor_item': case 'set_player_inventory': {
        const contents = this.selfItem(d.contents, 0); if (contents === d.contents) return buf;
        p = Object.assign({}, d, { contents }); break;
      }
      default: return buf;
    }
    return this.s.build(name, p) || buf;
  }
  // the weapon (or its model) changed: show the inventory again with / without the cosmetic models
  resendInventory() {
    if (!this.available() || !this.s.ready || !this.s.snap) return;
    try { for (const b of this.s.snap.inventoryPackets()) this.s.riders.send(b); } catch { /* ignore */ }
  }
  // client -> server (set_creative_slot): never let our item_model component reach the real server
  unrewrite(item) {
    if (!this.pack || !item || !Array.isArray(item.components)) return item;
    const prefix = this.pack.ns + ':';
    const comps = item.components.filter(c => !(c.type === 'item_model' && typeof c.data === 'string' && c.data.startsWith(prefix)));
    if (comps.length === item.components.length) return item;
    return Object.assign({}, item, { addedComponentCount: comps.length, components: comps });
  }
}

module.exports = { Cosmetics, quatOf, ROT_Y180, WEAPON_RE, PLAYER_SCALE, setCosmeticAssets: setAssets };
