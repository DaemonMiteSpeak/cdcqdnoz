'use strict';
// Builds the (randomised) resource pack that carries the converted cosmetic models.
// Every CosmeticPack instance invents its own namespace / file names / texture ids; nothing in the pack names the app.
//   weapons: one model per part + a composite item definition; the display transforms of every part already contain the hand pose
//   pets:    one model per (bone, orientation) part; the bones are animated at runtime by pets.js
const fs = require('fs'), path = require('path'), crypto = require('crypto'), zlib = require('zlib');
const { Rig } = require('./rig');
const { readZip, writeZip } = require('./zip');

const DATA = path.join(__dirname, 'data');
const BAD = /hider|wtf|cosmetic/i;

// Cosmetic assets (catalog + per-item rig/texture) are delivered by the relay to authenticated
// subscribers at runtime (setAssets, called via mcsession.setCosmeticAssets from backend.js); they
// are no longer shipped inside the app. The ./data + ./catalog.json on disk are a dev-only fallback.
let ASSETS = null;
function setAssets(bundle) {
  if (!bundle || !bundle.catalog || !bundle.items) return false;
  const items = {};
  for (const id of Object.keys(bundle.items)) {
    const v = bundle.items[id] || {};
    const png = Buffer.isBuffer(v.png) ? v.png : Buffer.from(String(v.png || ''), 'base64');
    // Source rig + precomputed vanilla parts arrive packed (deflate+base64) so the delivered bundle
    // carries no readable geometry/UV/converter; plain rig/bparts are only an on-disk dev fallback.
    let rig = v.rig, bparts = v.bparts || null;
    if (v.d) { try { const o = JSON.parse(zlib.inflateSync(Buffer.from(String(v.d), 'base64')).toString('utf8')); rig = o.rig; bparts = o.bparts; } catch { /* keep fallback */ } }
    items[id] = { rig, png, bparts };
  }
  ASSETS = { catalog: bundle.catalog, items };
  CONV.clear();
  return true;
}
function hasAssets() { return !!ASSETS; }
function loadCatalog() {
  if (ASSETS && ASSETS.catalog) return ASSETS.catalog;
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog.json'), 'utf8'));
}

// pack_format by game version (resource_major from the game's version.json)
const FORMATS = { '1.21.4': 46, '1.21.5': 55, '1.21.6': 63, '1.21.7': 64, '1.21.8': 64, '1.21.9': 69, '1.21.10': 69, '1.21.11': 75, '26.1': 84, '26.2': 88 };
function packMeta(version, pv, desc) {
  const f = FORMATS[version];
  const major = f || (pv >= 774 ? 75 : pv >= 773 ? 69 : pv >= 772 ? 64 : pv >= 771 ? 63 : pv >= 770 ? 55 : 46);
  const meta = { description: desc };
  if (pv >= 773) { meta.min_format = f ? f : major; meta.max_format = f ? f : 999; if (!f) meta.min_format = major; }
  else { meta.pack_format = major; meta.supported_formats = { min_inclusive: 46, max_inclusive: f ? f : 999 }; }
  return { pack: meta };
}

function rnd(n, alphabet) { const b = crypto.randomBytes(n); let s = ''; for (let i = 0; i < n; i++) s += alphabet[b[i] % alphabet.length]; return s; }
const AL = 'abcdefghijklmnopqrstuvwxyz', AN = 'abcdefghijklmnopqrstuvwxyz0123456789';
function word(min, max) {
  for (;;) {
    const n = min + (crypto.randomBytes(1)[0] % (max - min + 1));
    const s = rnd(1, AL) + rnd(n - 1, AN);
    if (!BAD.test(s)) return s;
  }
}
// PNG bytes differ in every build while the pixels stay bit-identical: IDAT is inflated and deflated again with a random
// level/strategy and cut into random-sized IDAT chunks. (A fixed texture file would be a fingerprint of the app.)
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function pngChunk(type, data) { const o = Buffer.alloc(12 + data.length); o.writeUInt32BE(data.length, 0); o.write(type, 4, 'latin1'); data.copy(o, 8); o.writeUInt32BE(crc32(o.subarray(4, 8 + data.length)), 8 + data.length); return o; }
function repackPng(png) {
  try {
    if (png.length < 33 || png.readUInt32BE(0) !== 0x89504E47) return png;
    const keep = []; const idat = []; let o = 8;
    while (o + 12 <= png.length) {
      const n = png.readUInt32BE(o), ty = png.toString('latin1', o + 4, o + 8), d = png.subarray(o + 8, o + 8 + n);
      if (ty === 'IDAT') idat.push(d); else if (/^(IHDR|PLTE|tRNS|IEND)$/.test(ty)) keep.push([ty, d]);   // text / time / gamma chunks are dropped
      o += 12 + n;
    }
    if (!idat.length) return png;
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const z = zlib.deflateSync(raw, { level: 5 + crypto.randomInt(5), memLevel: 7 + crypto.randomInt(3), strategy: crypto.randomInt(2) ? zlib.constants.Z_DEFAULT_STRATEGY : zlib.constants.Z_FILTERED });
    const out = [png.subarray(0, 8)];
    for (const [ty, d] of keep) { if (ty === 'IEND') break; out.push(pngChunk(ty, d)); }
    const tm = Buffer.alloc(7); tm.writeUInt16BE(2019 + crypto.randomInt(8), 0); tm[2] = 1 + crypto.randomInt(12); tm[3] = 1 + crypto.randomInt(28); tm[4] = crypto.randomInt(24); tm[5] = crypto.randomInt(60); tm[6] = crypto.randomInt(60);
    out.push(pngChunk('tIME', tm));                                       // random last-modified stamp: tiny images would otherwise repeat byte for byte
    for (let i = 0; i < z.length;) { const n = Math.max(1, Math.min(z.length - i, 1 + crypto.randomInt(Math.max(2, Math.min(7000, Math.ceil(z.length / 2)))))); out.push(pngChunk('IDAT', z.subarray(i, i + n))); i += n; }
    out.push(pngChunk('IEND', Buffer.alloc(0)));
    return Buffer.concat(out);
  } catch { return png; }
}
function randInt(n) { return crypto.randomInt(n); }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = randInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ---------- small 3x3 helpers ---------- */
const mmul = (a, b) => a.map(r => [0, 1, 2].map(j => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
const mvec = (m, v) => [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
const ID3 = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const RX = d => { const a = d * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [[1, 0, 0], [0, c, -s], [0, s, c]]; };
const RY = d => { const a = d * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; };
const RZ = d => { const a = d * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; };
const rotXYZ = (x, y, z) => mmul(RX(x), mmul(RY(y), RZ(z)));          // vanilla ItemTransform: Quaternionf.rotationXYZ
function eulerXYZ(m) {          // inverse of rotXYZ (degrees)
  const b = Math.asin(Math.max(-1, Math.min(1, m[0][2])));
  let a, c;
  if (Math.abs(m[0][2]) < 0.999999) { a = Math.atan2(-m[1][2], m[2][2]); c = Math.atan2(-m[0][1], m[0][0]); }
  else { a = Math.atan2(m[2][1], m[1][1]); c = 0; }
  return [a, b, c].map(v => +(v * 180 / Math.PI).toFixed(4));
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ---------- held weapon ---------- */
// Vanilla "handheld" display transforms (rotation, scale, translation in 1/16 block) for the contexts we care about. A weapon is a
// bunch of parts in the space of the mod (hand at the origin, blade along +Y). Each part is placed into the frame of a vanilla
// 16x16 sprite sword (grip in the lower left, blade along the diagonal) and gets the vanilla transform on top, so the weapon sits
// in the hand exactly like a vanilla sword does: first person, third person (F5), left hand, gui, ground, item frame, head.
const CTX = {
  thirdperson_righthand: { r: [0, -90, 55], s: 0.85, t: [0, 4, 0.5] },
  thirdperson_lefthand: { r: [0, 90, -55], s: 0.85, t: [0, 4, 0.5] },
  firstperson_righthand: { r: [0, -90, 25], s: 0.68, t: [1.13, 3.2, 1.13] },
  firstperson_lefthand: { r: [0, 90, -25], s: 0.68, t: [1.13, 3.2, 1.13] },
  gui: { r: [0, 0, 0], s: 1, t: [0, 0, 0] },
  ground: { r: [0, 0, 0], s: 0.5, t: [0, 2, 0] },
  fixed: { r: [0, 180, 0], s: 1, t: [0, 0, 0] },
  head: { r: [0, 180, 0], s: 1, t: [0, 13, 7] }
};
const GRIP = [-4.5, -4.5, 0];           // px from the sprite centre (8,8): where the hand holds a vanilla sword
const BLADE = RZ(-45);                  // +Y (blade) -> the sprite diagonal
const MOD_SCALE = 0.72;                 // the client mod draws held models at this scale

function weaponFrame(rig, W) {
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  rig.bones.forEach((b, j) => {
    for (const q of b.quads) for (let v = 0; v < 4; v++) {
      const p = mvec(W[j].A, [q[v * 3] / 16, q[v * 3 + 1] / 16, q[v * 3 + 2] / 16]);
      for (let i = 0; i < 3; i++) { const x = p[i] + W[j].b[i]; lo[i] = Math.min(lo[i], x); hi[i] = Math.max(hi[i], x); }
    }
  });
  const ext = [0, 1, 2].map(i => hi[i] - lo[i]);
  // flat blade whose broad side faces X: turn it so the broad side faces the camera plane (Z) like a sprite
  const Q0 = ext[0] * 1.3 < ext[2] ? RY(90) : ID3();
  const longest = Math.max(...ext) * 16;
  return { Q0, k: Math.min(MOD_SCALE, 26 / Math.max(longest, 1)) };
}
function weaponDisplay(W, j, p, fr) {
  const Ap = W[j].A;
  const place = mmul(BLADE, fr.Q0);
  const orth = mmul(place, mmul(Ap, p.rot));
  const c = mvec(Ap, p.t); const C = [c[0] + W[j].b[0], c[1] + W[j].b[1], c[2] + W[j].b[2]];
  const cs = mvec(place, C).map((v, i) => v * 16 * fr.k + GRIP[i]);
  const sc = fr.k * p.scale;
  const display = {};
  for (const [name, ctx] of Object.entries(CTX)) {
    const Rv = rotXYZ(ctx.r[0], ctx.r[1], ctx.r[2]);
    const rc = mvec(Rv, cs);
    display[name] = {
      rotation: eulerXYZ(mmul(Rv, orth)),
      translation: [0, 1, 2].map(i => +clamp(ctx.t[i] + ctx.s * rc[i], -80, 80).toFixed(4)),
      scale: [0, 1, 2].map(() => +clamp(ctx.s * sc, 0.0001, 4).toFixed(5))
    };
  }
  return display;
}

// conversions are deterministic: do them once per process
const CONV = new Map();
function converted(id) {
  let c = CONV.get(id); if (c) return c;
  let rigData, png, bparts = null;
  if (ASSETS && ASSETS.items[id]) { rigData = ASSETS.items[id].rig; png = ASSETS.items[id].png; bparts = ASSETS.items[id].bparts || null; }
  else { const dir = path.join(DATA, id); rigData = JSON.parse(fs.readFileSync(path.join(dir, 'rig.json'), 'utf8')); png = fs.readFileSync(path.join(dir, 'texture.png')); }
  const rig = new Rig(rigData);
  // The quad -> vanilla decomposition is done once, server-side at build time (tools/pack-cosmetics.js),
  // and delivered precomputed; the client never carries the converter. The on-disk dev fallback
  // (no server bundle) still converts locally through the build-only module.
  if (!bparts) { const { convertBone } = require('./rig'); bparts = rig.bones.map(b => convertBone(b, rig.texW, rig.texH)); }
  c = { rig, png, bparts }; CONV.set(id, c);
  return c;
}

class CosmeticPack {
  // opts: { ids?:[...] (defaults to the whole catalogue) }
  constructor(opts) {
    opts = opts || {};
    const cat = loadCatalog();
    this.ns = word(7, 11);
    this.modelDir = word(4, 8); this.texDir = word(4, 8);
    this.items = new Map();            // id -> { slot, rig, bparts:[[{ref,rot,scale,t}]], held?:{ref} }
    this.files = new Map();            // path -> Buffer
    const used = new Set();
    const uniq = () => { for (;;) { const w = word(6, 12); if (!used.has(w)) { used.add(w); return w; } } };
    for (const it of cat.items) {
      if (opts.ids && !opts.ids.includes(it.id)) continue;
      let cv; try { cv = converted(it.id); } catch { continue; }
      const { rig, png, bparts } = cv;
      const mob = it.mob || rig.mob || null;
      if (it.slot === 'pet' && mob) {
        this.items.set(it.id, { slot: it.slot, rig, bparts: [], tex: null, pet: it.pet || rig.pet || null, mob });
        continue;
      }
      const texName = uniq();
      this.files.set('assets/' + this.ns + '/textures/item/' + this.texDir + '/' + texName + '.png', repackPng(png));
      const tref = this.ns + ':item/' + this.texDir + '/' + texName;
      const put = (model, def) => {
        const name = uniq();
        model.textures = { tex: tref, particle: tref };
        this.files.set('assets/' + this.ns + '/models/' + this.modelDir + '/' + name + '.json', Buffer.from(JSON.stringify(model)));
        if (def) this.files.set('assets/' + this.ns + '/items/' + name + '.json', Buffer.from(JSON.stringify(def)));
        return name;
      };
      const single = name => ({ model: { type: 'minecraft:model', model: this.ns + ':' + this.modelDir + '/' + name } });
      const rec = { slot: it.slot, rig, bparts: [], tex: texName, pet: it.pet || rig.pet || null, mob: null };
      if (it.slot === 'pet' && rec.mob) {
        // Vanilla mobs are spawned as real client-side entities and require no custom item-model pack.
      } else if (it.slot === 'weapon') {
        const W = rig.world([]);
        const fr = weaponFrame(rig, W);
        const models = [];
        bparts.forEach((parts, j) => {
          for (const p of parts) {
            const m = JSON.parse(JSON.stringify(p.model)); m.display = weaponDisplay(W, j, p, fr);
            const name = put(m, null); models.push({ type: 'minecraft:model', model: this.ns + ':' + this.modelDir + '/' + name });
          }
        });
        if (models.length) {
          const defName = uniq();
          const def = models.length === 1 ? { model: models[0] } : { model: { type: 'minecraft:composite', models } };
          def.oversized_in_gui = true;
          this.files.set('assets/' + this.ns + '/items/' + defName + '.json', Buffer.from(JSON.stringify(def)));
          rec.held = { ref: this.ns + ':' + defName };
        }
      } else {
        rec.bparts = bparts.map(parts => parts.map(p => {
          const name = put(JSON.parse(JSON.stringify(p.model)), null);
          this.files.set('assets/' + this.ns + '/items/' + name + '.json', Buffer.from(JSON.stringify(single(name))));
          return { ref: this.ns + ':' + name, rot: p.rot, scale: p.scale, t: p.t };
        }));
      }
      this.items.set(it.id, rec);
    }
    this.uuid = crypto.randomUUID();
  }

  // sanity: none of the generated names / contents mention the app
  audit() {
    const bad = [];
    for (const [k, v] of this.files) { if (BAD.test(k)) bad.push(k); if (/\.json$|\.mcmeta$/.test(k) && BAD.test(v.toString('utf8'))) bad.push(k + ' (content)'); }
    return bad;
  }

  // zipped bytes; base = Map from a server pack (kept as is) or null for a stand-alone pack
  build(version, pv, base) {
    const files = new Map();
    if (base) for (const [k, v] of base) files.set(k, Buffer.isBuffer(v) ? { data: v } : v);
    for (const [k, v] of this.files) files.set(k, { data: v });
    if (!files.has('pack.mcmeta')) files.set('pack.mcmeta', { data: Buffer.from(JSON.stringify(packMeta(version, pv, word(5, 9)))) });
    const names = shuffle([...files.keys()]);
    const baseTime = Date.now() - randInt(86400000 * 400) - 86400000;
    const entries = names.map(n => {
      const f = files.get(n);
      // big entries of a server pack are copied as they are (no recompression), everything else gets random settings
      const pass = f.raw && f.data.length > 65536;
      return { name: n, data: f.data, raw: pass ? f.raw : undefined, store: !pass && randInt(5) === 0, level: 1 + randInt(9), time: new Date(baseTime + randInt(86400000 * 30)) };
    });
    return writeZip(entries);
  }
}

module.exports = { CosmeticPack, loadCatalog, setAssets, hasAssets, readZip, writeZip, packMeta, BAD, eulerXYZ, rotXYZ, weaponFrame, weaponDisplay, CTX, GRIP, BLADE };
