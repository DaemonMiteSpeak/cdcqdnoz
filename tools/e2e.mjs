// End-to-end API check against a DEV server. Run: DB=/tmp/e2e.db PORT=3112 (server started with the same env)
// node tools/e2e.mjs
process.env.DB_FILE = process.env.DB_FILE || '/tmp/e2e.db';
process.env.DEV = '1';
const BASE = process.env.BASE || 'http://localhost:3112';
const S = await import('../src/service.js');
let fail = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++; };
const call = async (uid, method, url, body) => {
  const r = await fetch(`${BASE}/api${url}`, { method, headers: { 'Content-Type': 'application/json', 'x-dev-user': String(uid), 'x-dev-username': `U${uid}` }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, j: await r.json().catch(() => ({})) };
};
const A = 777001, B = 777002;

await call(A, 'GET', '/state');
await call(B, 'GET', '/state');
let r = await call(A, 'GET', '/launch');
ok(r.s === 403 && r.j.error === 'gate', 'gate blocks API before subscription');
r = await call(A, 'POST', '/gate/check');
ok(r.s === 409, 'gate check without bot -> not subscribed (dev)');
await call(A, 'POST', '/dev/seed', { gate_ok: 1 });
await call(B, 'POST', '/dev/seed', { gate_ok: 1 });

r = await call(A, 'GET', '/state');
ok(r.j.sub.active === false && r.j.hwid.resets === 2, 'new user: no sub, 2 resets');

// promo: B creates a code (no media status needed)
r = await call(B, 'POST', '/media/promo', { code: 'Bcode2026' });
ok(r.s === 200 && r.j.media.promo.code === 'Bcode2026', 'promo created');
r = await call(A, 'POST', '/media/promo', { code: 'bcode2026' });
ok(r.s === 409 && r.j.error === 'promo_taken' && r.j.suggest.length > 0, 'promo taken -> suggestions');
r = await call(A, 'POST', '/media/promo', { code: 'a!' });
ok(r.s === 400, 'promo invalid');

// quote / order with promo
r = await call(A, 'POST', '/quote', { kind: 'sub', item: 30, promo: 'BCODE2026' });
ok(r.j.total === 269 && r.j.discount === 30, 'quote sub 30d with promo = 269');
r = await call(A, 'POST', '/quote', { kind: 'tag', item: 'tilt', promo: 'BCODE2026' });
ok(r.j.total === 26, 'quote tag with promo = 26');
r = await call(A, 'POST', '/quote', { kind: 'sub', item: 30, promo: 'nope' });
ok(r.s === 404, 'unknown promo -> 404');
r = await call(A, 'POST', '/orders', { kind: 'sub', item: 30, method: 'sbp' });
ok(r.s === 200 && r.j.status === 'pending', 'order created (sbp)');
const oid = r.j.id;
const withPromo = await call(A, 'POST', '/orders', { kind: 'sub', item: 30, promo: 'Bcode2026', method: 'sbp' });
S.settleOrder(withPromo.j.id, { by: 'test' });
S.settleOrder(withPromo.j.id, { by: 'test' });
r = await call(A, 'GET', '/state');
ok(r.j.sub.active && r.j.sub.daysLeft === 30, 'settle activates 30 days (idempotent)');
r = await call(B, 'GET', '/state');
ok(r.j.media.balanceK === 3228 && r.j.media.promo.activations === 1, 'author gets 12% (32.28 RUB = 3228 kop) once');
r = await call(A, 'POST', `/orders/${oid}/cancel`);
ok(r.j.status === 'cancelled', 'cancel pending order');
r = await call(A, 'POST', '/orders', { kind: 'hwid', item: 3, method: 'cryptobot' });
ok(r.s === 503, 'unconfigured method rejected');

// tags
r = await call(A, 'POST', '/tags/select', { tag: 'gg' });
ok(r.s === 403, 'cannot select unowned tag');
const t = await call(A, 'POST', '/orders', { kind: 'tag', item: 'tilt', method: 'sbp' });
S.settleOrder(t.j.id, { by: 'test' });
r = await call(A, 'POST', '/tags/select', { tag: 'tilt' });
ok(r.s === 200 && r.j.user.tag === 'tilt', 'buy + install tag');

// hwid reset + cooldown
r = await call(A, 'POST', '/hwid/reset');
ok(r.s === 200 && r.j.hwid.resets === 1, 'hwid reset (2 -> 1)');
r = await call(A, 'POST', '/hwid/reset');
ok(r.s === 429 && r.j.error === 'too_often', 'hwid reset cooldown 24h');
const h = await call(A, 'POST', '/orders', { kind: 'hwid', item: 3, method: 'sbp' });
S.settleOrder(h.j.id);
r = await call(A, 'GET', '/state');
ok(r.j.hwid.resets === 4, 'hwid pack adds 3');

// launch command lifecycle
r = await call(A, 'POST', '/launch');
ok(/^powershell -c "irm .+\/r\/[0-9A-F]{6} \|iex"$/.test(r.j.launch.command), 'launch command format');
const token = r.j.launch.command.match(/\/r\/([0-9A-F]{6})/)[1];
let g = await fetch(`${BASE}/r/${token}?hwid=0DA3-A2D8`, { redirect: 'manual' });
ok(g.status === 503, 'launch endpoint consumes token (payload url not configured -> 503)');
g = await fetch(`${BASE}/r/${token}`, { redirect: 'manual' });
ok(g.status === 410, 'launch token is single-use');
r = await call(A, 'GET', '/state');
ok(r.j.stats.launches === 1 && r.j.hwid.value === '0DA3-A2D8', 'launch counted + hwid bound');
r = await call(A, 'GET', '/launch');
ok(r.j.launch.expired === true, 'used command reported as expired');

// media + withdrawals
r = await call(B, 'POST', '/withdrawals', { method: 'card', details: '2202206144174417', amount: 500 });
ok(r.s === 403, 'withdrawal needs media status');
await call(B, 'POST', '/dev/seed', { media_status: 1, balance_k: 128400 });
r = await call(B, 'POST', '/withdrawals', { method: 'card', details: '2202206144174417', amount: 320 });
ok(r.s === 400 && r.j.error === 'below_min', 'below 500 rejected');
r = await call(B, 'POST', '/withdrawals', { method: 'card', details: '2202206144174417', amount: 2000 });
ok(r.s === 400 && r.j.error === 'over_balance', 'over balance rejected');
r = await call(B, 'POST', '/withdrawals', { method: 'card', details: '1234', amount: 600 });
ok(r.j.error === 'bad_details', 'bad card rejected');
r = await call(B, 'POST', '/withdrawals', { method: 'card', details: '2202 2061 4417 4417', amount: 1000 });
ok(r.s === 200, 'withdrawal accepted');
r = await call(B, 'GET', '/state');
ok(r.j.media.balanceK === 28400, 'balance debited');
S.reviewWithdrawal(r.j && (await call(B, 'GET', '/withdrawals')).j.items[0].id, { approve: false, note: 'неверная карта' });
r = await call(B, 'GET', '/state');
ok(r.j.media.balanceK === 128400, 'rejected withdrawal refunds balance');
r = await call(B, 'POST', '/media/lookup', { url: 'https://example.com/x' });
ok(r.s === 400 && r.j.error === 'bad_url', 'video lookup rejects non-tiktok/youtube url');

// info on video payout math
ok(S.videoPayoutK({ platform: 'tiktok' }, 12480) === 30000 && S.videoPayoutK({ platform: 'tiktok' }, 999) === 0 && S.videoPayoutK({ platform: 'youtube', long: true }, 4120) === 267800, 'payout tiers (300 RUB @12480, 2678 RUB @4120 yt)');

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
