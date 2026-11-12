'use strict';
// Skeletal rigs of pets / weapons (see tools/import-cosmetics.js for the file format):
//   - Molang subset (q.anim_time, math.*) for the animation expressions
//   - keyframe sampler (linear / catmullrom / step), several animation layers summed per bone
//   - hierarchical bone transforms (pivot + rest rotation + animation) -> {A (3x3), b (blocks)} per bone
//   - per bone conversion of the quads to vanilla item-model parts (convert.js)
//   - decomposition of a 3x3 matrix into the display-entity transformation (left rotation, scale, right rotation)
const { boneMatrix, mulM, mulV } = require('./m3');

const D2R = Math.PI / 180;
const I3 = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/* ---------------- Molang ---------------- */
const FN = {
  'math.sin': x => Math.sin(x * D2R), 'math.cos': x => Math.cos(x * D2R), 'math.tan': x => Math.tan(x * D2R),
  'math.asin': x => Math.asin(x) / D2R, 'math.acos': x => Math.acos(x) / D2R, 'math.atan': x => Math.atan(x) / D2R, 'math.atan2': (y, x) => Math.atan2(y, x) / D2R,
  'math.abs': Math.abs, 'math.sqrt': Math.sqrt, 'math.pow': Math.pow, 'math.min': Math.min, 'math.max': Math.max,
  'math.clamp': (x, a, b) => Math.min(Math.max(x, a), b), 'math.lerp': (a, b, t) => a + (b - a) * t,
  'math.floor': Math.floor, 'math.ceil': Math.ceil, 'math.round': Math.round, 'math.trunc': Math.trunc, 'math.mod': (a, b) => a % b,
  'math.exp': Math.exp, 'math.ln': Math.log, 'math.random': () => 0.5, 'math.sign': Math.sign
};
const UNKNOWN = new Set();
const CACHE = new Map();

function tokenize(s) {
  const t = []; let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    let m;
    if ((m = /^(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)/.exec(s.slice(i)))) { t.push({ n: parseFloat(m[1]) }); i += m[1].length; continue; }
    if ((m = /^([A-Za-z_][\w.]*)/.exec(s.slice(i)))) { t.push({ id: m[1].toLowerCase() }); i += m[1].length; continue; }
    if ((m = /^(<=|>=|==|!=|&&|\|\||[-+*\/(),?:<>!;=])/.exec(s.slice(i)))) { t.push({ op: m[1] }); i += m[1].length; continue; }
    throw new Error('bad char ' + ch);
  }
  return t;
}
function parseMolang(src) {
  let s = String(src).trim().replace(/;+\s*$/, '');
  s = s.replace(/^return\s+/i, '');
  const toks = tokenize(s); let p = 0;
  const isOp = o => toks[p] && toks[p].op === o;
  const eat = o => { if (!isOp(o)) throw new Error('expected ' + o); p++; };
  function ternary() {
    const c = orE();
    if (isOp('?')) { p++; const a = ternary(); eat(':'); const b = ternary(); return x => (c(x) ? a(x) : b(x)); }
    return c;
  }
  function orE() { let l = andE(); while (isOp('||')) { p++; const r = andE(); const a = l; l = x => (a(x) || r(x) ? 1 : 0); } return l; }
  function andE() { let l = cmp(); while (isOp('&&')) { p++; const r = cmp(); const a = l; l = x => (a(x) && r(x) ? 1 : 0); } return l; }
  function cmp() {
    let l = add();
    for (;;) {
      const o = toks[p] && toks[p].op;
      if (!['<', '>', '<=', '>=', '==', '!='].includes(o)) return l;
      p++; const r = add(); const a = l;
      l = o === '<' ? x => (a(x) < r(x) ? 1 : 0) : o === '>' ? x => (a(x) > r(x) ? 1 : 0) : o === '<=' ? x => (a(x) <= r(x) ? 1 : 0) : o === '>=' ? x => (a(x) >= r(x) ? 1 : 0) : o === '==' ? x => (a(x) === r(x) ? 1 : 0) : x => (a(x) !== r(x) ? 1 : 0);
    }
  }
  function add() {
    let l = mul();
    while (isOp('+') || isOp('-')) { const o = toks[p++].op; const r = mul(); const a = l; l = o === '+' ? x => a(x) + r(x) : x => a(x) - r(x); }
    return l;
  }
  function mul() {
    let l = unary();
    while (isOp('*') || isOp('/')) { const o = toks[p++].op; const r = unary(); const a = l; l = o === '*' ? x => a(x) * r(x) : x => { const d = r(x); return d ? a(x) / d : 0; }; }
    return l;
  }
  function unary() {
    if (isOp('-')) { p++; const a = unary(); return x => -a(x); }
    if (isOp('+')) { p++; return unary(); }
    if (isOp('!')) { p++; const a = unary(); return x => (a(x) ? 0 : 1); }
    return primary();
  }
  function primary() {
    const t = toks[p++]; if (!t) throw new Error('unexpected end');
    if (t.n !== undefined) return () => t.n;
    if (t.op === '(') { const e = ternary(); eat(')'); return e; }
    if (t.id) {
      if (isOp('(')) {
        p++; const args = [];
        if (!isOp(')')) { for (;;) { args.push(ternary()); if (isOp(',')) { p++; continue; } break; } }
        eat(')');
        const f = FN[t.id]; if (!f) { UNKNOWN.add(t.id); return () => 0; }
        return x => { const v = f(...args.map(a => a(x))); return Number.isFinite(v) ? v : 0; };
      }
      if (t.id === 'q.anim_time' || t.id === 'query.anim_time' || t.id === 'query.life_time' || t.id === 'q.life_time') return x => x.t;
      if (t.id === 'math.pi') return () => Math.PI;
      if (t.id === 'true') return () => 1;
      if (t.id === 'false') return () => 0;
      UNKNOWN.add(t.id); return () => 0;
    }
    throw new Error('unexpected ' + JSON.stringify(t));
  }
  const f = ternary();
  if (p < toks.length) throw new Error('trailing tokens');
  return f;
}
function compile(v) {
  if (typeof v === 'number') return () => v;
  const key = String(v); let f = CACHE.get(key);
  if (!f) { try { f = parseMolang(key); } catch (e) { UNKNOWN.add('parse:' + key); f = () => 0; } CACHE.set(key, f); }
  return f;
}

/* ---------------- keyframes ---------------- */
function compileKfs(list) {
  return list.map(k => ({ t: k.t, f: k.v.map(compile), i: k.i || 'linear' }));
}
function evalAt(k, ctx) { return [k.f[0](ctx), k.f[1](ctx), k.f[2](ctx)]; }
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
function sample(kfs, tm, ctx) {
  const n = kfs.length;
  if (n === 1 || tm <= kfs[0].t) return evalAt(kfs[0], ctx);
  if (tm >= kfs[n - 1].t) return evalAt(kfs[n - 1], ctx);
  let i = 0; while (i < n - 2 && tm >= kfs[i + 1].t) i++;
  const a = kfs[i], b = kfs[i + 1];
  const va = evalAt(a, ctx), vb = evalAt(b, ctx);
  if (a.i === 'step') return va;
  const u = (tm - a.t) / ((b.t - a.t) || 1);
  if (a.i === 'catmullrom' || b.i === 'catmullrom') {
    const v0 = evalAt(kfs[Math.max(0, i - 1)], ctx), v3 = evalAt(kfs[Math.min(n - 1, i + 2)], ctx);
    return [0, 1, 2].map(k => catmull(v0[k], va[k], vb[k], v3[k], u));
  }
  return [va[0] + (vb[0] - va[0]) * u, va[1] + (vb[1] - va[1]) * u, va[2] + (vb[2] - va[2]) * u];
}

/* ---------------- matrices ---------------- */
const det3 = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
const transpose = m => [0, 1, 2].map(j => [m[0][j], m[1][j], m[2][j]]);
function quatOf(m) {
  const t = m[0][0] + m[1][1] + m[2][2]; let x, y, z, w;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; w = s / 4; x = (m[2][1] - m[1][2]) / s; y = (m[0][2] - m[2][0]) / s; z = (m[1][0] - m[0][1]) / s; }
  else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) { const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2; w = (m[2][1] - m[1][2]) / s; x = s / 4; y = (m[0][1] + m[1][0]) / s; z = (m[0][2] + m[2][0]) / s; }
  else if (m[1][1] > m[2][2]) { const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2; w = (m[0][2] - m[2][0]) / s; x = (m[0][1] + m[1][0]) / s; y = s / 4; z = (m[1][2] + m[2][1]) / s; }
  else { const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2; w = (m[1][0] - m[0][1]) / s; x = (m[0][2] + m[2][0]) / s; y = (m[1][2] + m[2][1]) / s; z = s / 4; }
  const n = Math.hypot(x, y, z, w) || 1;
  return { x: x / n, y: y / n, z: z / n, w: w / n };
}
const IDQ = { x: 0, y: 0, z: 0, w: 1 };
// Jacobi eigen decomposition of a symmetric 3x3 -> { vals, V (columns = eigenvectors) }
function eigSym(S) {
  const A = S.map(r => r.slice()); let V = I3();
  for (let it = 0; it < 40; it++) {
    let p = 0, q = 1, mx = Math.abs(A[0][1]);
    if (Math.abs(A[0][2]) > mx) { p = 0; q = 2; mx = Math.abs(A[0][2]); }
    if (Math.abs(A[1][2]) > mx) { p = 1; q = 2; mx = Math.abs(A[1][2]); }
    if (mx < 1e-14) break;
    const th = 0.5 * Math.atan2(2 * A[p][q], A[q][q] - A[p][p]); const c = Math.cos(th), s = Math.sin(th);
    const J = I3(); J[p][p] = c; J[q][q] = c; J[p][q] = s; J[q][p] = -s;
    const AJ = mulM(A, J); const JtAJ = mulM(transpose(J), AJ);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) A[i][j] = JtAJ[i][j];
    V = mulM(V, J);
  }
  return { vals: [A[0][0], A[1][1], A[2][2]], V };
}
// M = L * diag(sc) * Rt  ->  { left, sc, right } (quaternions + scale vector). The display entity applies right, then scale, then left.
function decompose(M) {
  const cols = [0, 1, 2].map(j => [M[0][j], M[1][j], M[2][j]]);
  const nr = cols.map(c => Math.hypot(c[0], c[1], c[2]));
  const d01 = Math.abs(cols[0][0] * cols[1][0] + cols[0][1] * cols[1][1] + cols[0][2] * cols[1][2]);
  const d02 = Math.abs(cols[0][0] * cols[2][0] + cols[0][1] * cols[2][1] + cols[0][2] * cols[2][2]);
  const d12 = Math.abs(cols[1][0] * cols[2][0] + cols[1][1] * cols[2][1] + cols[1][2] * cols[2][2]);
  if (nr.every(v => v > 1e-7) && d01 < 1e-4 * nr[0] * nr[1] && d02 < 1e-4 * nr[0] * nr[2] && d12 < 1e-4 * nr[1] * nr[2]) {
    const R = [0, 1, 2].map(i => [M[i][0] / nr[0], M[i][1] / nr[1], M[i][2] / nr[2]]);
    let sc = nr.slice();
    if (det3(R) < 0) { sc[0] = -sc[0]; for (let i = 0; i < 3; i++) R[i][0] = -R[i][0]; }
    return { left: quatOf(R), sc, right: IDQ };
  }
  const { vals, V } = eigSym(mulM(transpose(M), M));
  const order = [0, 1, 2].sort((a, b) => vals[b] - vals[a]);
  const sig = order.map(i => Math.sqrt(Math.max(0, vals[i])));
  const Vs = [0, 1, 2].map(r => order.map(i => V[r][i]));
  if (det3(Vs) < 0) for (let r = 0; r < 3; r++) Vs[r][2] = -Vs[r][2];
  const U = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const vcol = j => [Vs[0][j], Vs[1][j], Vs[2][j]];
  for (let j = 0; j < 3; j++) {
    if (sig[j] > 1e-7) { const u = mulV(M, vcol(j)); for (let i = 0; i < 3; i++) U[i][j] = u[i] / sig[j]; }
  }
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const ucol = j => [U[0][j], U[1][j], U[2][j]];
  if (sig[2] <= 1e-7) { const u = cr(ucol(0), ucol(1)); for (let i = 0; i < 3; i++) U[i][2] = u[i]; }
  if (det3(U) < 0) { sig[2] = -sig[2]; for (let i = 0; i < 3; i++) U[i][2] = -U[i][2]; }
  return { left: quatOf(U), sc: sig, right: quatOf(transpose(Vs)) };
}

/* ---------------- the rig ---------------- */
class Rig {
  constructor(json) {
    this.kind = json.kind; this.pet = json.pet || null; this.texW = json.texW; this.texH = json.texH;
    const src = json.bones; const idx = new Map(); src.forEach((b, i) => idx.set(b.name, i));
    // parents first
    const order = []; const seen = new Set();
    const visit = i => { if (seen.has(i)) return; seen.add(i); const b = src[i]; if (b.parent && idx.has(b.parent)) visit(idx.get(b.parent)); order.push(i); };
    src.forEach((_, i) => visit(i));
    const nidx = new Map(); order.forEach((oi, ni) => nidx.set(src[oi].name, ni));
    this.bones = order.map(oi => {
      const b = src[oi];
      return { name: b.name, parent: b.parent && nidx.has(b.parent) ? nidx.get(b.parent) : -1, pivot: b.pivot.map(v => v / 16), rot: b.rot.slice(), quads: b.quads };
    });
    this.byName = nidx;
    this.anims = {};
    for (const [name, a] of Object.entries(json.anims || {})) {
      const bones = [];
      for (const [bn, ch] of Object.entries(a.bones || {})) {
        const bi = nidx.get(bn); if (bi === undefined) continue;
        const o = { bi };
        if (ch.rotation) o.rotation = compileKfs(ch.rotation);
        if (ch.position) o.position = compileKfs(ch.position);
        if (ch.scale) o.scale = compileKfs(ch.scale);
        bones.push(o);
      }
      this.anims[name] = { loop: !!a.loop, length: a.length || 0, bones };
    }
    // bones that can move in any animation (or below such a bone)
    this.dyn = this.bones.map(() => false);
    const own = this.bones.map(() => false);
    for (const a of Object.values(this.anims)) for (const o of a.bones) own[o.bi] = true;
    this.bones.forEach((b, i) => { this.dyn[i] = own[i] || (b.parent >= 0 && this.dyn[b.parent]); });
  }
  has(name) { return !!this.anims[name]; }
  // layers: [{ name, time (s) }] -> per bone { A (3x3, linear part), b (translation in blocks) }
  world(layers) {
    const n = this.bones.length;
    const rot = this.bones.map(b => b.rot.slice()), pos = this.bones.map(() => [0, 0, 0]), scl = this.bones.map(() => [1, 1, 1]);
    // Layers are applied in priority order: a later state clip replaces overlapping base channels,
    // while channels not present in that clip retain the base pose.
    for (const L of layers || []) {
      const a = this.anims[L.name]; if (!a) continue;
      let tm = L.time;
      if (a.length > 0) tm = a.loop ? ((tm % a.length) + a.length) % a.length : Math.min(Math.max(tm, 0), a.length); else tm = 0;
      const ctx = { t: tm };
      for (const o of a.bones) {
        if (o.rotation) { const v = sample(o.rotation, tm, ctx); rot[o.bi] = this.bones[o.bi].rot.map((base, k) => base + v[k]); }
        if (o.position) { const v = sample(o.position, tm, ctx); pos[o.bi] = v.map(x => x / 16); }
        if (o.scale) { const v = sample(o.scale, tm, ctx); scl[o.bi] = v; }
      }
    }
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const b = this.bones[i];
      const r = rot[i]; const Rm = (r[0] || r[1] || r[2]) ? boneMatrix(r) : I3();
      const s = scl[i];
      const A = Rm.map(row => [row[0] * s[0], row[1] * s[1], row[2] * s[2]]);
      const pv = b.pivot; const Ap = mulV(A, pv);
      const bl = [pv[0] + pos[i][0] - Ap[0], pv[1] + pos[i][1] - Ap[1], pv[2] + pos[i][2] - Ap[2]];
      if (b.parent < 0) out[i] = { A, b: bl };
      else {
        const P = out[b.parent]; const pb = mulV(P.A, bl);
        out[i] = { A: mulM(P.A, A), b: [pb[0] + P.b[0], pb[1] + P.b[1], pb[2] + P.b[2]] };
      }
    }
    return out;
  }
}

// vanilla item-model parts of one bone (quads in design space, bone at rest); bad quads are dropped
function convertBone(bone, texW, texH, warn) {
  if (!bone.quads.length) return [];
  // The decomposition maths (convert.js) ship only with the build tools, never inside the client
  // engine bundle; in the app the parts are precomputed server-side, so this path is dev/build only.
  const { convertModel } = require('./convert');
  const mk = qs => ({ format: 'bbmodel', bones: [{ name: bone.name, pivot: [0, 0, 0], rotation: [0, 0, 0], quads: qs }] });
  try { return convertModel(mk(bone.quads), texW, texH).parts; } catch { /* find the culprits */ }
  const good = []; let bad = 0;
  for (const q of bone.quads) { try { convertModel(mk([q]), texW, texH); good.push(q); } catch { bad++; } }
  if (warn) warn(bone.name + ': ' + bad + ' of ' + bone.quads.length + ' quads dropped');
  if (!good.length) return [];
  try { return convertModel(mk(good), texW, texH).parts; } catch (e) { if (warn) warn(bone.name + ': ' + e.message); return []; }
}

module.exports = { Rig, convertBone, decompose, quatOf, compile, UNKNOWN, det3, transpose };
