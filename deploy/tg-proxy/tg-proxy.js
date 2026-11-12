'use strict';
// Local Telegram Bot API forwarder + reverse tunnel for the Mini App.
//  * Jino cannot reach api.telegram.org directly, so TLS to Telegram is tunnelled through a forward-only SSH
//    account (permitopen api.telegram.org:443). The bot talks plain HTTP to 127.0.0.1 (TG_API_ROOT).
//  * The same SSH connection publishes the bot's local web port on the old VPS (127.0.0.1:REMOTE_PORT, permitlisten),
//    where nginx terminates HTTPS for the Mini App. Jino initiates the connection, so no inbound access to Jino is needed.
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const dns = require('dns');
const { Client } = require('ssh2');

const HOST = process.env.TG_SSH_HOST;
const USER = process.env.TG_SSH_USER || 'hider-tg';
const KEY = fs.readFileSync(process.env.TG_SSH_KEY);
const PORT = Number(process.env.TG_PROXY_PORT || 8081);
const WEB_LOCAL = Number(process.env.WEB_LOCAL_PORT || 0);
const WEB_REMOTE = Number(process.env.WEB_REMOTE_PORT || 18002);
let conn = null;
let ready = false;
let retry = 3000;

function connect() {
  const c = new Client();
  conn = c;
  c.on('ready', () => {
    ready = true;
    console.log('ssh tunnel up');
    if (!WEB_LOCAL) return;
    c.forwardIn('127.0.0.1', WEB_REMOTE, (err) => {
      if (err) { console.error('reverse forward failed:', err.message); c.end(); return; }
      retry = 3000;
      console.log(`mini app published on ${HOST} 127.0.0.1:${WEB_REMOTE} -> 127.0.0.1:${WEB_LOCAL}`);
    });
  });
  c.on('tcp connection', (info, accept) => {
    const ch = accept();
    const s = net.connect(WEB_LOCAL, '127.0.0.1');
    // Never destroy the channel when the local socket closes: the last buffered bytes of a response would be cut off.
    // pipe() half-closes the channel gracefully (ch.end()) once everything is written.
    ch.pipe(s);
    s.pipe(ch);
    s.on('error', () => { try { ch.destroy(); } catch { /* ignore */ } });
    ch.on('error', () => { try { s.destroy(); } catch { /* ignore */ } });
    ch.on('close', () => { try { s.destroy(); } catch { /* ignore */ } });
  });
  c.on('error', (e) => console.error('ssh error', e.message))
    .on('close', () => { ready = false; if (conn === c) { setTimeout(connect, retry); retry = Math.min(retry * 2, 30000); } })
    .connect({ host: HOST, username: USER, privateKey: KEY, keepaliveInterval: 15000, keepaliveCountMax: 3, readyTimeout: 15000 });
}
connect();

// Dial an IPv4 literal: when the SSH host has no IPv6 route, a hostname makes sshd try the AAAA record first and stall ~2s per call.
const TG_HOST = 'api.telegram.org';
let tgIp = process.env.TG_IP || '149.154.167.220';
function refreshIp() { dns.resolve4(TG_HOST, (e, a) => { if (!e && a && a[0]) tgIp = a[0]; }); }
refreshIp();
setInterval(refreshIp, 600000).unref();

const agent = new https.Agent({ keepAlive: true, maxSockets: 32 });
agent.createConnection = (opts, cb) => {
  if (!ready) return cb(new Error('tunnel down'));
  conn.forwardOut('127.0.0.1', 0, tgIp, 443, (err, stream) => {
    if (err) return cb(err);
    const s = tls.connect({ socket: stream, servername: 'api.telegram.org' });
    s.once('secureConnect', () => cb(null, s));
    s.once('error', (e) => cb(e));
  });
};

http.createServer((req, res) => {
  if (!/^\/(file\/)?bot[0-9]+:/.test(req.url)) { res.writeHead(404); return res.end(); }
  if (!ready) { res.writeHead(503); return res.end('tunnel down'); }
  const headers = Object.assign({}, req.headers, { host: 'api.telegram.org' });
  delete headers.connection;
  const up = https.request({ host: 'api.telegram.org', servername: 'api.telegram.org', path: req.url, method: req.method, headers, agent }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.setTimeout(70000, () => up.destroy());
  up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(up);
}).listen(PORT, '127.0.0.1', () => console.log('tg proxy on 127.0.0.1:' + PORT));
