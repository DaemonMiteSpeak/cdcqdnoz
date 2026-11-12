'use strict';

// Runtime matrix helpers for the cosmetics engine.
//
// These are the ONLY pieces of the old convert.js that the shipped client still needs at runtime
// (rig.js bone/world matrices, pets.js part transforms). They are copied verbatim so the on-screen
// result is bit-for-bit identical. The actual bbmodel -> vanilla item-model decomposition stays in
// the build-only convert.js and never reaches the client: cosmetic parts are precomputed
// server-side (tools/pack-cosmetics.js) and delivered ready to use, so the client has no converter.

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mulM = (a, b) => a.map((r, i) => [0, 1, 2].map(j => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
const mulV = (m, v) => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];
const tr = m => [0, 1, 2].map(j => [m[0][j], m[1][j], m[2][j]]);

function rotAxis(axis, deg) {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  if (axis === 0) return [[1, 0, 0], [0, c, -s], [0, s, c]];
  if (axis === 1) return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}

function boneMatrix(rot) {
  const r = rot || [0, 0, 0];
  return mulM(rotAxis(2, r[2]), mulM(rotAxis(1, r[1]), rotAxis(0, r[0])));
}

module.exports = { boneMatrix, mulM, mulV, tr };
