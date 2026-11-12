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
const TICKET_TTL = 10 * 60000;
const MAX_USES = 4;
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
  const token = crypto.randomBytes(18).toString('base64url');
  const now = Date.now();
  db.prepare('DELETE FROM dl_tickets WHERE expires_at<?').run(now - 3600000);
  db.prepare('INSERT INTO dl_tickets(token, user_id, filename, extra_bytes, created_at, expires_at) VALUES(?,?,?,?,?,?)')
    .run(token, user.id, name, extra, now, now + TICKET_TTL);
  const base = config.webappUrl;
  return { url: `${base}/dl/${token}`, filename: name, extraBytes: extra, size: rel.size + extra, expiresAt: now + TICKET_TTL };
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

export function serveTicket(req, res) {
  const t = db.prepare('SELECT * FROM dl_tickets WHERE token=?').get(String(req.params.token));
  const u = t && getUser(t.user_id);
  if (!t || t.expires_at < Date.now() || t.uses >= MAX_USES || !u || u.banned || u.sub_until <= Date.now()) {
    return res.status(410).type('text/plain').send('Link expired. Create a new download in the Mini App.');
  }
  const rel = releaseInfo();
  if (!rel) return res.status(503).type('text/plain').send('Release is not available');
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
  if (req.method === 'HEAD') return res.end();
  Readable.from(body(rel, t.extra_bytes)).on('error', () => res.destroy()).pipe(res);
}
