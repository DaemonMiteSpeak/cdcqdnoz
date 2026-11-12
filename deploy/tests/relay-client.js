// Protocol-level client for the Hider relay: secure handshake + username/key login + presence.
// usage: node relay-client.js <host> <port> <pem> <identityPub> <username> <key> [hwid] [nick]
const fs = require('fs');
const path = require('path');
const WebSocket = require(process.env.WS_PATH || 'ws');
const sec = require(process.env.SECURE_PATH || path.join(__dirname, '../../desktop/src/secure.js'));
const [host, port, pem, pub, username, key, hwid = 'c'.repeat(64), nick = 'E2ETester'] = process.argv.slice(2);

const ws = new WebSocket(`wss://${host}:${port}/ws`, { ca: fs.readFileSync(pem), handshakeTimeout: 10000, perMessageDeflate: false });
const hs = sec.clientHello(pub);
let hk = null;
const out = [];
const send = (o) => ws.send(sec.seal(hk.tx, Object.assign({}, o, { _p: 'x' })));
const done = (code) => { console.log(JSON.stringify(out)); try { ws.terminate(); } catch {} process.exit(code); };
setTimeout(() => { out.push({ timeout: true }); done(2); }, Number(process.env.WAIT_MS || 9000));
ws.on('open', () => ws.send(JSON.stringify(hs.hello)));
ws.on('error', (e) => { out.push({ error: e.message }); done(3); });
ws.on('message', (data, bin) => {
  if (bin) return;
  if (!hk) {
    try { hk = hs.finish(JSON.parse(data.toString())); } catch (e) { out.push({ error: 'server identity check failed' }); return done(4); }
    out.push({ handshake: 'ok' });
    return send({ t: 'auth', mode: 'login', username, key, hwid });
  }
  const m = sec.open(hk.rx, data.toString());
  if (m.t === 'hello') {
    out.push({ t: 'hello', name: m.name, id: m.id, firstName: m.firstName, tag: m.tag, tagColor: m.tagColor, avatar: m.avatar, until: m.until, hasEngineKey: !!m.engineKey, versions: (m.versions || []).length, cosmetics: !!m.cosmetics });
    send({ t: 'ident', nick, server: 'e2e.test' });
    send({ t: 'prefs', visible: true });
    if (process.env.WAIT_PRESENCE === '1') return;
    return done(0);
  }
  if (m.t === 'authfail') { out.push({ t: 'authfail', reason: m.reason }); return done(1); }
  if (m.t === 'presence') {
    out.push({ t: 'presence', online: m.online, users: (m.users || []).map((u) => ({ name: u.name, tag: u.tag, nick: u.nick, avatar: !!u.avatar })) });
    if (process.env.WAIT_PRESENCE === '1' && (m.users || []).length >= Number(process.env.EXPECT_USERS || 2)) return done(0);
  }
});
