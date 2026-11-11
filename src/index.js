import { config } from './config.js';

if (config.dev && process.env.DEV_NOW) {
  const off = new Date(process.env.DEV_NOW).getTime() - Date.now();
  const real = Date.now;
  Date.now = () => real() + off;
}
import { createBot, setupMenu } from './bot.js';
import { createServer } from './server.js';
import { startPayments } from './payments.js';

const bot = createBot();
const app = createServer(bot);
await new Promise((ok) => app.listen(config.port, '0.0.0.0', ok));
console.log(`web on :${config.port}${config.dev ? ' (DEV)' : ''}`);
startPayments();

if (process.env.TUNNEL === '1') {
  const { startTunnel } = await import('./tunnel.js');
  config.webappUrl = await startTunnel(config.port);
  if (!config.launchBase) config.launchBase = config.webappUrl;
  console.log(`public url ${config.webappUrl}`);
}

if (bot) {
  bot.start({ onStart: (me) => console.log(`bot @${me.username} started`) });
  setupMenu(bot).catch((e) => console.error('setupMenu', e.message));
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => bot.stop());
} else {
  console.warn('BOT_TOKEN is not set — Telegram bot is NOT running (web only)');
}
