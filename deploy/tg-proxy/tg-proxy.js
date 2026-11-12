'use strict';
// Local Telegram Bot API forwarder. The Jino host cannot reach api.telegram.org directly, so TLS to
// Telegram is tunnelled through a forward-only SSH account (permitopen api.telegram.org:443).
// The bot talks plain HTTP to 127.0.0.1 (TG_API_ROOT); TLS to Telegram is terminated here.
const http = require('http');
const https = require('https');
const tls = require('tls');
const fs = require('fs');
const { Client } = require('ssh2');

const HOST = process.env.TG_SSH_HOST;
const USER = process.env.TG_SSH_USER || 'hider-tg';
const KEY = fs.readFileSync(process.env.TG_SSH_KEY);
const PORT = Number(process.env.TG_PROXY_PORT || 8081);
let conn = null;
let ready = false;

function connect() {
  const c = new Client();
  conn = c;
  c.on('ready', () => { ready = true; console.log('ssh tunnel up'); })
    .on('error', (e) => console.error('ssh error', e.message))
    .on('close', () => { ready = false; if (conn === c) setTimeout(connect, 3000); })
    .connect({ host: HOST, username: USER, privateKey: KEY, keepaliveInterval: 15000, keepaliveCountMax: 3, readyTimeout: 15000 });
}
connect();

const agent = new https.Agent({ keepAlive: true, maxSockets: 32 });
agent.createConnection = (opts, cb) => {
  if (!ready) return cb(new Error('tunnel down'));
  conn.forwardOut('127.0.0.1', 0, 'api.telegram.org', 443, (err, stream) => {
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
