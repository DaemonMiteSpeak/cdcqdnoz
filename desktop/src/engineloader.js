'use strict';

// Loads the encrypted Hider engine (src/engine.bin) entirely in memory.
//
// The AES-256-GCM key is delivered by the relay in the sealed hello, and ONLY after the account
// and HWID pass. So the engine never touches disk in cleartext: a cracked/offline app has just an
// opaque blob and cannot construct the proxy Session at all.
//
// The decrypted modules run through a tiny in-memory CommonJS loader:
//  - local requires between engine modules resolve inside the bundle;
//  - a local require that is NOT part of the engine (e.g. ./versions) and every bare specifier
//    (minecraft-protocol, prismarine-nbt, fs ...) fall back to the real require from this file's
//    location (src/), so node_modules and deep sub-paths resolve exactly as before;
//  - __filename/__dirname are the real on-disk paths, so engine code that reads sibling data files
//    (e.g. cosmetics/catalog.json, cosmetics/data) keeps working even though the .js isn't on disk.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const posix = path.posix;

const BIN = path.join(__dirname, 'engine.bin');

function decrypt(key, buf) {
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

function loadEngine(keyHex) {
  const key = Buffer.from(String(keyHex || ''), 'hex');
  if (key.length !== 32) throw new Error('bad engine key');
  const bundle = JSON.parse(decrypt(key, fs.readFileSync(BIN)).toString('utf8'));
  const files = bundle.files || {};
  const cache = Object.create(null);

  function makeRequire(dir) {
    return function req(request) {
      request = String(request);
      if (request[0] === '.') {
        const logical = posix.normalize(posix.join(dir, request)).replace(/\.js$/i, '');
        if (Object.prototype.hasOwnProperty.call(files, logical)) return loadModule(logical);
        // relative file that is not part of the engine (e.g. ./versions): load the real module
        return require(path.resolve(__dirname, dir, request));
      }
      // bare specifier -> resolve from this loader (lives in src/, same as the engine sources)
      return require(request);
    };
  }

  function loadModule(logical) {
    if (cache[logical]) return cache[logical].exports;
    const code = files[logical];
    if (typeof code !== 'string') throw new Error('engine module missing: ' + logical);
    const mod = { exports: {} };
    cache[logical] = mod; // set before executing: safe for any circular requires
    const d = posix.dirname(logical);
    const dir = d === '.' ? '' : d;
    const filename = path.join(__dirname, logical + '.js');
    const fn = vm.compileFunction(code, ['exports', 'require', 'module', '__filename', '__dirname'], { filename });
    fn(mod.exports, makeRequire(dir), mod, filename, path.join(__dirname, dir));
    return mod.exports;
  }

  return loadModule(bundle.entry || 'mcsession');
}

module.exports = { loadEngine };
