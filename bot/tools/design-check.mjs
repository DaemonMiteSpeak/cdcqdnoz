// Pixel-compares rendered screens with Doop frame PNGs. Usage: node tools/design-check.mjs [caseId...]
import { chromium } from '/tmp/pw/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE || 'http://localhost:3111';
const NOW = new Date('2026-11-09T18:34:00+03:00');
const T = (s) => new Date(s).getTime();
const base = {
  gate_ok: 1, created_at: T('2026-11-05T12:00:00+03:00'), sub_until: T('2027-01-05T00:00:00+03:00'), sub_total_days: 61,
  hwid: '0DA3-A2D8', hwid_resets: 2, last_reset_at: 0, launches: 9, last_launch_at: T('2026-11-09T18:32:00+03:00'),
  tag: 'wtf', tags: JSON.stringify(['imba', 'gg']), media_status: 1, balance_k: 128400, earned_k: 481200, withdrawn_k: 352800,
  photo_url: '/img/dev-avatar.png',
};
const cases = JSON.parse(fs.readFileSync(new URL('./cases.json', import.meta.url)));
const want = process.argv.slice(2);
const browser = await chromium.launch();
let uid = 9000 + Math.floor(Math.random() * 90000);
for (const c of cases) {
  if (want.length && !want.includes(c.id)) continue;
  uid++;
  const ctx = await browser.newContext({ viewport: { width: c.w, height: 900 }, deviceScaleFactor: 1, timezoneId: 'Europe/Moscow', locale: 'ru-RU' });
  const page = await ctx.newPage();
  await page.clock.install({ time: NOW });
  const hdr = { 'x-dev-user': String(uid), 'x-dev-username': 'YukeeDesign', 'Content-Type': 'application/json' };
  await page.request.get(`${BASE}/api/state`, { headers: hdr });
  const seed = { ...base, ...(c.seed || {}) };
  if (seed.tags && typeof seed.tags !== 'string') seed.tags = JSON.stringify(seed.tags);
  await page.request.post(`${BASE}/api/dev/seed`, { headers: hdr, data: seed });
  await page.goto(`${BASE}/?dev=${uid}${c.q || ''}#${c.route}`);
  await page.waitForSelector('#root > *', { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  for (const a of c.actions || []) { await page.click(a); await page.waitForTimeout(500); }
  const out = `/tmp/shots/${c.id}.png`;
  fs.mkdirSync('/tmp/shots', { recursive: true });
  const hh = await page.evaluate(() => Math.ceil(document.querySelector('#root > *').getBoundingClientRect().height));
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: c.w, height: Math.min(hh, 3000) }, fullPage: true });
  await ctx.close();
  const r = execFileSync('python3', ['tools/cmp.py', out, `design/png1/${c.frame}.png`, `/tmp/shots/${c.id}.diff.png`]).toString().trim();
  console.log(`${c.id.padEnd(22)} ${r}`);
}
await browser.close();
