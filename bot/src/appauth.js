// Desktop-app authentication against the bot database: Telegram username + license key.
import crypto from 'node:crypto';
import { config } from './config.js';
import { db } from './db.js';
import { ApiError, getUser, generateKeyCode } from './service.js';
import { avatarUrl } from './avatars.js';
import { TAGS } from './config.js';

const MAX_FAILS = 8;
const LOCK_MS = 15 * 60000;
const fails = new Map(); // "u:<id>" | "ip:<addr>" -> { n, until }

const locked = (k) => { const f = fails.get(k); return !!f && f.n >= MAX_FAILS && f.until > Date.now(); };
function bump(k) {
  const f = fails.get(k);
  const n = f && f.until > Date.now() ? f.n + 1 : 1;
  fails.set(k, { n, until: Date.now() + LOCK_MS });
}
setInterval(() => { const now = Date.now(); for (const [k, f] of fails) if (f.until < now) fails.delete(k); }, 600000).unref();

const normName = (s) => String(s ?? '').trim().replace(/^@+/, '').slice(0, 64);
export const normLicense = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 64);

function eq(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

/** Telegram username (without @) or numeric Telegram id. */
export function findUser(name) {
  const n = normName(name);
  if (!n) return null;
  const byName = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE LIMIT 2').all(n);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) return null; // ambiguous: refuse rather than guess
  if (/^\d{3,15}$/.test(n)) return db.prepare('SELECT * FROM users WHERE id=?').get(Number(n)) || null;
  return null;
}

/** Personal key: created on demand, shown to the owner in the Mini App. */
export function ensureLicenseKey(u) {
  if (u.license_key) return u.license_key;
  for (;;) {
    const code = generateKeyCode();
    if (db.prepare('UPDATE users SET license_key=? WHERE id=? AND license_key IS NULL').run(code, u.id).changes) return code;
    const cur = getUser(u.id);
    if (cur.license_key) return cur.license_key;
  }
}

function keyMatches(u, raw) {
  const want = normLicense(raw);
  if (want.length < 8) return false;
  let ok = false;
  if (u.license_key && eq(normLicense(u.license_key), want)) ok = true;
  for (const k of db.prepare('SELECT norm FROM keys WHERE used_by=? AND blocked=0').all(u.id)) {
    if (k.norm && eq(k.norm, want)) ok = true;
  }
  return ok;
}

export const subActive = (u) => u.sub_until > Date.now();

export function profile(u) {
  const tag = TAGS.find((t) => t.id === u.tag) || TAGS[0];
  return {
    id: u.id,
    name: u.username || String(u.id),
    firstName: u.first_name || '',
    tag: tag.title,
    tagId: tag.id,
    tagColor: tag.color,
    until: u.sub_until || 0,
    created: u.created_at || 0,
    avatar: avatarUrl(u),
    tv: u.app_tv || 0,
  };
}

/** Constant-work credential check. Throws ApiError with a generic code for any credential problem. */
export function login({ username, key, hwid, ip }) {
  const ipk = `ip:${ip || '?'}`;
  const probe = findUser(username);
  const uk = `u:${probe ? probe.id : normName(username).toLowerCase()}`;
  if (locked(ipk) || locked(uk)) throw new ApiError(429, 'too_many_attempts');
  const fail = () => { bump(ipk); bump(uk); throw new ApiError(401, 'invalid_credentials'); };
  const u = probe;
  const good = u ? keyMatches(u, key) : (eq('x', 'y'), false);
  if (!u || !good) fail();
  if (u.banned) throw new ApiError(403, 'banned');
  if (!subActive(u)) throw new ApiError(403, 'expired');
  bindHwid(u, hwid);
  fails.delete(uk);
  db.prepare('UPDATE users SET app_seen_at=?, launches=launches+1, last_launch_at=? WHERE id=?').run(Date.now(), Date.now(), u.id);
  return profile(getUser(u.id));
}

function bindHwid(u, hwid) {
  const h = String(hwid || '').toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 64);
  if (h.length < 16) throw new ApiError(400, 'hwid_required');
  if (!u.app_hwid) {
    if (db.prepare('UPDATE users SET app_hwid=? WHERE id=? AND app_hwid IS NULL').run(h, u.id).changes) return;
    u = getUser(u.id);
  }
  if (!eq(u.app_hwid, h)) throw new ApiError(409, 'hwid_mismatch');
}

/** Re-check an existing session (resume token / periodic revalidation). */
export function check({ id, name, tv, hwid }) {
  const u = id ? getUser(Number(id)) : findUser(name);
  if (!u) throw new ApiError(404, 'deleted');
  if (u.banned) throw new ApiError(403, 'banned');
  if (!subActive(u)) throw new ApiError(403, 'expired');
  if ((u.app_tv || 0) !== (Number(tv) || 0)) throw new ApiError(401, 'revoked');
  if (hwid !== undefined) bindHwid(u, hwid);
  return profile(u);
}

/** Called after the user resets their HWID in the Mini App: revokes live desktop sessions. */
export function revokeSessions(userId) {
  db.prepare('UPDATE users SET app_hwid=NULL, app_tv=app_tv+1 WHERE id=?').run(userId);
}

export const internalEnabled = () => !!config.relaySecret;
