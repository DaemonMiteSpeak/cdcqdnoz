'use strict';
// Baked bbmodel (bones -> quads) -> exact decomposition into vanilla item-model parts.
//
// Every source quad is a (rotated) rectangle that carries the vanilla vertex order of one cuboid face. All quads of
// a bone that share the same orientation frame become ONE vanilla item model (flat, axis-aligned elements in that
// frame); the frame, the bone rotation about its pivot and a power-of-two scale are folded into the
// transformation of one item_display. Nothing is approximated: every quad becomes exactly one flat element face
// and its UV mapping (rect + rotation) is solved and verified vertex by vertex. A model is rejected as unsuitable
// when any quad is not a rectangle, cannot be expressed with a vanilla UV mapping or the part count is unreasonable.
const EPS = 2e-3;
const MAX_PARTS = 400;
const DIRS = ['down', 'up', 'north', 'south', 'west', 'east'];
// vanilla face vertex order (FaceBakery) in terms of the element's from(1)/to(2) corners
const FACE_VERTS = {
  down: [[1, 0, 2], [1, 0, 1], [2, 0, 1], [2, 0, 2]],
  up: [[1, 3, 1], [1, 3, 2], [2, 3, 2], [2, 3, 1]],
  north: [[2, 3, 1], [2, 0, 1], [1, 0, 1], [1, 3, 1]],
  south: [[1, 3, 2], [1, 0, 2], [2, 0, 2], [2, 3, 2]],
  west: [[1, 3, 1], [1, 0, 1], [1, 0, 2], [1, 3, 2]],
  east: [[2, 3, 2], [2, 0, 2], [2, 0, 1], [2, 3, 1]]
};
const DIR_NORMAL = { down: [0, -1, 0], up: [0, 1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0] };

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]);
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => scl(a, 1 / (len(a) || 1));
const r3 = a => a.map(x => Math.round(x * 1000) / 1000 + 0);

// ---- 3x3 matrices, row-major [r0,r1,r2] ----
const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const mulM = (a, b) => a.map((r, i) => [0, 1, 2].map(j => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
const mulV = (m, v) => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];
const tr = m => [0, 1, 2].map(j => [m[0][j], m[1][j], m[2][j]]);
function rotAxis(axis, deg) {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  if (axis === 0) return [[1, 0, 0], [0, c, -s], [0, s, c]];
  if (axis === 1) return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}
// bone rotation [x,y,z] degrees: Blockbench / three.js Euler order 'ZYX' (applied X, then Y, then Z), right-handed
function boneMatrix(rot) {
  const r = rot || [0, 0, 0];
  return mulM(rotAxis(2, r[2]), mulM(rotAxis(1, r[1]), rotAxis(0, r[0])));
}
const isIdent = m => m.every((r, i) => r.every((x, j) => Math.abs(x - (i === j ? 1 : 0)) < 1e-9));

function quadOf(f) {
  return { v: [f.slice(0, 3), f.slice(3, 6), f.slice(6, 9), f.slice(9, 12)], uv: [f.slice(12, 14), f.slice(14, 16), f.slice(16, 18), f.slice(18, 20)], n: f.slice(20, 23) };
}

// canonical frame (orthonormal, right-handed) of a rectangle quad; null if it is not a rectangle
function frameOf(q) {
  const ea = sub(q.v[1], q.v[0]), eb = sub(q.v[3], q.v[0]);
  const la = len(ea), lb = len(eb);
  if (la < 1e-6 || lb < 1e-6) return { error: 'degenerate quad' };
  if (len(sub(sub(q.v[0], q.v[1]), sub(q.v[3], q.v[2]))) > EPS * 5) return { error: 'quad is not a parallelogram' };
  const A = unit(ea), B = unit(eb);
  if (Math.abs(dot(A, B)) > 5e-3) return { error: 'quad is not a rectangle (sheared)' };
  const N = unit(cross(A, B));
  // canonical axis lines: sign so that the first significant component is positive, sorted
  const canon = v => { let s = 1; for (const x of v) { if (Math.abs(x) > 1e-3) { s = x < 0 ? -1 : 1; break; } } return scl(v, s); };
  let axes = [canon(A), canon(B), canon(N)].sort((p, q2) => { for (let i = 0; i < 3; i++) { const d = Math.round(p[i] * 500) - Math.round(q2[i] * 500); if (d) return d; } return 0; });
  if (dot(cross(axes[0], axes[1]), axes[2]) < 0) axes[2] = scl(axes[2], -1);
  return { axes, key: axes.map(a => r3(a).join(',')).join('|') };
}

// uv for a vertex of a face given mapping {u1,v1,u2,v2,rot} -> returns [u,v] (0..1 texture space)
function faceVertexUV(m, i) {
  // vanilla BlockFaceUV: vertex i takes corner index (i + rot/90) % 4 of [(u1,v1),(u1,v2),(u2,v2),(u2,v1)]
  const k = (i + (m.rot / 90)) % 4;
  return [[m.u1, m.v1], [m.u1, m.v2], [m.u2, m.v2], [m.u2, m.v1]][k];
}

// solve face uv {u1,v1,u2,v2,rot} (0..1 units) for a quad; returns null when impossible
function solveUV(q, fv) {
  // fv: the quad's 4 vertices in frame coordinates in vanilla order for the chosen direction
  const us = q.uv.map(p => p[0]), vs = q.uv.map(p => p[1]);
  const umin = Math.min(...us), umax = Math.max(...us), vmin = Math.min(...vs), vmax = Math.max(...vs);
  if (umax - umin < 1e-9 && vmax - vmin < 1e-9) return { u1: umin, v1: vmin, u2: umax, v2: vmax, rot: 0 };
  let best = null;
  for (const swapU of [0, 1]) for (const swapV of [0, 1]) for (const rot of [0, 90, 180, 270]) {
    const m = { u1: swapU ? umax : umin, u2: swapU ? umin : umax, v1: swapV ? vmax : vmin, v2: swapV ? vmin : vmax, rot };
    let err = 0;
    for (let i = 0; i < 4; i++) { const e = faceVertexUV(m, i); err = Math.max(err, Math.abs(e[0] - q.uv[i][0]), Math.abs(e[1] - q.uv[i][1])); }
    if (!best || err < best.err) best = { m, err };
  }
  return best && best.err < 1e-4 ? best.m : null;
}

// Plan: group quads of every bone by frame; returns parts without any model json (cheap, used by build-pack).
function analyse(model) {
  if (!model || model.format !== 'bbmodel' || !Array.isArray(model.bones)) return { ok: false, reason: 'not a baked bbmodel' };
  const groups = new Map(); let quads = 0;
  for (const b of model.bones) {
    const R = boneMatrix(b.rotation); const rid = isIdent(R);
    const pivot = b.pivot || [0, 0, 0];
    for (const f of b.quads || []) {
      if (!Array.isArray(f) || f.length < 23) return { ok: false, reason: 'unexpected quad layout (length ' + (f && f.length) + ')' };
      const q = quadOf(f); const fr = frameOf(q);
      if (fr.error) return { ok: false, reason: b.name + ': ' + fr.error };
      const bk = rid ? 'I' : 'R' + r3(b.rotation).join(',') + '@' + r3(pivot).join(',');
      let g = null;
      for (const c of groups.values()) if (c.bk === bk && sameFrame(c.axes, fr.axes)) { g = c; break; }
      if (!g) { const gk = bk + '#' + groups.size; g = { key: gk, bk, R, rid, pivot, axes: fr.axes, items: [] }; groups.set(gk, g); }
      g.items.push({ q, bone: b.name });
      quads++;
    }
  }
  if (!groups.size) return { ok: false, reason: 'no quads' };
  if (groups.size > MAX_PARTS) return { ok: false, reason: 'too many display parts (' + groups.size + ')' };
  return { ok: true, quads, parts: groups.size, groups: [...groups.values()] };
}

function sameFrame(a, b) {
  const used = new Set();
  for (const x of a) {
    let ok = false;
    for (let j = 0; j < 3; j++) if (!used.has(j) && Math.abs(dot(x, b[j])) > 0.999994) { used.add(j); ok = true; break; }
    if (!ok) return false;
  }
  return true;
}

function planModel(model) { const a = analyse(model); return a.ok ? { ok: true, quads: a.quads, parts: a.parts } : a; }

// Full conversion: returns { parts:[{ model: vanillaModelJson(texture placeholder "#tex"), matrix:{linear(3x3), t:[x,y,z]} }], texSize }
//   matrix maps the model-local unit space (block units, origin at the model centre) to the cosmetic space (blocks,
//   y = 0 at the model origin of the source file; 16 px = 1 block). The consumer puts the slot placement on top.
function convertModel(model, texW, texH) {
  const a = analyse(model);
  if (!a.ok) throw new Error(a.reason);
  const parts = [];
  for (const g of a.groups) {
    const F = [0, 1, 2].map(i => [g.axes[0][i], g.axes[1][i], g.axes[2][i]]);   // columns = axes
    const Ft = tr(F);
    // frame coordinates of every vertex (relative to the group's bbox centre in frame space)
    const cs = g.items.map(it => ({ it, c: it.q.v.map(v => mulV(Ft, v)) }));
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const x of cs) for (const c of x.c) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], c[k]); hi[k] = Math.max(hi[k], c[k]); }
    const mid = [0, 1, 2].map(k => (lo[k] + hi[k]) / 2);
    const ext = Math.max(...[0, 1, 2].map(k => Math.max(hi[k] - mid[k], mid[k] - lo[k])));
    let s = 1; while (ext * s > 22) s /= 2;                          // power of two: exact in binary floating point
    const elements = [];
    for (const x of cs) {
      const c = x.c.map(p => [0, 1, 2].map(k => (p[k] - mid[k]) * s + 8));
      const mn = [0, 1, 2].map(k => Math.min(...c.map(p => p[k]))), mx = [0, 1, 2].map(k => Math.max(...c.map(p => p[k])));
      const nf = mulV(Ft, x.it.q.n);                                    // source normal in frame coordinates
      // A face can be very narrow in-plane (e.g. 0.02 px) and then have two dimensions below 0.1.
      // Its normal, not the smallest bounding-box dimension, identifies the one flat axis.
      const k = [0, 1, 2].reduce((best, i) => Math.abs(nf[i]) > Math.abs(nf[best]) ? i : best, 0);
      if (mx[k] - mn[k] >= 0.1) throw new Error('quad is not flat in its frame');
      const sgn = nf[k] >= 0 ? 1 : -1;
      const dir = k === 0 ? (sgn > 0 ? 'east' : 'west') : k === 1 ? (sgn > 0 ? 'up' : 'down') : (sgn > 0 ? 'south' : 'north');
      // vertices of the vanilla face in the same order -> must coincide with the quad vertices (any cyclic/mirrored order)
      const corners = [mn, mx];
      const fvPos = FACE_VERTS[dir].map(t => [0, 1, 2].map(ax => t[ax] === 3 ? mx[ax] : (t[ax] === 0 ? mn[ax] : corners[t[ax] - 1][ax])));
      // match every vanilla vertex with the quad vertex at the same position -> uv of that vertex
      const uvAt = fvPos.map(p => { const i = c.findIndex(q2 => len(sub(q2, p)) < 0.1); return i < 0 ? null : x.it.q.uv[i]; });
      if (uvAt.some(u => !u)) throw new Error('face vertices do not match the vanilla corner layout (' + dir + ')');
      const fake = { uv: uvAt };
      const m = solveUV(fake, null);
      if (!m) throw new Error('uv mapping cannot be expressed as a vanilla face (' + dir + ')');
      const el = { from: mn.map(v => +v.toFixed(5)), to: mx.map(v => +v.toFixed(5)), faces: {} };
      el.faces[dir] = { uv: [m.u1 * 16, m.v1 * 16, m.u2 * 16, m.v2 * 16].map(v => +v.toFixed(5)), texture: '#tex', rotation: m.rot || undefined };
      if (!el.faces[dir].rotation) delete el.faces[dir].rotation;
      el.shade = true;
      elements.push(el);
    }
    // entity-space transform: L = Rbone * F / s ; t = (Rbone (o - pivot) + pivot) / 16, with o = F * mid
    const o = mulV(F, mid);
    const L = mulM(g.R, F).map(r => r.map(v => v / s));
    const tv = add(mulV(g.R, sub(o, g.pivot)), g.pivot).map(v => v / 16);
    parts.push({ key: g.key, scale: 1 / s, rot: mulM(g.R, F), linear: L, t: tv, model: { textures: { tex: '#tex', particle: '#tex' }, elements }, quads: g.items.length });
  }
  return { parts, texW, texH };
}

module.exports = { planModel, analyse, convertModel, boneMatrix, mulM, mulV, tr, DIR_NORMAL, FACE_VERTS, faceVertexUV };
