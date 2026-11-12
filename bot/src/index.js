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
const tls = config.tlsKey && config.tlsCert
  ? { key: fs.readFileSync(config.tlsKey), cert: fs.readFileSync(config.tlsCert) }
  : null;
if (tls) {
  const srv = https.createServer(tls, app);
  await new Promise((ok) => srv.listen(config.port, '0.0.0.0', ok));
  // Let's Encrypt renewals are picked up without a restart
  setInterval(() => {
    try { srv.setSecureContext({ key: fs.readFileSync(config.tlsKey), cert: fs.readFileSync(config.tlsCert) }); } catch { /* keep old */ }
  }, 12 * 3600 * 1000).unref();
} else {
  await new Promise((ok) => app.listen(config.port, '0.0.0.0', ok));
}
console.log(`web on :${config.port}${tls ? ' (https)' : ''}${config.dev ? ' (DEV)' : ''}`);

if (config.internalPort && config.relaySecret) {
  await new Promise((ok) => createInternalServer().listen(config.internalPort, '127.0.0.1', ok));
  console.log(`internal api on 127.0.0.1:${config.internalPort}`);
}
startPayments();

if (process.env.TUNNEL === '1') {
  const { startTunnel } = await import('./tunnel.js');
  config.webappUrl = await startTunnel(config.port);
  console.log(`public url ${config.webappUrl}`);
}

if (bot) {
  bot.start({ onStart: (me) => console.log(`bot @${me.username} started`) });
  setupMenu(bot).catch((e) => console.error('setupMenu', e.message));
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => bot.stop());
} else {
  console.warn('BOT_TOKEN is not set — Telegram bot is NOT running (web only)');
}
