'use strict';
// Minimal zip reader/writer (no dependencies). Reader: central directory, stored/deflate, no zip64 / encryption.
const zlib = require('zlib');

const CRC_T = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }

// -> Map<name, Buffer> (directories skipped). Throws on unsupported / corrupt archives.
function readZipEx(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file');
  let total = buf.readUInt16LE(eocd + 10), cdSize = buf.readUInt32LE(eocd + 12), cdOff = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) {
    // zip64: locator (20 bytes) right before the EOCD points at the zip64 end-of-central-directory record
    if (eocd < 20 || buf.readUInt32LE(eocd - 20) !== 0x07064b50) throw new Error('zip64 locator not found');
    const r = Number(buf.readBigUInt64LE(eocd - 20 + 8));
    if (!(r >= 0 && r + 56 <= buf.length) || buf.readUInt32LE(r) !== 0x06064b50) throw new Error('bad zip64 end record');
    total = Number(buf.readBigUInt64LE(r + 32)); cdSize = Number(buf.readBigUInt64LE(r + 40)); cdOff = Number(buf.readBigUInt64LE(r + 48));
  }
  const out = new Map(); let p = cdOff;
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    let csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    let lho = buf.readUInt32LE(p + 42);
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nl);
    if (usize === 0xffffffff || csize === 0xffffffff || lho === 0xffffffff) {
      // zip64 extra field (0x0001): only the saturated values are present, in the order usize, csize, lho
      let q = p + 46 + nl; const qe = q + el;
      while (q + 4 <= qe) {
        const id = buf.readUInt16LE(q), sz = buf.readUInt16LE(q + 2);
        if (id === 1) {
          let o = q + 4;
          if (usize === 0xffffffff) { usize = Number(buf.readBigUInt64LE(o)); o += 8; }
          if (csize === 0xffffffff) { csize = Number(buf.readBigUInt64LE(o)); o += 8; }
          if (lho === 0xffffffff) { lho = Number(buf.readBigUInt64LE(o)); o += 8; }
          break;
        }
        q += 4 + sz;
      }
    }
    p += 46 + nl + el + cl;
    if (flags & 1) throw new Error('encrypted zip entries are not supported');
    if (name.endsWith('/')) continue;
    if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error('bad local header');
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const raw = buf.subarray(start, start + csize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error('unsupported zip method ' + method);
    // the declared size is not trusted: real server packs exist whose central directory lies about it (the game ignores it, too)
    out.set(name.replace(/\\/g, '/'), { data, raw: method === 8 ? Buffer.from(raw) : null, method });
  }
  return out;
}

function readZip(buf) { const m = new Map(); for (const [k, v] of readZipEx(buf)) m.set(k, v.data); return m; }

// entries: [{ name, data:Buffer, raw?:Buffer (already deflated body of data), store?:bool, level?:number, time?:Date }] -> Buffer. Order is kept as given.
function writeZip(entries) {
  const parts = [], cd = []; let off = 0;
  for (const e of entries) {
    const nm = Buffer.from(e.name, 'utf8');
    const data = e.data;
    const comp = e.raw ? e.raw : e.store ? data : zlib.deflateRawSync(data, { level: e.level == null ? 6 : e.level });
    const method = e.store || comp.length >= data.length ? 0 : 8;
    const body = method === 0 ? data : comp;
    const t = e.time || new Date();
    const dt = ((Math.max(1980, t.getFullYear()) - 1980) << 9) | ((t.getMonth() + 1) << 5) | t.getDate();
    const tm = (t.getHours() << 11) | (t.getMinutes() << 5) | (t.getSeconds() >> 1);
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(tm, 10); lh.writeUInt16LE(dt, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nm.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, nm, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(tm, 12); ch.writeUInt16LE(dt, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    cd.push(ch, nm);
    off += 30 + nm.length + body.length;
  }
  const cdBuf = Buffer.concat(cd);
  if (off > 0xfffffff0) throw new Error('archive too large');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(off, 16);
  if (entries.length >= 0xffff) { // more than 65534 entries: zip64 end records
    end.writeUInt16LE(0xffff, 8); end.writeUInt16LE(0xffff, 10);
    const z = Buffer.alloc(56 + 20);
    z.writeUInt32LE(0x06064b50, 0); z.writeBigUInt64LE(44n, 4); z.writeUInt16LE(45, 12); z.writeUInt16LE(45, 14);
    z.writeBigUInt64LE(BigInt(entries.length), 24); z.writeBigUInt64LE(BigInt(entries.length), 32);
    z.writeBigUInt64LE(BigInt(cdBuf.length), 40); z.writeBigUInt64LE(BigInt(off + cdBuf.length - cdBuf.length), 48);
    z.writeUInt32LE(0x07064b50, 56); z.writeBigUInt64LE(BigInt(off + cdBuf.length), 64); z.writeUInt32LE(1, 72);
    return Buffer.concat([...parts, cdBuf, z, end]);
  }
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  return Buffer.concat([...parts, cdBuf, end]);
}

module.exports = { readZip, readZipEx, writeZip, crc32 };
