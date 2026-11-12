'use strict';
/* Portable EXE builder: prune the unpacked Electron app, compress it with LZMA2 and wrap it in the
 * small self-extracting launcher (sfx/launcher.cs). The payload is unpacked once into
 * %LOCALAPPDATA%\Hider\app-<id>, so only the very first launch pays for decompression.
 *
 * Output layout: [launcher.exe][7za.exe][payload.7z][FOOTER 64]  (see launcher.cs / bot/src/download.js) */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// Files Chromium ships but this app never uses (no WebGPU, license page, WER, installer helper). d3dcompiler_47 is part of Windows 10.
const PRUNE = [
  'LICENSES.chromium.html', 'LICENSE.electron.txt',
  'dxcompiler.dll', 'dxil.dll', 'd3dcompiler_47.dll', 'electron_wer.dll', 'resources/elevate.exe',
];
const KEEP_LOCALES = new Set(['en-US.pak', 'ru.pak']);

function findCsc() {
  const win = process.env.WINDIR || 'C:\\Windows';
  for (const f of ['Framework64', 'Framework']) {
    const p = path.join(win, 'Microsoft.NET', f, 'v4.0.30319', 'csc.exe');
    if (fs.existsSync(p)) return p;
  }
  throw new Error('csc.exe (.NET Framework 4) not found');
}

function dirSize(d) {
  let n = 0;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return n;
}

function prune(dir) {
  const before = dirSize(dir);
  for (const rel of PRUNE) fs.rmSync(path.join(dir, rel), { force: true });
  const loc = path.join(dir, 'locales');
  if (fs.existsSync(loc)) for (const f of fs.readdirSync(loc)) if (!KEEP_LOCALES.has(f)) fs.rmSync(path.join(loc, f), { force: true });
  const after = dirSize(dir);
  console.log(`[sfx] pruned unpacked app: ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB`);
}

function make(root, version, opts = {}) {
  const unpacked = path.join(root, 'dist', 'win-unpacked');
  const work = path.join(root, 'dist', 'sfx');
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  prune(unpacked);

  const sevenZip = require('7zip-bin').path7za;
  const payload = path.join(work, 'payload.7z');
  // small dictionary => many independent LZMA2 blocks => the launcher can unpack them on all cores
  const dict = opts.dict || process.env.SFX_DICT || '8m';
  const t0 = Date.now();
  execFileSync(sevenZip, ['a', '-t7z', '-m0=lzma2', '-mx=9', `-md=${dict}`, '-mfb=64', '-ms=on', '-mmt=on', '-mqs=on', '-bd', payload, path.join(unpacked, '*')], { stdio: 'inherit' });
  console.log(`[sfx] payload ${(fs.statSync(payload).size / 1048576).toFixed(1)} MB (dict ${dict}, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);

  const stubExe = path.join(work, 'launcher.exe');
  execFileSync(findCsc(), ['/nologo', '/target:winexe', '/optimize+', `/out:${stubExe}`, `/win32icon:${path.join(root, 'build', 'icon.ico')}`,
    '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', path.join(root, 'sfx', 'launcher.cs')], { stdio: 'inherit' });
  try {
    const rcedit = require('rcedit');
    const run = rcedit.rcedit || rcedit.default || rcedit;
    return Promise.resolve(run(stubExe, {
      'version-string': { ProductName: 'Hider', FileDescription: 'Hider', CompanyName: 'Hider', LegalCopyright: 'Hider', OriginalFilename: 'Hider.exe', InternalName: 'Hider' },
      'file-version': version, 'product-version': version,
    })).catch(() => {}).then(() => assemble(root, work, stubExe, sevenZip, payload, version));
  } catch { return Promise.resolve(assemble(root, work, stubExe, sevenZip, payload, version)); }
}

function assemble(root, work, stubExe, sevenZip, payload, version) {
  const stub = fs.readFileSync(stubExe);
  const sev = fs.readFileSync(sevenZip);
  const pay = fs.readFileSync(payload);
  const id = crypto.createHash('sha256').update(pay).digest().subarray(0, 16);
  const footer = Buffer.alloc(64);
  footer.write('HDRSFX01', 0, 'latin1');
  footer.writeBigInt64LE(BigInt(stub.length), 8);
  footer.writeBigInt64LE(BigInt(sev.length), 16);
  footer.writeBigInt64LE(BigInt(stub.length + sev.length), 24);
  footer.writeBigInt64LE(BigInt(pay.length), 32);
  id.copy(footer, 40);
  const out = path.join(root, 'dist', `Hider-Portable-${version}.exe`);
  fs.writeFileSync(out, Buffer.concat([stub, sev, pay, footer]));
  console.log(`[sfx] ${path.basename(out)}: ${(fs.statSync(out).size / 1048576).toFixed(1)} MB (launcher ${(stub.length / 1024).toFixed(0)} KB, 7za ${(sev.length / 1024).toFixed(0)} KB, payload ${(pay.length / 1048576).toFixed(1)} MB)`);
  return out;
}

module.exports = { make, prune };
