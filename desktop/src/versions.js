'use strict';
// Extra Minecraft versions.
//
// The bundled minecraft-data (3.119.0) contains protocol definitions only up to 26.1.
// Mojang's 26.2 release keeps the 26.1 packet layouts but renumbers (and slightly
// extends) the packet IDs. src/protocol-patches.json holds the official ID maps produced
// from the 26.2 server jar with `net.minecraft.data.Main --reports`.
//
// Requiring this file registers 26.2 in minecraft-data's in-memory data table.
// It has to be loaded BEFORE anything calls minecraftData('26.2').
//
// 26.3 is intentionally NOT supported: its configuration-phase packet layout diverged
// from 26.1 in ways that cannot be expressed by an ID remap, and the bundled
// minecraft-data / minecraft-protocol ships no 26.3 definitions.
const minecraftData = require('minecraft-data');
const data = require('minecraft-data/data.js');
// Protocol ID maps for Mojang releases newer than the bundled minecraft-data (e.g. 26.2).
// These are NOT shipped with the app anymore: the relay delivers them inside the encrypted
// `hello` (see installPatches). Without the server the extra versions simply do not exist,
// so a cracked/offline copy cannot speak 26.2 at all.
let PATCHES = Object.create(null);
let installedVersions = [];


// ---------------------------------------------------------------------------------------
// minecraft-protocol bug workaround ("Packet ...set_equipment was larger than I expected").
//
// The stock `topBitSetTerminatedArray` reader (used by entity_equipment / set_equipment) clears
// the 0x80 "more entries follow" bit INSIDE the receive buffer and never puts it back. Hider
// forwards the raw upstream buffers to the real Minecraft client byte-for-byte, so every
// equipment packet with 2+ entries reached the client with a broken first slot byte: the client
// stopped after one entry and complained about the leftover bytes. This reader restores the
// original byte right after the element has been parsed, so raw forwarding stays lossless.
// It has to be installed before the first protocol is compiled (i.e. before any Session).
(function patchTopBitSetTerminatedArray() {
  try {
    const compilerMc = require('minecraft-protocol/src/datatypes/compiler-minecraft');
    if (compilerMc && compilerMc.Read && compilerMc.Read.topBitSetTerminatedArray) {
      compilerMc.Read.topBitSetTerminatedArray = ['parametrizable', (compiler, { type }) => {
        let code = 'let cursor = offset\n';
        code += 'const data = []\n';
        code += 'while (true) {\n';
        code += '  const start = cursor\n';
        code += '  const item = ctx.u8(buffer, cursor).value\n';
        code += '  buffer[start] = item & 127\n';
        code += '  let elem\n';
        code += '  try { elem = ' + compiler.callType(type, 'cursor') + ' } finally { buffer[start] = item }\n';
        code += '  data.push(elem.value)\n';
        code += '  cursor += elem.size\n';
        code += '  if ((item & 128) === 0) return { value: data, size: cursor - offset }\n';
        code += '}';
        return compiler.wrapCode(code);
      }];
    }
    // interpreted (non-compiled) variant, kept consistent
    const interp = require('minecraft-protocol/src/datatypes/minecraft');
    if (interp && interp.topBitSetTerminatedArray) {
      const { PartialReadError } = require('protodef').utils;
      interp.topBitSetTerminatedArray[0] = function readTopBitSetTerminatedArray(buffer, offset, { type }) {
        let cursor = offset;
        const values = [];
        for (;;) {
          if (cursor + 1 > buffer.length) throw new PartialReadError();
          const item = buffer.readUInt8(cursor);
          buffer[cursor] = item & 127;
          let res;
          try { res = this.read(buffer, cursor, type, {}); } finally { buffer[cursor] = item; }
          values.push(res.value);
          cursor += res.size;
          if ((item & 128) === 0) return { value: values, size: cursor - offset };
        }
      };
    }
  } catch (e) {
    console.error('[hider] topBitSetTerminatedArray patch failed:', e && e.message);
  }
})();

const BASE = '26.1';
const BASE_PROTOCOL = require('minecraft-data/minecraft-data/data/pc/26.1/protocol.json');

// Some people still write the calendar versions with the old "1." prefix.
const ALIASES = { '1.26.1': '26.1', '1.26.2': '26.2' };

function normalize(v) {
  const s = String(v || '').trim();
  return ALIASES[s] || s;
}

const built = Object.create(null);

function buildProtocol(version) {
  if (built[version]) return built[version];
  const patch = PATCHES[version];
  const p = JSON.parse(JSON.stringify(BASE_PROTOCOL));
  for (const [key, part] of Object.entries(patch.states)) {
    const [state, dir] = key.split('/');
    const stateDir = p[state][dir];
    if (!stateDir) continue;
    const packet = stateDir.types.packet;
    const mapper = packet[1][0].type[1];
    const fields = packet[1][1].type[1].fields;
    mapper.mappings = Object.assign({}, part.mappings);
    // Brand-new packets are parsed as header-only so an unknown ID never desyncs the stream.
    for (const name of part.extraNames) if (!fields[name]) fields[name] = 'void';
  }
  built[version] = p;
  return p;
}

// Install protocol patches delivered by the relay (sealed `hello.protoPatches`).
// Idempotent and safe to call again on every reconnect. Returns true once the
// extra versions are registered in minecraft-data's in-memory table.
function installPatches(patches) {
  if (!patches || typeof patches !== 'object') return false;
  const base = data.pc && data.pc[BASE];
  if (!base) return false; // incompatible minecraft-data layout
  PATCHES = patches;
  const out = [];
  for (const [version, patch] of Object.entries(patches)) {
    out.push(version);
    delete built[version];
    if (data.pc[version]) continue; // a future minecraft-data ships it natively
    const entry = Object.create(base);
    Object.defineProperty(entry, 'protocol', { enumerable: true, configurable: true, get: () => buildProtocol(version) });
    Object.defineProperty(entry, 'version', {
      enumerable: true,
      configurable: true,
      get: () => ({
        version: patch.protocolVersion,
        minecraftVersion: version,
        majorVersion: version,
        releaseType: 'release'
      })
    });
    data.pc[version] = entry;
  }
  installedVersions = out;
  return true;
}

module.exports = {
  normalize,
  installPatches,
  get installed() { return installedVersions.length > 0; },
  get extraVersions() { return installedVersions.slice(); },
  // returns true when a version can be used by minecraft-protocol
  isSupported(v) {
    const s = normalize(v);
    return !!minecraftData(s);
  }
};
