import fs from 'node:fs';
import { spawn } from 'node:child_process';

const BIN = process.env.CLOUDFLARED_BIN || '/tmp/cloudflared';
const URL_URL = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64';

async function ensureBinary() {
  if (fs.existsSync(BIN)) return;
  const r = await fetch(URL_URL, { redirect: 'follow' });
  if (!r.ok) throw new Error(`cloudflared download failed: ${r.status}`);
  fs.writeFileSync(BIN, Buffer.from(await r.arrayBuffer()), { mode: 0o755 });
}

/** Opens a Cloudflare quick tunnel to the local port and resolves with its public https URL. */
export async function startTunnel(port) {
  await ensureBinary();
  return new Promise((resolve, reject) => {
    const p = spawn(BIN, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => reject(new Error('tunnel timeout')), 40000);
    const onData = (d) => {
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(d));
      if (m) { clearTimeout(timer); resolve(m[0]); }
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('exit', (c) => { console.error('tunnel exited', c); process.exit(1); });
    for (const s of ['SIGINT', 'SIGTERM']) process.once(s, () => p.kill());
    process.on('exit', () => p.kill());
  });
}
