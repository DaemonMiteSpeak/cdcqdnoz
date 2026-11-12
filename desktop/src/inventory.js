'use strict';
// Server-authoritative inventory model + emulation of the controller's clicks.
// Used to (a) mirror the controller's inventory actions to observers and (b) hand a correct
// inventory to the client that becomes controller after a role switch.

function jstr(o) {
  return JSON.stringify(o, (k, v) => (typeof v === 'bigint' ? v.toString() + 'n' : (v && v.type === 'Buffer' && Array.isArray(v.data) ? 'buf:' + v.data.length + ':' + v.data.slice(0, 64).join(',') : v)));
}

class Inventory {
  constructor(mcData) {
    this.mc = mcData;
    this.pv = mcData.version.version;
    this.windows = new Map(); // id -> { slots: [item|null], stateId }
    this.cursor = null;
    this.held = 0;
    this.drag = null;
    this.emptyTpl = this.pv >= 766 ? { itemCount: 0 } : (this.pv >= 393 ? { present: false } : { blockId: -1 });
    this.hasCursorPacket = !!(mcData.protocol.play.toClient.types && mcData.protocol.play.toClient.types.packet_set_cursor_item);
    this.hasStateId = this.pv >= 756;
  }

  reset() { this.windows.clear(); this.cursor = null; this.drag = null; }

  isEmpty(it) {
    if (!it) return true;
    if (it.present === false) return true;
    if (it.itemCount === 0 || it.itemCount < 0) return true;
    if (it.blockId === -1) return true;
    if (it.itemId === undefined && it.blockId === undefined && it.present === undefined && it.itemCount === undefined) return true;
    return false;
  }
  norm(it) { return this.isEmpty(it) ? null : it; }
  out(it) { return it || this.emptyTpl; }
  idOf(it) { return it.itemId !== undefined ? it.itemId : it.blockId; }
  maxStack(it) {
    const m = this.mc.items && this.mc.items[this.idOf(it)];
    return (m && m.stackSize) || 64;
  }
  withCount(it, n) { return Object.assign({}, it, { itemCount: n }); }
  same(a, b) {
    if (!a || !b) return false;
    if (this.idOf(a) !== this.idOf(b)) return false;
    const sa = Object.assign({}, a); const sb = Object.assign({}, b);
    delete sa.itemCount; delete sb.itemCount;
    return jstr(sa) === jstr(sb);
  }

  win(id) { return this.windows.get(id); }

  /* ----- server-driven updates ----- */
  setWindowItems(windowId, items, stateId, carried) {
    this.windows.set(windowId, { slots: (items || []).map(i => this.norm(i)), stateId: stateId || 0 });
    if (carried !== undefined) this.cursor = this.norm(carried);
  }
  setSlot(windowId, slot, item, stateId) {
    const n = this.norm(item);
    if (windowId === -1) { this.cursor = n; return; }
    const w = this.windows.get(windowId);
    if (!w) return;
    if (stateId !== undefined) w.stateId = stateId;
    if (slot >= 0 && slot < w.slots.length) w.slots[slot] = n;
  }
  setCursor(item) { this.cursor = this.norm(item); }
  // 1.21.2+: set_player_inventory { slotId, contents } uses inventory indexes
  setPlayerInventory(slotId, item) {
    const w = this.windows.get(0); if (!w) return;
    let s;
    if (slotId >= 0 && slotId <= 8) s = 36 + slotId; else if (slotId <= 35) s = slotId;
    else if (slotId >= 36 && slotId <= 39) s = 8 - (slotId - 36); else if (slotId === 40) s = 45; else return;
    w.slots[s] = this.norm(item);
  }
  closeWindow(id) { if (id !== 0) this.windows.delete(id); this.drag = null; }

  snapshotOf(w) { return w.slots.slice(); }

  /* ----- click emulation ----- */
  // returns { changed: [{windowId, slot, item}], cursor: bool } or null if unknown
  click(pkt) {
    const wid = pkt.windowId;
    const w = this.windows.get(wid);
    if (!w) return null;
    const before = w.slots.slice();
    const beforeCursor = this.cursor;
    try { this._click(w, pkt); } catch (e) { return null; }
    const changed = [];
    for (let i = 0; i < w.slots.length; i++) if (w.slots[i] !== before[i]) changed.push({ windowId: wid, slot: i, item: this.out(w.slots[i]), stateId: w.stateId });
    return { changed, cursor: this.cursor !== beforeCursor };
  }

  _hotbarSlot(w, wid, b) {
    const n = w.slots.length;
    if (b >= 0 && b <= 8) return wid === 0 ? 36 + b : n - 9 + b;
    if (b === 40 && wid === 0 && n > 45) return 45;
    return -1;
  }

  _click(w, pkt) {
    const wid = pkt.windowId; const slot = pkt.slot; const btn = pkt.mouseButton; const mode = pkt.mode;
    const S = w.slots;
    if (mode === 5) return this._drag(w, wid, slot, btn);
    if (mode === 0) {
      if (slot === -999) {
        if (this.cursor) { this.cursor = btn === 0 ? null : (this.cursor.itemCount > 1 ? this.withCount(this.cursor, this.cursor.itemCount - 1) : null); }
        return;
      }
      if (slot < 0 || slot >= S.length) return;
      if (wid === 0 && slot === 0) { // crafting result: take it into cursor if possible
        return;
      }
      const cur = this.cursor; const it = S[slot];
      if (btn === 0) {
        if (!cur) { this.cursor = it; S[slot] = null; return; }
        if (!it) { S[slot] = cur; this.cursor = null; return; }
        if (this.same(cur, it)) {
          const max = this.maxStack(it);
          const room = max - it.itemCount;
          if (room <= 0) return;
          const mv = Math.min(room, cur.itemCount);
          S[slot] = this.withCount(it, it.itemCount + mv);
          this.cursor = cur.itemCount - mv > 0 ? this.withCount(cur, cur.itemCount - mv) : null;
          return;
        }
        S[slot] = cur; this.cursor = it; return;
      }
      if (btn === 1) {
        if (!cur) {
          if (!it) return;
          const take = Math.ceil(it.itemCount / 2);
          this.cursor = this.withCount(it, take);
          S[slot] = it.itemCount - take > 0 ? this.withCount(it, it.itemCount - take) : null;
          return;
        }
        if (!it) { S[slot] = this.withCount(cur, 1); this.cursor = cur.itemCount > 1 ? this.withCount(cur, cur.itemCount - 1) : null; return; }
        if (this.same(cur, it)) {
          if (it.itemCount >= this.maxStack(it)) return;
          S[slot] = this.withCount(it, it.itemCount + 1);
          this.cursor = cur.itemCount > 1 ? this.withCount(cur, cur.itemCount - 1) : null;
          return;
        }
        S[slot] = cur; this.cursor = it; return;
      }
      return;
    }
    if (mode === 1) { return this._shift(w, wid, slot); }
    if (mode === 2) {
      if (slot < 0 || slot >= S.length) return;
      const h = this._hotbarSlot(w, wid, btn);
      if (h < 0 || h === slot) return;
      const a = S[slot]; S[slot] = S[h]; S[h] = a; return;
    }
    if (mode === 4) {
      if (slot < 0 || slot >= S.length) return;
      const it = S[slot]; if (!it) return;
      if (btn === 0) S[slot] = it.itemCount > 1 ? this.withCount(it, it.itemCount - 1) : null; else S[slot] = null;
      return;
    }
    if (mode === 6) {
      const cur = this.cursor; if (!cur) return;
      const max = this.maxStack(cur);
      let have = cur.itemCount;
      for (const pass of [0, 1]) {
        for (let i = 0; i < S.length && have < max; i++) {
          if (wid === 0 && i === 0) continue;
          const it = S[i]; if (!it || !this.same(cur, it)) continue;
          const full = it.itemCount >= this.maxStack(it);
          if ((pass === 0 && full) || (pass === 1 && !full)) continue;
          const take = Math.min(max - have, it.itemCount);
          have += take;
          S[i] = it.itemCount - take > 0 ? this.withCount(it, it.itemCount - take) : null;
        }
      }
      this.cursor = this.withCount(cur, have);
      return;
    }
  }

  _drag(w, wid, slot, btn) {
    const S = w.slots;
    const phase = btn & 3; // 0 start, 1 add, 2 end
    const kind = btn >> 2; // 0 left, 1 right, 2 middle
    if (phase === 0) { this.drag = { kind, slots: [] }; return; }
    if (!this.drag) return;
    if (phase === 1) {
      if (slot >= 0 && slot < S.length && !(wid === 0 && slot === 0) && !this.drag.slots.includes(slot)) this.drag.slots.push(slot);
      return;
    }
    // end
    const d = this.drag; this.drag = null;
    let cur = this.cursor; if (!cur || !d.slots.length) return;
    if (d.kind === 2) return;
    const per = d.kind === 0 ? Math.floor(cur.itemCount / d.slots.length) : 1;
    if (per < 1) return;
    let left = cur.itemCount;
    for (const s of d.slots) {
      if (left <= 0) break;
      const it = S[s];
      if (it && !this.same(cur, it)) continue;
      const have = it ? it.itemCount : 0;
      const put = Math.min(per, this.maxStack(cur) - have, left);
      if (put <= 0) continue;
      S[s] = this.withCount(cur, have + put);
      left -= put;
    }
    this.cursor = left > 0 ? this.withCount(cur, left) : null;
  }

  _isArmor(it) {
    const m = this.mc.items && this.mc.items[this.idOf(it)];
    const n = m ? m.name : '';
    if (/helmet$|^carved_pumpkin$|_head$|_skull$/.test(n)) return 5;
    if (/_chestplate$|^elytra$/.test(n)) return 6;
    if (/_leggings$/.test(n)) return 7;
    if (/_boots$/.test(n)) return 8;
    return -1;
  }

  // vanilla moveItemStackTo
  _moveTo(S, idx, start, end, reverse, skip0) {
    let it = S[idx];
    const order = [];
    if (reverse) for (let i = end - 1; i >= start; i--) order.push(i); else for (let i = start; i < end; i++) order.push(i);
    const max = this.maxStack(it);
    let n = it.itemCount;
    for (const i of order) {
      if (n <= 0) break;
      if (skip0 && i === 0) continue;
      const t = S[i];
      if (t && this.same(it, t) && t.itemCount < max) {
        const mv = Math.min(max - t.itemCount, n);
        S[i] = this.withCount(t, t.itemCount + mv); n -= mv;
      }
    }
    for (const i of order) {
      if (n <= 0) break;
      if (skip0 && i === 0) continue;
      if (!S[i]) { const mv = Math.min(max, n); S[i] = this.withCount(it, mv); n -= mv; }
    }
    S[idx] = n > 0 ? this.withCount(it, n) : null;
    return n !== it.itemCount;
  }

  _shift(w, wid, slot) {
    const S = w.slots; const N = S.length;
    if (slot < 0 || slot >= N || !S[slot]) return;
    if (wid === 0) {
      if (slot === 0) { return; }
      if (slot >= 1 && slot <= 4) { this._moveTo(S, slot, 9, 45, false); return; }
      if (slot >= 5 && slot <= 8) { this._moveTo(S, slot, 9, 45, false); return; }
      if (slot >= 9 && slot <= 35) {
        const a = this._isArmor(S[slot]);
        if (a > 0 && !S[a]) { S[a] = S[slot]; S[slot] = null; return; }
        this._moveTo(S, slot, 36, 45, false); return;
      }
      if (slot >= 36 && slot <= 44) {
        const a = this._isArmor(S[slot]);
        if (a > 0 && !S[a]) { S[a] = S[slot]; S[slot] = null; return; }
        this._moveTo(S, slot, 9, 36, false); return;
      }
      if (slot === 45) { this._moveTo(S, slot, 9, 45, false); return; }
      return;
    }
    const cont = N - 36;
    if (slot < cont) this._moveTo(S, slot, cont, N, true); else this._moveTo(S, slot, 0, cont, false);
  }
}

module.exports = { Inventory, jstr };
