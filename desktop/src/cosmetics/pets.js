'use strict';
// Pets: animated models that follow their owner around.
// A pet is a skeleton (bones with parents, rest rotations, keyframe animations) imported from the mod. Every bone is cut into
// one or more vanilla item-model parts (pack.js); each part is an item_display entity. All parts of a pet ride one invisible
// root entity: the proxy moves the root at 20 Hz with a tiny follow "AI" and re-poses the animated bones ~10 times a second
// (entity metadata with interpolation), so a walk / idle animation plays on the client without any client-side mod.
//   - the pet keeps ~2 blocks (adult hoglin 3, adult sniffer 4) from the owner, strolls around on its own, looks at the owner while idle,
//     and walks over calmly only when the owner has moved far away
//   - fly = true pets hover (and bob); the walk / idle / run / fly animation of the model is chosen by the state of the pet
//   - teleports next to the owner when it is too far away
// Everybody attached to the session (controller and observer) sees the pets, pets of other Hider users are shown as well.
// Block collision: the proxy keeps a light map of the blocks the server sent (world.js), so pets do not walk through blocks,
// walk around obstacles (petphysics.js), hop onto one-block steps, fall down ledges with gravity and avoid water / cliffs.
// Where the map is not available (server older than 1.18, chunk not loaded) a pet falls back to the old free movement.
const { Riders } = require('../riders');
const { decompose, transpose } = require('./rig');
const { mulM } = require('./m3');
const P = require('./petphysics');

const TICK_MS = 50;
const ANIM_MS = 100;         // pose update period of animated bones
const INTERP = 3;            // ticks the client interpolates between two poses
const WARP = 16;             // blocks: farther away than this it is teleported next to the owner
const STAND = { sniffer: 4, hoglin: 3 };   // blocks a pet keeps from its owner (adult sniffer 4, adult hoglin 3, everything else 2)
const STAND_DEFAULT = 2;
const HIDE_POSES = new Set(['fall_flying', 'sleeping', 'swimming', 'spin_attack', 'dying']);

const wrap = (d) => ((d + 180) % 360 + 360) % 360 - 180;
const turn = (cur, target, max) => cur + Math.max(-max, Math.min(max, wrap(target - cur)));
const yawTo = (dx, dz) => Math.atan2(-dx, dz) * 180 / Math.PI;       // Minecraft yaw: looks along (-sin, cos)
// Imported pet meshes face -Z; the display-entity item basis needs the opposite yaw to show their faces to the target.
const PET_YAW_OFFSET = 180;
const petYawTo = (dx, dz) => wrap(yawTo(dx, dz) + PET_YAW_OFFSET);
const f32 = v => Math.fround(v);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const standOf = (id, meta) => (meta && Number.isFinite(meta.stand) ? meta.stand : (STAND[id] || STAND_DEFAULT));
const grounded = pet => !pet.fly && pet.onGround !== false;

function anim(rig, names) {
  if (!rig._ln) { rig._ln = {}; for (const k of Object.keys(rig.anims)) rig._ln[k.toLowerCase()] = k; }
  for (const n of names) if (rig._ln[n]) return rig._ln[n];
  return null;
}

class Pets {
  constructor(session, cos) {
    this.s = session; this.cos = cos;
    this.live = new Map();                   // owner eid -> pet state
    this.timer = null; this.broken = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try { this.tick(); } catch (e) { this.broken = true; this.s.log('warn', 'PET', 'pets disabled: ' + (e.stack || e.message)); this.stop(); }
    }, TICK_MS);
    this.timer.unref && this.timer.unref();
  }
  stop() { clearInterval(this.timer); this.timer = null; }

  /* ---------- packets ---------- */
  look(vid, yaw, ground) { return this.s.build('entity_look', { entityId: vid, yaw: Riders.toByte(yaw), pitch: 0, onGround: !!ground }); }
  headLook(vid, yaw) { return this.s.build('entity_head_rotation', { entityId: vid, headYaw: Riders.toByte(yaw) }); }
  mobSpawnBuf(pet) {
    const s = this.s, mob = pet.rec.mob, entity = mob && s.mcData.entitiesByName[mob.entity];
    if (!entity) return null;
    const uuid = require('crypto').randomUUID();
    return s.buildAny('spawn_entity', [
      { entityId: pet.root, objectUUID: uuid, type: entity.id, x: pet.x, y: pet.y, z: pet.z, pitch: 0, yaw: Riders.toByte(pet.yaw), headPitch: 0, objectData: 0, velocity: { x: 0, y: 0, z: 0 } },
      { entityId: pet.root, objectUUID: uuid, type: entity.id, x: pet.x, y: pet.y, z: pet.z, pitch: 0, yaw: Riders.toByte(pet.yaw), objectData: 0, velocityX: 0, velocityY: 0, velocityZ: 0 }
    ]);
  }
  mobMeta(pet) {
    const keys = this.s.mcData.entitiesByName[pet.rec.mob.entity]?.metadataKeys || [];
    const metadata = [];
    const baby = keys.indexOf('baby'), silent = keys.indexOf('silent');
    if (pet.rec.mob.baby && baby >= 0) metadata.push({ key: baby, type: 'boolean', value: true });
    if (silent >= 0) metadata.push({ key: silent, type: 'boolean', value: true });
    return metadata.length ? this.s.riders.metaBuf(pet.root, metadata) : null;
  }
  tpBuf(pet, d) {
    const s = this.s;
    const base = { entityId: pet.root, x: pet.x, y: pet.y, z: pet.z, yaw: pet.yaw, pitch: 0, onGround: grounded(pet) };
    if (s.pv >= 768) {
      const mv = { dx: d.dx, dy: d.dy, dz: d.dz };
      return s.buildAny('entity_teleport', [Object.assign({}, base, mv, { flags: {} }), Object.assign({}, base, mv, { flags: 0 })]);
    }
    return s.buildAny('entity_teleport', [Object.assign({}, base, { yaw: Riders.toByte(pet.yaw) })]);
  }
  passengers(pet) { return pet.isMob ? null : this.s.build('set_passengers', { entityId: pet.root, passengers: pet.parts.map(p => p.vid) }); }
  destroyBuf(pet) { return this.s.build('entity_destroy', { entityIds: [pet.root].concat(pet.parts.map(p => p.vid)) }); }

  /* ---------- the pose ---------- */
  // transformation of one part for the bone matrices W (blocks); K = pet scale
  transform(W, j, p, K) {
    const A = W[j].A, b = W[j].b;
    // linear part: ROT_Y180 * K * scale * A * F   (rows 0 and 2 change sign)
    const L = mulM(A, p.rot).map(r => r.map(v => v * p.scale * K));
    const M = [L[0].map(v => -v), L[1], L[2].map(v => -v)];
    const c = [A[0][0] * p.t[0] + A[0][1] * p.t[1] + A[0][2] * p.t[2] + b[0], A[1][0] * p.t[0] + A[1][1] * p.t[1] + A[1][2] * p.t[2] + b[1], A[2][0] * p.t[0] + A[2][1] * p.t[1] + A[2][2] * p.t[2] + b[2]];
    const t = [-c[0] * K, c[1] * K, -c[2] * K];
    const d = decompose(M);
    return { t, sc: d.sc, left: d.left, right: d.right };
  }
  tmeta(tr) {
    const q = o => ({ x: f32(o.x), y: f32(o.y), z: f32(o.z), w: f32(o.w) });
    return [
      { key: 11, type: 'vector3', value: { x: f32(tr.t[0]), y: f32(tr.t[1]), z: f32(tr.t[2]) } },
      { key: 12, type: 'vector3', value: { x: f32(tr.sc[0]), y: f32(tr.sc[1]), z: f32(tr.sc[2]) } },
      { key: 13, type: 'quaternion', value: q(tr.left) },
      { key: 14, type: 'quaternion', value: q(tr.right) }
    ];
  }
  sigOf(tr) { return [tr.t, tr.sc, [tr.left.x, tr.left.y, tr.left.z, tr.left.w], [tr.right.x, tr.right.y, tr.right.z, tr.right.w]].map(a => a.map(v => Math.round(v * 2000)).join(',')).join('|'); }

  layers(pet, now) {
    const rig = pet.rec.rig; const t = (now - pet.t0) / 1000;
    const main = anim(rig, ['main']);
    let state = null;
    if (pet.moving) {
      if (pet.speed > 0.36) state = anim(rig, ['run', 'walk', 'moving']);
      if (!state && pet.fly) state = anim(rig, ['fly', 'flying']);
      if (!state) state = anim(rig, ['walk', 'moving', 'run']);
    } else {
      state = anim(rig, ['idle', 'afk']);
      if (!state && pet.fly && !main) state = anim(rig, ['fly', 'flying']);
      if (!state) state = main || Object.keys(rig.anims)[0] || null;
    }
    // These assets define alternative full clips, not additive layers. Applying `main` together
    // with walk/idle stacks rotations and offsets and visibly bends otherwise correct models.
    return state ? [{ name: state, time: t }] : [];
  }

  /* ---------- AI ---------- */
  // Calm, "alive" companion behaviour (the pet never mirrors the owner's facing):
  //   idle   - stands around for a few seconds, looks at the owner or somewhere else
  //   wander - strolls slowly to a random spot of the ring around the owner (never right in front of the owner's face)
  //   follow - only when the owner got far away: walks over at a moderate speed and stops at the edge of the ring
  //   avoid  - the owner walked into the pet: it steps out of the way
  // pet.stand = distance kept from the owner: 2 blocks, 3 for the adult hoglin, 4 for the adult sniffer.
  ownerYaw(o) {
    const tracked = this.s.riders.rotOf(o.eid);
    const y = o.self && this.s.pos ? this.s.pos.yaw : (Number.isFinite(tracked.head) ? tracked.head : tracked.cur);
    return Number.isFinite(y) ? y : 0;
  }
  // spawn / teleport spot: on the ring, behind the owner
  place(pet, o) {
    const a = this.ownerYaw(o) * Math.PI / 180, r = pet.stand + 0.5;
    const W = P.worldOf(this.s), spot = W ? P.findSpot(W, pet, o, a, r) : null;   // a free spot with ground below
    if (spot) { pet.x = spot.x; pet.z = spot.z; pet.y = spot.y + pet.hover; }
    else { pet.x = o.x + Math.sin(a) * r; pet.z = o.z - Math.cos(a) * r; pet.y = o.y + pet.hover; }
    pet.gy = o.y; pet.oy = o.y; pet.stable = 5;
    pet.vy = 0; pet.onGround = true; pet.stuck = 0; pet.high = 0; pet.lift = 0; pet.liftUntil = 0; pet.side = 0; pet.detour = 0;
  }
  yawTo(pet, dx, dz) { return pet.isMob ? yawTo(dx, dz) : petYawTo(dx, dz); }

  // stand still for a while; most of the time the pet watches the owner, sometimes it looks around
  rest(pet, o, now) {
    pet.mode = 'idle';
    pet.modeUntil = now + 1800 + Math.random() * 4200;
    pet.watch = Math.random() < 0.65;
    pet.faceYaw = pet.watch ? this.yawTo(pet, o.x - pet.x, o.z - pet.z) : wrap(pet.yaw + (Math.random() - 0.5) * 150);
  }
  // random spot on the ring around the owner, outside the owner's front cone, reachable without passing the owner
  pickWander(pet, o, now) {
    const stand = pet.stand, near = pet.near;
    const fy = this.ownerYaw(o) * Math.PI / 180, fx = -Math.sin(fy), fz = Math.cos(fy);
    const W = P.worldOf(this.s);
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2, r = stand + 0.2 + Math.random() * 1.6;
      const ux = Math.cos(a), uz = Math.sin(a);
      if (ux * fx + uz * fz > 0.6) continue;                       // not in front of the owner's face
      const tx = o.x + ux * r, tz = o.z + uz * r;
      const sx = tx - pet.x, sz = tz - pet.z, len2 = sx * sx + sz * sz;
      if (len2 < 0.64) continue;                                   // too short to be worth a walk
      if (W && !pet.fly) {                                           // only spots with ground a pet can reach (a step up, a short drop)
        const sy = P.standY(W, pet, tx, tz, pet.y + 1.5);
        if (sy === null || sy - pet.y < -3 || sy - pet.y > 1.05) continue;
      }
      const t = clamp(((o.x - pet.x) * sx + (o.z - pet.z) * sz) / len2, 0, 1);
      if (Math.hypot(pet.x + sx * t - o.x, pet.z + sz * t - o.z) < near + 0.3) continue;   // the way leads past the owner
      pet.mode = 'wander'; pet.tx = tx; pet.tz = tz; pet.wspeed = 0.055 + Math.random() * 0.03; pet.modeUntil = now + 9000;
      return true;
    }
    return false;
  }

  create(eid, w, out) {
    const o = w.p; const s = this.s; const rig = w.rec.rig; const meta = w.rec.pet || {};
    const pet = {
      id: w.id, eid, rec: w.rec, K: meta.scale || 1, isMob: !!w.rec.mob, fly: !!meta.fly,
      hover: meta.fly ? clamp((meta.offset ? meta.offset[1] : 1) * 1.1, 0.6, 1.6) : 0,
      stand: standOf(w.id, meta), near: 0,
      root: s.riders.newId(), parts: [], x: 0, y: 0, z: 0, yaw: 0, lx: 0, ly: 0, lz: 0, lyaw: 0, moving: false, speed: 0, t0: Date.now(), lastAnim: 0, still: 0, lyawSent: 0, fullMobMeta: null,
      mode: 'idle', modeUntil: Date.now() + 1500, faceYaw: 0, watch: true, tx: 0, tz: 0, wspeed: 0.07, vx: 0, vz: 0, gy: o.y, oy: o.y, stable: 5,
      r: 0.25, h: 0.6, vy: 0, onGround: true, jumpCool: 0, stuck: 0, side: 0, free: 0, lift: 0, liftUntil: 0, high: 0, direct: 0
    };
    Object.assign(pet, P.dims(w.id, meta));
    pet.near = Math.max(1.6, pet.stand * 0.8);
    this.place(pet, o);
    pet.yaw = this.yawTo(pet, o.x - pet.x, o.z - pet.z); pet.faceYaw = pet.yaw; pet.lyaw = pet.yaw; pet.lyawSent = pet.yaw;
    pet.lx = pet.x; pet.ly = pet.y; pet.lz = pet.z;
    const W = rig.world(this.layers(pet, pet.t0));
    w.rec.bparts.forEach((parts, j) => {
      for (const p of parts) pet.parts.push({ vid: s.riders.newId(), j, p, dyn: rig.dyn[j], sig: '', full: null });
    });
    const pos = { x: pet.x, y: pet.y, z: pet.z };
    const spawn = pet.isMob ? this.mobSpawnBuf(pet) : s.riders.spawnBuf(pet.root, 'item_display', pos, pet.yaw);
    const bufs = [spawn];
    if (pet.isMob) {
      pet.fullMobMeta = this.mobMeta(pet);
      if (pet.fullMobMeta) bufs.push(pet.fullMobMeta);
      const look = this.headLook(pet.root, pet.yaw); if (look) bufs.push(look);
    }
    for (const part of pet.parts) {
      const tr = this.transform(W, part.j, part.p, pet.K); part.sig = this.sigOf(tr);
      part.full = this.tmeta(tr).concat([
        { key: 15, type: 'byte', value: 0 },
        { key: 23, type: 'item_stack', value: this.cos.stack(part.p.ref) },
        { key: 24, type: 'byte', value: 0 }
      ]);
      bufs.push(s.riders.spawnBuf(part.vid, 'item_display', pos, pet.yaw), s.riders.metaBuf(part.vid, part.full));
    }
    const passengerBuf = this.passengers(pet);
    if (passengerBuf) bufs.push(passengerBuf);
    if (bufs.some(b => !b)) { this.broken = true; s.log('warn', 'PET', 'cannot build pet packets, pets disabled'); this.stop(); return null; }
    out.push(...bufs);
    this.live.set(eid, pet);
    return pet;
  }

  step(pet, o, out, now) {
    const stand = pet.stand, near = pet.near;
    let dx = o.x - pet.x, dz = o.z - pet.z, dist = Math.hypot(dx, dz);

    // ground level of the owner: only a stable height counts, so the pet does not hop along with the owner's jumps
    if (Math.abs(o.y - pet.oy) < 0.03) pet.stable++; else pet.stable = 0;
    pet.oy = o.y;
    if (pet.stable >= 5) pet.gy = o.y;

    // stuck for ages / left far below the owner (a pit, under a ledge): reappear next to the owner
    const W = P.worldOf(this.s);
    if (W) pet.high = (!pet.fly && o.y - pet.y > 2.4 && dist < stand + 4) ? pet.high + 1 : 0;
    const lost = !!W && (pet.high > 100 || pet.stuck > 240 || pet.detour > 600 || (pet.stuck > 140 && dist > stand + 2.5));

    // far too far away (teleport, elevator ...): reappear on the ring behind the owner
    if (dist > WARP || Math.abs(o.y - pet.y) > 12 || lost) {
      this.place(pet, o); pet.vx = 0; pet.vz = 0; this.rest(pet, o, now);
      dx = o.x - pet.x; dz = o.z - pet.z; dist = Math.hypot(dx, dz);
      pet.yaw = this.yawTo(pet, dx, dz); pet.faceYaw = pet.yaw;
    }

    const phys = !!W && W.has(pet.x, pet.z);   // blocks are known here: real collision, otherwise the old free movement

    // ---- behaviour ----
    if (dist < near) { if (pet.mode !== 'avoid') pet.mode = 'avoid'; }
    else if (dist > stand + 3.5) { if (pet.mode !== 'follow') pet.mode = 'follow'; }
    else if (pet.mode === 'follow' && dist <= stand + 1.5) this.rest(pet, o, now);
    else if (pet.mode === 'avoid' && dist >= stand) this.rest(pet, o, now);
    else if (pet.mode === 'idle' && now >= pet.modeUntil) { if (!(Math.random() < 0.7 && this.pickWander(pet, o, now))) this.rest(pet, o, now); }
    else if (pet.mode === 'wander') {
      if (Math.hypot(pet.tx - pet.x, pet.tz - pet.z) < 0.25 || now > pet.modeUntil || Math.hypot(pet.tx - o.x, pet.tz - o.z) < near + 0.1) this.rest(pet, o, now);
    }

    // where to and how fast (blocks per tick; 0.05 = 1 block/s)
    let tx = pet.x, tz = pet.z, sp = 0;
    if (pet.mode === 'follow' || pet.mode === 'avoid') {
      let ux, uz;                                                  // from the owner towards the pet
      if (dist > 0.05) { ux = -dx / dist; uz = -dz / dist; } else { const a = this.ownerYaw(o) * Math.PI / 180; ux = Math.sin(a); uz = -Math.cos(a); }
      const r = pet.mode === 'follow' ? stand + 0.8 : stand + 0.4;
      tx = o.x + ux * r; tz = o.z + uz * r;
      sp = pet.mode === 'follow' ? clamp(0.09 + (dist - stand - 1.5) * 0.045, 0.09, 0.23) : 0.13;
    } else if (pet.mode === 'wander') { tx = pet.tx; tz = pet.tz; sp = pet.wspeed; }

    let wantVx = 0, wantVz = 0, face = null;
    const mdx = tx - pet.x, mdz = tz - pet.z, md = Math.hypot(mdx, mdz);
    if (sp > 0 && md > 0.12) {
      let ux = mdx / md, uz = mdz / md;
      if (phys && pet.direct <= now) {                             // walk around obstacles instead of straight at the target
        const sa = P.steer(W, pet, Math.atan2(mdz, mdx), md);
        ux = Math.cos(sa); uz = Math.sin(sa);
      }
      face = this.yawTo(pet, ux, uz);
      const diff = Math.abs(wrap(face - pet.yaw));
      const k = diff > 70 ? 0 : diff > 30 ? 0.45 : 1;              // turn first, then walk
      const v = Math.min(sp, md) * k;
      wantVx = ux * v; wantVz = uz * v;
    }
    pet.vx += (wantVx - pet.vx) * 0.25; pet.vz += (wantVz - pet.vz) * 0.25;   // gentle start / stop
    let spd = Math.hypot(pet.vx, pet.vz);
    if (spd < 0.004) { pet.vx = 0; pet.vz = 0; spd = 0; }
    if (phys) {
      const px = pet.x, pz = pet.z;
      if (!P.walk(W, pet, now, o)) {                               // inside blocks and no way out: reappear next to the owner
        this.place(pet, o); pet.vx = 0; pet.vz = 0; spd = 0;
      } else {
        const eff = Math.hypot(pet.x - px, pet.z - pz);            // what the pet really moved
        pet.stuck = (spd > 0.03 && eff < spd * 0.35) ? pet.stuck + 1 : Math.max(0, pet.stuck - 2);
        if (pet.stuck === 25) {                                    // pushing against something: try the other side
          pet.side = pet.side ? -pet.side : (Math.random() < 0.5 ? 1 : -1);
          if (pet.mode === 'wander') this.rest(pet, o, now);
        }
        if (pet.stuck === 60) pet.direct = now + 2500;             // steering does not help: push straight for a moment
        spd = eff;                                                 // no walk animation against a wall
      }
    } else { pet.x += pet.vx; pet.z += pet.vz; }

    // facing: the walking direction while walking, otherwise the owner (or wherever the pet looks right now)
    if (face !== null) pet.yaw = turn(pet.yaw, face, 12);
    else {
      if (pet.mode === 'idle' && pet.watch) pet.faceYaw = this.yawTo(pet, o.x - pet.x, o.z - pet.z);
      pet.yaw = turn(pet.yaw, pet.faceYaw, 5);
    }

    // height: ground pets follow the stable ground level of the owner, flying pets hover and bob lazily
    if (!phys) {
      const ty = (pet.fly ? o.y : pet.gy) + pet.hover + (pet.fly ? Math.sin(now / 700 + pet.eid) * 0.18 : 0);
      const dy = ty - pet.y;
      pet.y += dy > 0 ? Math.min(dy, pet.fly ? 0.1 : 0.25) : Math.max(dy, pet.fly ? -0.1 : -0.45);
    }

    pet.speed = spd;
    if (spd > 0.012) { pet.moving = true; pet.still = 0; } else if (++pet.still > 4) pet.moving = false;

    const moved = Math.abs(pet.x - pet.lx) > 1e-3 || Math.abs(pet.y - pet.ly) > 1e-3 || Math.abs(pet.z - pet.lz) > 1e-3;
    if (moved) {
      const b = this.tpBuf(pet, { dx: pet.x - pet.lx, dy: pet.y - pet.ly, dz: pet.z - pet.lz });
      if (!b) { this.broken = true; this.s.log('warn', 'PET', 'cannot build pet packets, pets disabled'); this.stop(); return; }
      out.push(b); pet.lx = pet.x; pet.ly = pet.y; pet.lz = pet.z;
    }
    if (Math.abs(wrap(pet.yaw - pet.lyawSent)) > 0.7) {
      pet.lyawSent = pet.yaw;
      out.push(this.look(pet.root, pet.yaw, grounded(pet)));
      if (pet.isMob) {
        const head = this.headLook(pet.root, pet.yaw); if (head) out.push(head);
      } else {
        for (const part of pet.parts) out.push(this.look(part.vid, pet.yaw));
      }
    }
    // animated bones
    if (now - pet.lastAnim >= ANIM_MS) {
      pet.lastAnim = now;
      const rig = pet.rec.rig; const W = rig.world(this.layers(pet, now));
      for (const part of pet.parts) {
        if (!part.dyn) continue;
        const tr = this.transform(W, part.j, part.p, pet.K); const sig = this.sigOf(tr);
        if (sig === part.sig) continue;
        part.sig = sig;
        const tm = this.tmeta(tr);
        part.full.splice(0, 4, ...tm);
        out.push(this.s.riders.metaBuf(part.vid, [{ key: 8, type: 'int', value: 0 }, { key: 9, type: 'int', value: INTERP }].concat(tm)));
      }
    }
  }

  tick() {
    const s = this.s; const cos = this.cos;
    if (this.broken || !s.ready || !s.snap || !s.peers.some(p => p.attached)) return;
    if (!cos.available() || !cos.mayHavePets()) { if (this.live.size) this.clearAll(true); cos.petsNeed = false; return; }
    const players = s.riders.players(); const now = Date.now();
    const want = new Map();
    for (const p of players.values()) {
      if (p.hidden || HIDE_POSES.has(p.pose) || typeof p.x !== 'number') continue;
      const eq = cos.equippedFor(p); const id = eq && eq.pet;
      const rec = id && cos.pack.items.get(id);
      if (!rec || (rec.mob ? !rec.mob.entity : !rec.bparts || !rec.bparts.length)) continue;
      want.set(p.eid, { id, p, rec });
    }
    const need = want.size > 0;
    if (need !== cos.petsNeed) { cos.petsNeed = need; if (need && cos.packs) cos.packs.ensureOwn(); }
    const out = [];
    for (const [eid, pet] of [...this.live]) {
      const w = want.get(eid);
      if (!w || w.id !== pet.id) { out.push(this.destroyBuf(pet)); this.live.delete(eid); }
    }
    for (const [eid, w] of want) {
      const pet = this.live.get(eid);
      if (!pet) { if (!this.create(eid, w, out) && this.broken) return; } else this.step(pet, w.p, out, now);
    }
    for (const b of out) if (b) s.riders.send(b);
  }

  /* ---------- lifecycle ---------- */
  // a client just received the snapshot: bring it up to date with the pets
  replayTo(peer) {
    const s = this.s;
    for (const pet of this.live.values()) {
      const pos = { x: pet.x, y: pet.y, z: pet.z };
      if (pet.isMob) {
        peer.send(this.mobSpawnBuf(pet), 'play');
        if (pet.fullMobMeta) peer.send(pet.fullMobMeta, 'play');
        const look = this.headLook(pet.root, pet.yaw); if (look) peer.send(look, 'play');
        continue;
      }
      peer.send(s.riders.spawnBuf(pet.root, 'item_display', pos, pet.yaw), 'play');
      for (const part of pet.parts) {
        peer.send(s.riders.spawnBuf(part.vid, 'item_display', pos, pet.yaw), 'play');
        peer.send(s.riders.metaBuf(part.vid, part.full), 'play');
      }
      const pass = this.passengers(pet); if (pass) peer.send(pass, 'play');
    }
  }
  // everything is re-created on the next tick (roles were switched / a client lost its entities)
  refreshAll() { this.clearAll(true); }
  // login / respawn: the client forgot every entity, only forget our state
  dropState() { this.live.clear(); }
  clearAll(sendDestroy) {
    if (sendDestroy) for (const pet of this.live.values()) { const b = this.destroyBuf(pet); if (b) this.s.riders.send(b); }
    this.live.clear();
  }
  observe(name) { if (name === 'login' || name === 'respawn') this.dropState(); }
}

module.exports = { Pets };
