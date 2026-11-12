// verifyInitData must accept a correctly signed Telegram payload and reject tampering.
process.env.BOT_TOKEN = '123456:TEST_TOKEN_FOR_SIGNATURE_CHECK';
process.env.DB_FILE = '/tmp/initdata.db';
import crypto from 'node:crypto';
const { verifyInitData } = await import('../src/server.js');
const user = JSON.stringify({ id: 4242, first_name: 'Yuki', username: 'yukee' });
const params = { auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAH', user };
const str = Object.entries(params).map(([k, v]) => `${k}=${v}`).sort().join('\n');
const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
const hash = crypto.createHmac('sha256', secret).update(str).digest('hex');
const good = new URLSearchParams({ ...params, hash }).toString();
const bad = new URLSearchParams({ ...params, user: user.replace('4242', '1'), hash }).toString();
const old = new URLSearchParams({ ...params, auth_date: '1000', hash }).toString();
const r = [verifyInitData(good)?.id === 4242, verifyInitData(bad) === null, verifyInitData(old) === null];
console.log(r.every(Boolean) ? 'initData: PASS (accept valid, reject tampered/expired)' : `initData: FAIL ${r}`);
process.exit(r.every(Boolean) ? 0 : 1);
