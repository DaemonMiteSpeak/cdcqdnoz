'use strict';
// Hider secure channel: X25519 ECDH + Ed25519 server authentication + AES-256-GCM.
// Dependency-free (Node built-in crypto). Shared by client (src/) and server/.
// Keys passed in/out as base64url strings. After the handshake every control
// message is an opaque AES-256-GCM blob (random 12-byte nonce each time), so the
// wire carries no readable field names at all.
const crypto = require('crypto');

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64 = (s) => Buffer.from(String(s), 'base64url');

const X_SPKI = Buffer.from('302a300506032b656e032100', 'hex');
const ED_SPKI = Buffer.from('302a300506032b6570032100', 'hex');
const ED_PK8 = Buffer.from('302e020100300506032b657004220420', 'hex');

function genEph() {
  const kp = crypto.generateKeyPairSync('x25519');
  const pubRaw = kp.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  return { priv: kp.privateKey, pubRaw };
}
function xPub(raw) { return crypto.createPublicKey({ key: Buffer.concat([X_SPKI, raw]), format: 'der', type: 'spki' }); }
function ecdh(priv, peerRaw) { return crypto.diffieHellman({ privateKey: priv, publicKey: xPub(peerRaw) }); }
function edPubRaw(publicKey) { return publicKey.export({ type: 'spki', format: 'der' }).subarray(-32); }
function edPub(raw) { return crypto.createPublicKey({ key: Buffer.concat([ED_SPKI, raw]), format: 'der', type: 'spki' }); }
function edPriv(raw) { return crypto.createPrivateKey({ key: Buffer.concat([ED_PK8, raw]), format: 'der', type: 'pkcs8' }); }

function genIdentity() {
  const kp = crypto.generateKeyPairSync('ed25519');
  const privRaw = kp.privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(-32);
  return { pubRaw: edPubRaw(kp.publicKey), privRaw };
}
function hkdf(secret, salt, info) { return Buffer.from(crypto.hkdfSync('sha256', secret, salt, Buffer.from(info, 'utf8'), 32)); }

function seal(key, obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(obj), 'utf8')), c.final()]);
  return b64u(Buffer.concat([iv, c.getAuthTag(), ct]));
}
function open(key, s) {
  const buf = unb64(s);
  const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
}

// client initiator -> { hello, finish(reply) -> { tx, rx } }
function clientHello(serverPubRaw) {
  const eph = genEph();
  const nonce = crypto.randomBytes(16);
  const hello = { v: 1, epk: b64u(eph.pubRaw), n: b64u(nonce) };
  function finish(reply) {
    const sEpk = unb64(reply.epk);
    const transcript = Buffer.concat([eph.pubRaw, nonce, sEpk]);
    if (!crypto.verify(null, transcript, edPub(unb64(serverPubRaw)), unb64(reply.sig))) throw new Error('server-auth');
    const shared = ecdh(eph.priv, sEpk);
    const salt = Buffer.concat([eph.pubRaw, sEpk]);
    return { tx: hkdf(shared, salt, 'hider c2s v1'), rx: hkdf(shared, salt, 'hider s2c v1') };
  }
  return { hello, finish };
}
// server responder -> { reply, tx, rx }
function serverAccept(identityPrivRaw, hello) {
  const cEpk = unb64(hello.epk);
  const eph = genEph();
  const transcript = Buffer.concat([cEpk, unb64(hello.n), eph.pubRaw]);
  const sig = crypto.sign(null, transcript, edPriv(unb64(identityPrivRaw)));
  const shared = ecdh(eph.priv, cEpk);
  const salt = Buffer.concat([cEpk, eph.pubRaw]);
  return { reply: { v: 1, epk: b64u(eph.pubRaw), sig: b64u(sig) }, tx: hkdf(shared, salt, 'hider s2c v1'), rx: hkdf(shared, salt, 'hider c2s v1') };
}
module.exports = { b64u, unb64, genIdentity, seal, open, clientHello, serverAccept };
