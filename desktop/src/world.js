'use strict';
// World map for the pets.
//
// The proxy never simulates the world, but it sees every chunk and block update the server sends to the client.
// This keeps a light copy of it (per block: air / solid / water-or-hazard / tall solid) so pets can collide with blocks.
// Chunks are parsed lazily: only the chunks a pet actually touches are ever decoded.
//
// Supported: 1.18+ (paletted chunk sections). Older versions simply report "not usable" and the pets keep the old
// behaviour (they follow the owner height without collision).
const AIR = 0, SOLID = 1, AVOID = 2, TALL = 3;

// blocks pets must not walk into / stand on (they are not solid, so they do not block movement by themselves)
const AVOID_NAMES = new Set([
  'water', 'lava', 'bubble_column', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass',
  'fire', 'soul_fire', 'sweet_berry_bush', 'cobweb', 'powder_snow'
]);
// solid blocks that are 1.5 blocks high: a pet can not jump on them
// thin / walk-through blocks that minecraft-data still lists with a full bounding box
const PASS_RE = /_carpet$|^snow$|_pressure_plate$|_button$|^lily_pad$/;
const TALL_RE = /(_fence|_wall|_fence_gate)$|^(fence|cobblestone_wall)/;

function toBuf(v) {
  if (Buffer.isBuffer(v)) return v;
  if (v instanceof Uint8Array) return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  if (Array.isArray(v)) return Buffer.from(v);
  return null;
}

// minY hint from the dimension data of login / respawn (only present in some versions)
function findMinY(o, depth) {
  if (!o || typeof o !== 'object' || depth > 6) return null;
  if (typeof o.min_y === 'number') return o.min_y;
  if (o.min_y && typeof o.min_y.value === 'number') return o.min_y.value;
  if (typeof o.minY === 'number') return o.minY;
  for (const k of Object.keys(o)) {
    const r = findMinY(o[k], depth + 1);
    if (r !== null) return r;
  }
  return null;
}

class World {
  constructor(mcData) {
    this.mc = mcData;
    this.pv = (mcData && mcData.version && mcData.version.version) || 0;
    this.supported = this.pv >= 757;
    this.table = null;
    this.hasLen = null; // chunk data array length prefix (removed in 1.21.5)
    this.fails = 0;
    this.okCount = 0;
    this.hint = null;
    this.reset();
  }

  reset() {
    this.chunks = new Map();
    this.lcx = null; this.lcz = null; this.lch = null;
  }

  usable() { return this.supported && (this.okCount > 0 || this.fails < 3); }

  // ---- block class table (state id -> AIR/SOLID/AVOID/TALL) ----
  buildTable() {
    const by = this.mc.blocksByStateId || {};
    let max = 0;
    for (const k of Object.keys(by)) { const n = +k; if (n > max) max = n; }
    const t = new Uint8Array(max + 1);
    for (const k of Object.keys(by)) {
      const b = by[k];
      if (!b) continue;
      let c = AIR;
      if (AVOID_NAMES.has(b.name)) c = AVOID;
      else if (PASS_RE.test(b.name)) c = AIR;
      else if (b.boundingBox === 'block') c = TALL_RE.test(b.name) ? TALL : SOLID;
      t[+k] = c;
    }
    this.table = t;
  }

  cls(state) {
    if (!this.table) this.buildTable();
    return state >= 0 && state < this.table.length ? this.table[state] : AIR;
  }

  // ---- packet intake ----
  record(name, d) {
    try {
      if (!this.supported || !d) return;
      switch (name) {
        case 'login': case 'respawn': this.hint = findMinY(d, 0); break;
        case 'map_chunk': {
          const buf = toBuf(d.chunkData);
          if (!buf) return;
          this.chunks.set(d.x + ',' + d.z, { buf, secs: null, bad: false, edits: [], minY: 0 });
          this.lch = null; this.lcx = null;
          break;
        }
        case 'unload_chunk': {
          const cx = d.chunkX !== undefined ? d.chunkX : d.x;
          const cz = d.chunkZ !== undefined ? d.chunkZ : d.z;
          this.chunks.delete(cx + ',' + cz);
          this.lch = null; this.lcx = null;
          break;
        }
        case 'block_change': {
          const l = d.location;
          if (l) this.setBlock(l.x, l.y, l.z, d.type);
          break;
        }
        case 'multi_block_change': {
          const c = d.chunkCoordinates, recs = d.records;
          if (!c || !recs) return;
          const ch = this.chunks.get(c.x + ',' + c.z);
          if (!ch) return;
          for (const r of recs) {
            let v = r;
            if (Array.isArray(v)) v = v[0] * 4294967296 + (v[1] >>> 0);
            v = Number(v);
            const state = Math.floor(v / 4096), pos = v % 4096;
            const lx = (pos >> 8) & 15, lz = (pos >> 4) & 15, ly = pos & 15;
            this.setBlock(c.x * 16 + lx, c.y * 16 + ly, c.z * 16 + lz, state);
          }
          break;
        }
        default: break;
      }
    } catch { /* never break the proxy */ }
  }

  setBlock(x, y, z, state) {
    const ch = this.chunks.get((x >> 4) + ',' + (z >> 4));
    if (!ch || ch.bad) return;
    if (!ch.secs) { ch.edits.push([x, y, z, state]); return; }
    this.applyEdit(ch, x, y, z, state);
  }

  applyEdit(ch, x, y, z, state) {
    const sy = (y - ch.minY) >> 4;
    if (sy < 0 || sy >= ch.secs.length) return;
    const idx = ((((y - ch.minY) & 15) << 8) | ((z & 15) << 4) | (x & 15));
    const c = this.cls(state);
    let sec = ch.secs[sy];
    if (typeof sec === 'number') {
      if (sec === c) return;
      const a = new Uint8Array(4096); a.fill(sec); ch.secs[sy] = sec = a;
    }
    sec[idx] = c;
  }

  // ---- lazy chunk decoding ----
  ensure(ch) {
    if (ch.secs) return true;
    if (ch.bad) return false;
    const order = this.hasLen === null ? (this.pv < 770 ? [true, false] : [false, true]) : [this.hasLen];
    for (const hl of order) {
      try { ch.secs = this.parse(ch.buf, hl); this.hasLen = hl; break; } catch { ch.secs = null; }
    }
    if (!ch.secs) { ch.bad = true; this.fails++; ch.buf = null; return false; }
    this.okCount++;
    const n = ch.secs.length;
    ch.minY = this.hint !== null && this.hint !== undefined ? this.hint : (n >= 24 ? -64 : 0);
    ch.buf = null;
    const ed = ch.edits; ch.edits = [];
    for (const e of ed) this.applyEdit(ch, e[0], e[1], e[2], e[3]);
    return true;
  }

  // chunkData -> one entry per 16-high section: a number (the whole section is one class) or a Uint8Array(4096)
  parse(buf, hasLen) {
    const table = this.table || (this.buildTable(), this.table);
    const secs = [];
    let o = 0;
    const rd = () => {
      let v = 0, s = 0, b;
      do {
        if (o >= buf.length || s > 28) throw new Error('varint');
        b = buf[o++];
        v |= (b & 127) << s; s += 7;
      } while (b & 128);
      return v;
    };
    // one paletted container; blocks=false just skips it (biomes)
    const container = (size, maxIndirect, blocks) => {
      if (o >= buf.length) throw new Error('eof');
      const bits = buf[o++];
      if (bits === 0) {
        const v = rd();
        if (hasLen) { const n = rd(); if (n !== 0) throw new Error('len0'); }
        return blocks ? (v < table.length ? table[v] : AIR) : 0;
      }
      if (bits > 24) throw new Error('bits');
      let pal = null;
      if (bits <= maxIndirect) {
        const n = rd();
        if (n < 1 || n > size) throw new Error('pal');
        pal = new Array(n);
        for (let i = 0; i < n; i++) pal[i] = rd();
      }
      const per = Math.floor(64 / bits);
      const want = Math.ceil(size / per);
      if (hasLen) { const n = rd(); if (n !== want) throw new Error('len'); }
      if (o + want * 8 > buf.length) throw new Error('eof');
      let out = 0;
      if (blocks) {
        const mask = (1 << bits) - 1;
        const arr = new Uint8Array(4096);
        let first = -1, same = true;
        for (let i = 0; i < 4096; i++) {
          const li = (i / per) | 0, sh = (i - li * per) * bits;
          const base = o + li * 8;
          const hi = buf.readUInt32BE(base), lo = buf.readUInt32BE(base + 4);
          let v;
          if (sh + bits <= 32) v = (lo >>> sh) & mask;
          else if (sh >= 32) v = (hi >>> (sh - 32)) & mask;
          else v = ((lo >>> sh) | (hi << (32 - sh))) & mask;
          const st = pal ? pal[v] : v;
          const c = st !== undefined && st < table.length ? table[st] : AIR;
          arr[i] = c;
          if (first < 0) first = c; else if (c !== first) same = false;
        }
        out = same ? first : arr;
      }
      o += want * 8;
      return out;
    };
    while (o < buf.length) {
      if (o + 2 > buf.length) throw new Error('eof');
      o += 2; // block count
      secs.push(container(4096, 8, true));
      container(64, 3, false); // biomes
      if (secs.length > 64) throw new Error('sections');
    }
    if (o !== buf.length || secs.length === 0) throw new Error('trailing');
    return secs;
  }

  // ---- queries (integer block coordinates) ----
  chunkAt(x, z) {
    const cx = x >> 4, cz = z >> 4;
    if (cx === this.lcx && cz === this.lcz && this.lch) return this.lch;
    const ch = this.chunks.get(cx + ',' + cz) || null;
    if (ch) { this.lcx = cx; this.lcz = cz; this.lch = ch; }
    return ch;
  }

  // is the chunk at this (float) position loaded and decoded?
  has(x, z) {
    const ch = this.chunkAt(Math.floor(x), Math.floor(z));
    return !!ch && (!!ch.secs || this.ensure(ch));
  }

  // -1 unknown chunk, otherwise AIR / SOLID / AVOID / TALL
  cell(x, y, z) {
    const ch = this.chunkAt(x, z);
    if (!ch) return -1;
    if (!ch.secs && !this.ensure(ch)) return -1;
    const rel = y - ch.minY;
    const sy = rel >> 4;
    if (sy < 0) return SOLID; // below the world: void counts as floor
    if (sy >= ch.secs.length) return AIR;
    const sec = ch.secs[sy];
    if (typeof sec === 'number') return sec;
    return sec[((rel & 15) << 8) | ((z & 15) << 4) | (x & 15)];
  }

  // something a pet can not walk through (unloaded chunks count as walls)
  blocked(x, y, z) {
    const c = this.cell(x, y, z);
    if (c === SOLID || c === TALL || c === -1) return true;
    return this.cell(x, y - 1, z) === TALL;
  }
}

module.exports = { World, AIR, SOLID, AVOID, TALL };
