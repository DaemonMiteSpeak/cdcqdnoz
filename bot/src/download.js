// Portable EXE delivery: user-chosen filename + optional random padding (0-15 MB).
// Layout of the release file: [launcher][payload...][FOOTER 64 bytes]. Padding is inserted
// between the payload and the footer, so the launcher (which reads the footer from EOF) ignores it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { config, ROOT } from './config.js';
import { db } from './db.js';
import { ApiError, getUser } from './service.js';

export const FOOTER_LEN = 64;
export const FOOTER_MAGIC = 'HDRSFX01';
export const MAX_EXTRA = 15 * 1024 * 1024;
const TICKET_TTL = 6 * 3600000; // the link is meant to be opened in a PC browser, possibly later
const MAX_USES = 20;
const TOKEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const TOKEN_RE = /^[a-z0-9]{26}$/;
const makeToken = () => Array.from({ length: 26 }, () => TOKEN_ALPHABET[crypto.randomInt(TOKEN_ALPHABET.length)]).join('');
/** URL path segment that identifies the owner: Telegram username, else numeric id. */
export const ownerSegment = (u) => (u.username && /^[A-Za-z0-9_]{1,64}$/.test(u.username) ? u.username : String(u.id));
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export const releaseFile = () => process.env.APP_EXE || path.join(ROOT, 'release', 'Hider.exe');

export function releaseInfo() {
  const f = releaseFile();
  try {
    const st = fs.statSync(f);
    if (st.size <= FOOTER_LEN) return null;
    const fd = fs.openSync(f, 'r');
    const foot = Buffer.alloc(FOOTER_LEN);
    fs.readSync(fd, foot, 0, FOOTER_LEN, st.size - FOOTER_LEN);
    fs.closeSync(fd);
    if (foot.subarray(0, 8).toString('latin1') !== FOOTER_MAGIC) return null;
    return { file: f, size: st.size, mtime: st.mtimeMs, footer: foot };
  } catch {
    return null;
  }
}

/** Safe Windows filename ending in .exe, or throws. */
export function cleanFilename(raw) {
  let s = String(raw ?? '').normalize('NFC').trim();
  s = s.replace(/\.exe$/i, '').replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim();
  if (!s || s.length > 60 || RESERVED.test(s)) throw new ApiError(400, 'bad_filename');
  return `${s}.exe`;
}

export function createTicket(user, { filename, randomSize }) {
  if (user.sub_until <= Date.now()) throw new ApiError(403, 'sub_required');
  const rel = releaseInfo();
  if (!rel) throw new ApiError(503, 'release_unavailable');
  const name = cleanFilename(filename);
  const extra = randomSize ? crypto.randomInt(0, MAX_EXTRA + 1) : 0;
  const token = makeToken();
  const now = Date.now();
  db.prepare('DELETE FROM dl_tickets WHERE expires_at<?').run(now - 3600000);
  db.prepare('INSERT INTO dl_tickets(token, user_id, filename, extra_bytes, created_at, expires_at) VALUES(?,?,?,?,?,?)')
    .run(token, user.id, name, extra, now, now + TICKET_TTL);
  const base = config.webappUrl;
  return { url: `${base}/${ownerSegment(user)}/${token}`, filename: name, extraBytes: extra, size: rel.size + extra, expiresAt: now + TICKET_TTL };
}

function paddingStream(bytes) {
  let left = bytes;
  return Readable.from((async function* gen() {
    while (left > 0) {
      const n = Math.min(left, 65536);
      left -= n;
      yield crypto.randomBytes(n);
    }
  })());
}

async function* body(rel, extra) {
  const head = rel.size - FOOTER_LEN;
  for await (const c of fs.createReadStream(rel.file, { start: 0, end: head - 1, highWaterMark: 1 << 20 })) yield c;
  if (extra > 0) for await (const c of paddingStream(extra)) yield c;
  yield rel.footer;
}

/** Serves /<username>/<token> (and legacy /dl/<token>). Returns false when the request is not a download link, so routing can continue. */
export function serveTicket(req, res) {
  const token = String(req.params.token);
  if (req.params.user !== undefined && !TOKEN_RE.test(token)) return false;
  const t = db.prepare('SELECT * FROM dl_tickets WHERE token=?').get(token);
  const u = t && getUser(t.user_id);
  if (req.params.user !== undefined && (!t || !u || ownerSegment(u).toLowerCase() !== String(req.params.user).toLowerCase())) return false;
  if (!t || t.expires_at < Date.now() || t.uses >= MAX_USES || !u || u.banned || u.sub_until <= Date.now()) {
    res.status(410).type('text/plain').send('Link expired. Create a new download in the Mini App.');
    return true;
  }
  const rel = releaseInfo();
  if (!rel) { res.status(503).type('text/plain').send('Release is not available'); return true; }
  db.prepare('UPDATE dl_tickets SET uses=uses+1 WHERE token=?').run(t.token);
  const total = rel.size + t.extra_bytes;
  const ascii = t.filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  res.status(200).set({
    'Content-Type': 'application/vnd.microsoft.portable-executable',
    'Content-Length': String(total),
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(t.filename)}`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') { res.end(); return true; }
  Readable.from(body(rel, t.extra_bytes)).on('error', () => res.destroy()).pipe(res);
  return true;
}
