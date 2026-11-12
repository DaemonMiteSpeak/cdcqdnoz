import fs from 'node:fs';
import https from 'node:https';
import { config } from './config.js';

if (config.dev && process.env.DEV_NOW) {
  const off = new Date(process.env.DEV_NOW).getTime() - Date.now();
  const real = Date.now;
  Date.now = () => real() + off;
}
import { createBot, setupMenu } from './bot.js';
import { createServer, createInternalServer } from './server.js';
import { startPayments } from './payments.js';

const bot = createBot();
const app = createServer(bot);
// Tunnel mode: Cloudflare terminates HTTPS and reaches us over loopback HTTP, so no local TLS and no public bind.
// BIND_LOCAL=1: same, but an external reverse proxy (nginx over a reverse SSH tunnel) fronts the app.
const tunnel = process.env.TUNNEL === '1';
const local = tunnel || process.env.BIND_LOCAL === '1';
const bindHost = local ? '127.0.0.1' : '0.0.0.0';
const tls = !local && config.tlsKey && config.tlsCert
  ? { key: fs.readFileSync(config.tlsKey), cert: fs.readFileSync(config.tlsCert) }
  : null;
if (tls) {
  const srv = https.createServer(tls, app);
  await new Promise((ok) => srv.listen(config.port, bindHost, ok));
  // Let's Encrypt renewals are picked up without a restart
  setInterval(() => {
    try { srv.setSecureContext({ key: fs.readFileSync(config.tlsKey), cert: fs.readFileSync(config.tlsCert) }); } catch { /* keep old */ }
  }, 12 * 3600 * 1000).unref();
} else {
  await new Promise((ok) => app.listen(config.port, bindHost, ok));
}
console.log(`web on :${config.port}${tls ? ' (https)' : ''}${config.dev ? ' (DEV)' : ''}`);

if (config.internalPort && config.relaySecret) {
  await new Promise((ok) => createInternalServer().listen(config.internalPort, '127.0.0.1', ok));
  console.log(`internal api on 127.0.0.1:${config.internalPort}`);
}
startPayments();

// A fresh quick tunnel needs a few minutes before it is routable. Until then the Mini App URL stays unset
// (no dead button in /start, menu button untouched); once the URL answers, it is published and the menu is updated.
let tunnelUrl = '';
if (tunnel) {
  const { startTunnel } = await import('./tunnel.js');
  tunnelUrl = await startTunnel(config.port);
  config.webappUrl = '';
  console.log(`tunnel url ${tunnelUrl} (waiting until it is reachable)`);
}
async function publishTunnel() {
  const t0 = Date.now();
  while (Date.now() - t0 < 15 * 60000) {
    try {
      const r = await fetch(`${tunnelUrl}/`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        config.webappUrl = tunnelUrl;
        console.log(`public url ${tunnelUrl} (reachable after ${Math.round((Date.now() - t0) / 1000)}s)`);
        if (bot && process.env.BOT_POLLING !== '0') await setupMenu(bot).catch((e) => console.error('setupMenu', e.message));
        return;
      }
    } catch { /* not routable yet */ }
    await new Promise((ok) => setTimeout(ok, 5000));
  }
  console.error('tunnel never became reachable');
  process.exit(1);
}
if (tunnel) publishTunnel();

if (bot && process.env.BOT_POLLING === '0') {
  console.warn('BOT_POLLING=0: web only (no Telegram polling, menu untouched)');
} else if (bot) {
  bot.start({ onStart: (me) => console.log(`bot @${me.username} started`) });
  if (!tunnel) setupMenu(bot).catch((e) => console.error('setupMenu', e.message));
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => bot.stop());
} else {
  console.warn('BOT_TOKEN is not set — Telegram bot is NOT running (web only)');
}
