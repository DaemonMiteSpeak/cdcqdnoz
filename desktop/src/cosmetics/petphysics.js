'use strict';
// Pet movement through the world: collision with blocks, gravity, jumping onto blocks and obstacle avoidance.
// All functions take the World (src/world.js) as W and the pet state object of cosmetics/pets.js.
const DEG = Math.PI / 180;
const GRAV = 0.08, DRAG = 0.98;
const JUMP_V = 0.42;   // vanilla jump: apex ~1.25 blocks, enough for one block
const STEP = 1.02;     // an obstacle is jumpable when the body fits 1.02 blocks higher
const FALL_MAX = 4;    // pets walk down ledges up to 4 blocks, never farther

// hitbox [radius, height] in blocks per pet id
const DIMS = {
  sniffer: [0.4, 0.9], sniffer_baby: [0.26, 0.55],
  hoglin: [0.34, 0.7], hoglin_baby: [0.24, 0.45],
  bat: [0.22, 0.45], chick: [0.18, 0.45], cat: [0.25, 0.6], dog: [0.25, 0.65]
};

function dims(id, meta) {
  const hb = meta && Array.isArray(meta.hitbox) ? meta.hitbox : DIMS[id];
  return hb ? { r: hb[0], h: hb[1] } : { r: 0.25, h: 0.6 };
}

// the world, when it can be used (1.18+ and chunks decoded fine)
function worldOf(s) {
  const w = s && s.snap && s.snap.world;
  return w && w.usable() ? w : null;
}

// does the box (centre x/z, feet y, radius r, height h) touch a block?
function hit(W, x, y, z, r, h) {
  const x0 = Math.floor(x - r), x1 = Math.floor(x + r - 1e-6);
  const z0 = Math.floor(z - r), z1 = Math.floor(z + r - 1e-6);
  const y0 = Math.floor(y + 1e-6), y1 = Math.floor(y + h - 1e-6);
  for (let ix = x0; ix <= x1; ix++) {
    for (let iz = z0; iz <= z1; iz++) {
      for (let iy = y0; iy <= y1; iy++) if (W.blocked(ix, iy, iz)) return true;
    }
  }
  return false;
}

// y of the first walkable surface below "from" (null: water / fire / unloaded / nothing within "down" blocks)
function floorAt(W, x, z, from, down) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const top = Math.floor(from);
  for (let iy = top; iy >= top - down; iy--) {
    const c = W.cell(ix, iy, iz);
    if (c < 0 || c === 2) return null;
    if (W.blocked(ix, iy, iz)) return iy + 1;
  }
  return null;
}

// a spot where the pet fits and has ground below
function standY(W, pet, x, z, from) {
  const y = floorAt(W, x, z, from, 8);
  if (y === null || hit(W, x, y, z, pet.r, pet.h)) return null;
  return y;
}

// 0 = free, 1 = free but needs a jump (one block step), 2 = blocked (wall, cliff, water, fire)
function feel(W, pet, a, dist) {
  const cx = Math.cos(a), cz = Math.sin(a);
  let y = pet.y, step = 0;
  for (let s = 0.3; ; s += 0.3) {
    const d = Math.min(s, dist);
    const px = pet.x + cx * d, pz = pet.z + cz * d;
    if (hit(W, px, y, pz, pet.r, pet.h)) {
      if (pet.fly) {
        let ok = false;
        for (const up of [1, 2, 3]) if (!hit(W, px, y + up, pz, pet.r, pet.h)) { y += up; ok = true; break; }
        if (!ok) return 2;
        step = 1;
      } else {
        if (hit(W, px, y + STEP, pz, pet.r, pet.h)) return 2; // higher than one block
        y += 1; step = 1;
      }
    }
    if (d >= dist) break;
  }
  if (pet.fly) return step;
  // standing in water the ground rules do not apply (the pet just swims out)
  if (W.cell(Math.floor(pet.x), Math.floor(pet.y + 0.1), Math.floor(pet.z)) === 2) return step;
  const f = floorAt(W, pet.x + cx * dist, pet.z + cz * dist, y + 0.5, FALL_MAX + 1);
  if (f === null || y - f > FALL_MAX) return 2;
  return step;
}

const OFFS = [0, 30, -30, 60, -60, 95, -95, 135, -135, 180];

// picks a walking direction near "ang" that is not blocked: sidesteps walls, prefers jumping on a one block step
// over a long detour, never walks off high cliffs or into water
function steer(W, pet, ang, md) {
  const look = Math.min(md, 1.5) + pet.r + 0.15;
  let bestA = ang, best = 1e9, bestOff = 0;
  for (const od of OFFS) {
    const a = ang + od * DEG;
    const sc = feel(W, pet, a, look);
    // a side that was picked is kept (strong penalty for the other one) until the way ahead has been free for a while,
    // otherwise the pet swings left and right in front of a wall
    const cost = Math.abs(od) / 180 + (sc === 1 ? 0.25 : sc === 2 ? 10 : 0) +
      (pet.side && od && od !== 180 && Math.sign(od) !== pet.side ? 1.5 : 0);
    if (cost < best) { best = cost; bestA = a; bestOff = od; }
  }
  if (best >= 10) return ang; // boxed in: keep pushing, the stuck logic of the pet takes over
  if (bestOff) { if (bestOff !== 180) pet.side = Math.sign(bestOff); pet.free = 0; pet.detour = (pet.detour || 0) + 1; }
  else if (++pet.free > 15) { pet.side = 0; pet.detour = 0; }
  return bestA;
}

// one tick of movement (pet.vx / pet.vz are the wanted horizontal speed). false: the pet is stuck inside blocks.
function walk(W, pet, now, o) {
  const r = pet.r, h = pet.h;
  if (hit(W, pet.x, pet.y, pet.z, r, h)) { // a block appeared on the pet / it was placed inside a wall
    let fixed = false;
    for (let k = 1; k <= 4 && !fixed; k++) {
      const ny = Math.floor(pet.y) + k;
      if (!hit(W, pet.x, ny, pet.z, r, h)) { pet.y = ny; pet.vy = 0; fixed = true; }
    }
    if (!fixed) return false;
  }
  // water / fire: float up
  if (!pet.fly && W.cell(Math.floor(pet.x), Math.floor(pet.y + h * 0.4), Math.floor(pet.z)) === 2) {
    pet.vy = Math.min(0.12, pet.vy + 0.1);
  }
  // horizontal, axis by axis so the pet slides along walls
  const nx = pet.x + pet.vx, nz = pet.z + pet.vz;
  let bx = false, bz = false;
  // on the ground: never step off a high ledge, into water / fire or into an unloaded chunk
  const guard = !pet.fly && pet.onGround;
  const safe = (x, z) => { const f = floorAt(W, x, z, pet.y + 0.5, FALL_MAX + 1); return f !== null && pet.y - f <= FALL_MAX; };
  if (nx !== pet.x) { if (hit(W, nx, pet.y, pet.z, r, h)) bx = true; else if (!guard || safe(nx, pet.z)) pet.x = nx; }
  if (nz !== pet.z) { if (hit(W, pet.x, pet.y, nz, r, h)) bz = true; else if (!guard || safe(pet.x, nz)) pet.z = nz; }
  if (pet.jumpCool > 0) pet.jumpCool--;
  if (bx || bz) {
    if (pet.fly) {
      // a flying pet climbs over what is in the way
      pet.lift = Math.min(4, (now < pet.liftUntil ? pet.lift : 0) + 1.2);
      pet.liftUntil = now + 1200;
    } else if (pet.onGround && pet.jumpCool <= 0) {
      // jump onto the block in front (only one block high, with room above it)
      const jx = bx ? nx : pet.x, jz = bz ? nz : pet.z;
      if (!hit(W, jx, pet.y + STEP, jz, r, h)) { pet.vy = JUMP_V; pet.jumpCool = 8; pet.onGround = false; }
    }
  }
  // vertical
  if (pet.fly) {
    let ty = o.y + pet.hover + Math.sin(now / 700 + pet.eid) * 0.18 + (now < pet.liftUntil ? pet.lift : 0);
    const g = floorAt(W, pet.x, pet.z, pet.y + 1, 12);
    if (g !== null) ty = Math.max(ty, g + 0.7);
    const dy = Math.max(-0.1, Math.min(0.1, ty - pet.y));
    if (!hit(W, pet.x, pet.y + dy, pet.z, r, h)) pet.y += dy;
    pet.vy = 0; pet.onGround = false;
  } else {
    let ny = pet.y + pet.vy;
    if (pet.vy <= 0) {
      if (hit(W, pet.x, ny, pet.z, r, h)) { ny = Math.floor(ny + 1e-6) + 1; pet.vy = 0; }
    } else if (hit(W, pet.x, ny, pet.z, r, h)) {
      ny = Math.floor(ny + h - 1e-6) - h - 1e-3; pet.vy = 0; // bumped the head
    }
    pet.y = ny;
    pet.onGround = pet.vy <= 0 && hit(W, pet.x, pet.y - 0.05, pet.z, r, 0.05);
    pet.vy = Math.max(-0.9, (pet.vy - GRAV) * DRAG);
  }
  return true;
}

// a free spot next to the owner (null when the world is not loaded there)
function findSpot(W, pet, o, a, r) {
  const tries = [[0, r], [40, r], [-40, r], [90, r], [-90, r], [180, r], [0, 1.2], [90, 1.2], [-90, 1.2], [180, 1.2]];
  for (const [da, rr] of tries) {
    const ang = a + da * DEG;
    const x = o.x + Math.sin(ang) * rr, z = o.z - Math.cos(ang) * rr;
    const y = standY(W, pet, x, z, o.y + 1.5);
    if (y !== null && Math.abs(y - o.y) <= 1.6) return { x, z, y };
  }
  const y = standY(W, pet, o.x, o.z, o.y + 1.5);
  return y !== null ? { x: o.x, z: o.z, y } : null;
}

module.exports = { dims, worldOf, hit, floorAt, standY, feel, steer, walk, findSpot, GRAV, JUMP_V };
