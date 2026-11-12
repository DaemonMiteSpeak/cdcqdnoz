import { chromium } from '/tmp/pw/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
const BASE = 'http://localhost:3000';
const hdr = { 'x-dev-user': '4242', 'x-dev-username': 'YukeeDesign', 'Content-Type': 'application/json' };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 360, height: 700 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.request.get(`${BASE}/api/state`, { headers: hdr });
await p.request.post(`${BASE}/api/dev/seed`, { headers: hdr, data: { gate_ok: 1, sub_until: Date.now() + 57 * 86400000, sub_total_days: 61, hwid: '0DA3-A2D8', launches: 9, last_launch_at: Date.now() - 600000, media_status: 1, balance_k: 128400, earned_k: 481200, tags: '["imba","gg"]', photo_url: '/img/dev-avatar.png', created_at: Date.now() - 4 * 86400000 } });
const routes = ['/', '/profile', '/tags', '/buy', '/media?slide=2', '/withdraw'];
const files = [];
for (const [i, r] of routes.entries()) {
  await p.goto(`${BASE}/?dev=4242#${r}`); await p.waitForTimeout(900);
  const h = await p.evaluate(() => Math.ceil(document.querySelector('#root > *').getBoundingClientRect().height));
  const f = `/tmp/flow/p${i}.png`; files.push(f);
  await p.screenshot({ path: f, clip: { x: 0, y: 0, width: 360, height: Math.min(h, 700) } });
}
await b.close();
execFileSync('python3', ['tools/sheet.py', '/tmp/flow/preview-sheet.png', ...files]);
