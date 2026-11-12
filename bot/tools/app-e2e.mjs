// App-integration check against a DEV server:  see tools/README in deploy/ for env.
//   DB_FILE=/tmp/app-e2e.db DEV=1 PORT=3115 INTERNAL_PORT=3116 RELAY_SECRET=testsecret APP_EXE=/tmp/fake-release.exe \
//   WEBAPP_URL=http://localhost:3115 node src/index.js &   then: node tools/app-e2e.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
process.env.DB_FILE = process.env.DB_FILE || '/tmp/app-e2e.db';
process.env.DEV = '1';
const BASE = process.env.BASE || 'http://localhost:3115';
const INT = process.env.INT || 'http://127.0.0.1:3116';
const SECRET = process.env.RELAY_SECRET || 'testsecret';
const { db } = await import('../src/db.js');
let fail = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++; };
const call = async (uid, method, url, body, name) => {
  const r = await fetch(`${BASE}/api${url}`, { method, headers: { 'Content-Type': 'application/json', 'x-dev-user': String(uid), 'x-dev-username': name || `User${uid}` }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, j: await r.json().catch(() => ({})) };
};
const rel = (path, body, secret = SECRET) => fetch(`${INT}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-relay-secret': secret }, body: JSON.stringify(body) }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => ({})) }));

const U = 880001, V = 880002, W = 880003;
for (const [id, n] of [[U, 'TgAlice'], [V, 'TgBob'], [W, 'TgNoSub']]) { await call(id, 'GET', '/state', null, n); await call(id, 'POST', '/dev/seed', { gate_ok: 1 }, n); }
await call(U, 'POST', '/dev/seed', { sub_until: Date.now() + 10 * 86400000, sub_total_days: 10 }, 'TgAlice');
await call(V, 'POST', '/dev/seed', { sub_until: Date.now() + 10 * 86400000, sub_total_days: 10 }, 'TgBob');

// ---- Mini App: app info + license key
let r = await call(U, 'GET', '/app', null, 'TgAlice');
ok(r.s === 200 && /^HIDER-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(r.j.licenseKey || ''), 'GET /app returns a personal license key');
const keyU = r.j.licenseKey;
ok(r.j.release && r.j.release.size > 64, 'release info available');
r = await call(U, 'GET', '/app', null, 'TgAlice');
ok(r.j.licenseKey === keyU, 'license key is stable');
r = await call(W, 'GET', '/app', null, 'TgNoSub');
ok(r.s === 200 && r.j.active === false && r.j.licenseKey === null, 'no subscription -> no key');
r = await call(W, 'POST', '/download/ticket', { filename: 'x' }, 'TgNoSub');
ok(r.s === 403 && r.j.error === 'sub_required', 'download needs a subscription');

// ---- direct link: /<username>/<26 chars>
r = await call(U, 'POST', '/download/ticket', { filename: 'x' }, 'TgAlice');
ok(/^https?:\/\/[^/]+\/TgAlice\/[a-z0-9]{26}$/.test(r.j.url), 'direct link has the form /<username>/<26-char token>: ' + r.j.url.replace(/^https?:\/\/[^/]+/, ''));
const tok = r.j.url.split('/').pop();
let wrong = await fetch(`${BASE}/SomeoneElse/${tok}`);
ok(wrong.status === 404, 'token under a different username -> 404');
wrong = await fetch(`${BASE}/tgalice/${tok}`, { method: 'HEAD' });
ok(wrong.status === 200 && /attachment/.test(wrong.headers.get('content-disposition') || ''), 'username is case-insensitive, link forces a download');
ok((await fetch(`${BASE}/js/app.js`)).status === 200 && (await fetch(`${BASE}/css/app.css`)).status === 200, 'static files are not shadowed by the /<user>/<token> route');
ok((await fetch(`${BASE}/TgAlice/${'z'.repeat(26)}`)).status === 404, 'well-formed but unknown token -> 404');

// ---- download: filename + random size
const base = fs.statSync(process.env.APP_EXE).size;
r = await call(U, 'POST', '/download/ticket', { filename: 'My Tool', randomSize: false }, 'TgAlice');
ok(r.s === 200 && r.j.filename === 'My Tool.exe' && r.j.extraBytes === 0 && r.j.size === base, 'ticket: custom name, no padding');
let dl = await fetch(r.j.url.replace(/^https?:\/\/[^/]+/, BASE));
let buf = Buffer.from(await dl.arrayBuffer());
ok(dl.status === 200 && buf.length === base && /My%20Tool\.exe/.test(dl.headers.get('content-disposition')), 'download length + Content-Disposition filename');
const orig = fs.readFileSync(process.env.APP_EXE);
ok(Buffer.compare(buf, orig) === 0, 'download without padding is byte-identical to the release');
let extras = [];
for (let i = 0; i < 6; i++) {
  r = await call(U, 'POST', '/download/ticket', { filename: 'rnd', randomSize: true }, 'TgAlice');
  extras.push(r.j.extraBytes);
  dl = await fetch(r.j.url.replace(/^https?:\/\/[^/]+/, BASE));
  buf = Buffer.from(await dl.arrayBuffer());
  if (buf.length !== base + r.j.extraBytes || buf.subarray(0, orig.length - 64).compare(orig, 0, orig.length - 64) !== 0 || buf.subarray(buf.length - 64).compare(orig, orig.length - 64) !== 0) { ok(false, 'padded download keeps payload + footer'); break; }
}
ok(extras.every((e) => e >= 0 && e <= 15 * 1048576) && new Set(extras).size > 1, `random sizes within 0..15MB and vary (${extras.map((e) => (e / 1048576).toFixed(1)).join(', ')} MB)`);
for (const bad of ['', '   ', 'a'.repeat(80), 'CON', '..\\..\\x']) {
  r = await call(U, 'POST', '/download/ticket', { filename: bad }, 'TgAlice');
  if (bad === '..\\..\\x') ok(r.s === 200 && r.j.filename === '....x.exe' || r.s === 200 && !/[\\/]/.test(r.j.filename), 'path separators are stripped');
  else ok(r.s === 400, `bad filename rejected: ${JSON.stringify(bad.slice(0, 12))}`);
}
dl = await fetch(`${BASE}/dl/not-a-token`);
ok(dl.status === 410, 'unknown ticket -> 410');
db.prepare('UPDATE dl_tickets SET expires_at=1').run();
dl = await fetch(r.j.url ? r.j.url.replace(/^https?:\/\/[^/]+/, BASE) : `${BASE}/dl/x`);
ok(dl.status === 410, 'expired ticket -> 410');

// ---- relay auth (username + license key)
const H1 = 'a'.repeat(64), H2 = 'b'.repeat(64);
r = await rel('/relay/login', { username: 'TgAlice', key: keyU, hwid: H1, ip: '1.1.1.1' }, 'wrong');
ok(r.s === 403, 'internal API rejects a wrong secret');
r = await rel('/relay/login', { username: '@tgalice', key: keyU.toLowerCase(), hwid: H1, ip: '1.1.1.1' });
ok(r.j.ok && r.j.user.name === 'TgAlice' && r.j.user.id === U, 'login: username (any case, with @) + key');
ok(typeof r.j.user.tag === 'string' && r.j.user.until > Date.now(), 'login returns tag + subscription');
r = await rel('/relay/login', { username: 'TgAlice', key: keyU, hwid: H2, ip: '1.1.1.1' });
ok(!r.j.ok && r.j.error === 'hwid_mismatch', 'second PC is refused (HWID bound)');
r = await rel('/relay/login', { username: 'TgAlice', key: 'HIDER-AAAA-BBBB-CCCC', hwid: H1, ip: '2.2.2.2' });
ok(!r.j.ok && r.j.error === 'invalid_credentials', 'wrong key refused');
r = await rel('/relay/login', { username: 'TgBob', key: keyU, hwid: H1, ip: '2.2.2.3' });
ok(!r.j.ok && r.j.error === 'invalid_credentials', "another user's key does not work for me");
r = await rel('/relay/login', { username: 'nobody', key: keyU, hwid: H1, ip: '2.2.2.4' });
ok(!r.j.ok && r.j.error === 'invalid_credentials', 'unknown user -> same generic error');
for (let i = 0; i < 9; i++) r = await rel('/relay/login', { username: 'TgBob', key: 'HIDER-ZZZZ-ZZZZ-ZZZZ', hwid: H1, ip: `9.9.9.${i}` });
ok(!r.j.ok && r.j.error === 'too_many_attempts', 'brute force on one account gets locked');
// legacy-format key owned by the user
db.prepare("INSERT OR REPLACE INTO keys(code, days, created_at, used_by, used_at, norm, legacy) VALUES('ABCD-1X-2345-6789', 30, 1, ?, 2, 'ABCD1X23456789', 1)").run(W);
db.prepare('UPDATE users SET sub_until=? WHERE id=?').run(Date.now() + 86400000, W);
r = await rel('/relay/login', { username: 'TgNoSub', key: 'abcd1x23456789', hwid: H1, ip: '3.3.3.3' });
ok(r.j.ok && r.j.user.id === W, 'legacy imported key (different format) logs in');
db.prepare("UPDATE keys SET blocked=1 WHERE code='ABCD-1X-2345-6789'").run();
r = await rel('/relay/login', { username: 'TgNoSub', key: 'ABCD-1X-2345-6789', hwid: H1, ip: '3.3.3.4' });
ok(!r.j.ok, 'blocked legacy key refused');
r = await rel('/relay/check', { id: U, tv: 0, hwid: H1 });
ok(r.j.ok, 'session check ok');
await call(U, 'POST', '/app/revoke', {}, 'TgAlice');
r = await rel('/relay/check', { id: U, tv: 0, hwid: H1 });
ok(!r.j.ok && r.j.error === 'revoked', 'Mini App "disconnect" revokes live sessions');
db.prepare('UPDATE users SET sub_until=? WHERE id=?').run(Date.now() - 1000, U);
r = await rel('/relay/check', { id: U, tv: 1, hwid: H1 });
ok(!r.j.ok && r.j.error === 'expired', 'expired subscription refused');

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
