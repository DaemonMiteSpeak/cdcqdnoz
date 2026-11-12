// Telegram avatars: downloaded through the Bot API once, cached on disk, served at a signed URL.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { db } from './db.js';

const DIR = process.env.AVATAR_DIR || path.join(path.dirname(config.dbFile), 'avatars');
fs.mkdirSync(DIR, { recursive: true });
const REFRESH_MS = 6 * 3600 * 1000;
const API_ROOT = (process.env.TG_API_ROOT || 'https://api.telegram.org').replace(/\/$/, '');
const inflight = new Set();

const sig = (id) => crypto.createHmac('sha256', `avatar|${config.botToken}`).update(String(id)).digest('hex').slice(0, 12);
export const avatarFile = (id) => path.join(DIR, `${Number(id)}.jpg`);
export const avatarSigOk = (id, s) => typeof s === 'string' && s.length === 12 && crypto.timingSafeEqual(Buffer.from(sig(id)), Buffer.from(s));

/** Public URL of the cached avatar, else Telegram's own photo URL, else null. */
export function avatarUrl(u) {
  if (u.avatar_at && fs.existsSync(avatarFile(u.id)) && config.webappUrl) {
    return `${config.webappUrl}/avatar/${u.id}.${sig(u.id)}.jpg?v=${u.avatar_at}`;
  }
  return u.photo_url || null;
}

async function fetchJson(url, ms = 15000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
  return r.json();
}

/** Fire-and-forget refresh; never throws. */
export async function refreshAvatar(userId, { force = false } = {}) {
  if (!config.botToken || inflight.has(userId)) return false;
  const u = db.prepare('SELECT id, avatar_at FROM users WHERE id=?').get(userId);
  if (!u || (!force && u.avatar_at && Date.now() - u.avatar_at < REFRESH_MS)) return false;
  inflight.add(userId);
  try {
    const base = `${API_ROOT}/bot${config.botToken}`;
    const ph = await fetchJson(`${base}/getUserProfilePhotos?user_id=${userId}&limit=1`);
    const sizes = ph.ok && ph.result.photos[0];
    if (!sizes || !sizes.length) { db.prepare('UPDATE users SET avatar_at=0 WHERE id=?').run(userId); return false; }
    const pick = sizes.find((s) => s.width >= 160) || sizes[sizes.length - 1];
    const f = await fetchJson(`${base}/getFile?file_id=${encodeURIComponent(pick.file_id)}`);
    if (!f.ok) return false;
    const img = await fetch(`${API_ROOT}/file/bot${config.botToken}/${f.result.file_path}`, { signal: AbortSignal.timeout(20000) });
    if (!img.ok) return false;
    const buf = Buffer.from(await img.arrayBuffer());
    if (buf.length < 200 || buf.length > 2e6) return false;
    fs.writeFileSync(`${avatarFile(userId)}.tmp`, buf);
    fs.renameSync(`${avatarFile(userId)}.tmp`, avatarFile(userId));
    db.prepare('UPDATE users SET avatar_at=? WHERE id=?').run(Date.now(), userId);
    return true;
  } catch (e) {
    console.error('avatar', userId, e.message);
    return false;
  } finally {
    inflight.delete(userId);
  }
}

export const _ROOT = ROOT;
