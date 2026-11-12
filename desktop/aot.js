'use strict';

/* AOT step of the release build: JavaScript -> V8 bytecode (.jsc).
 *
 * main.js and everything in src/ is compiled ahead of time inside a real Electron main process
 * (the same V8 and snapshot that later loads it), so the app no longer parses and compiles its own
 * code on every start. Non-JS files (json, pem, png ...) are copied unchanged.
 * app/ (renderer page, no Node) and preload.js (sandboxed) have to stay plain JavaScript.
 *
 * The engine modules (tools/engine-manifest.js) are never emitted here: they ship encrypted in
 * src/engine.bin (written by build.js) and are decrypted in memory at runtime.
 *
 * The bytecode only works with the exact Electron build it was compiled with, so it is generated
 * on every release build from node_modules/electron - never commit the result. */

const fs = require('fs');
const path = require('path');
const ENGINE_FILES = require('./tools/engine-manifest');

const STUB = [
  "'use strict';",
  '// AOT build: the real entry point is main.jsc (V8 bytecode compiled at build time)',
  "require('bytenode');",
  "require('./main.jsc');",
  '',
].join('\n');

function collect(srcDir, dstDir, jobs, skip, skipDirs) {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const e of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const from = path.join(srcDir, e.name);
    const to = path.join(dstDir, e.name);
    if (e.isDirectory()) { if (!(skipDirs && skipDirs.has(path.resolve(from)))) collect(from, to, jobs, skip, skipDirs); }
    else if (skip.has(path.resolve(from))) { /* engine module: shipped encrypted in engine.bin, never as source/bytecode */ }
    else if (e.name === 'protocol-patches.json') { /* delivered by the relay at runtime, never shipped */ }
    else if (/\.js$/i.test(e.name)) jobs.push({ from, to: to.replace(/\.js$/i, '.jsc') });
    else fs.copyFileSync(from, to);
  }
}

async function buildAot(root, outDir) {
  const bytenode = require('bytenode');
  const electronPath = require('electron'); // path to the electron binary the app is packaged with
  const t0 = Date.now();

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const skip = new Set([...ENGINE_FILES.map((rel) => path.resolve(root, 'src', rel)), path.resolve(root, 'src', 'cosmetics', 'catalog.json'), path.resolve(root, 'src', 'cosmetics', 'convert.js')]); // + cosmetic catalog + the build-only converter: handled server-side, never shipped
  const skipDirs = new Set([path.resolve(root, 'src', 'cosmetics', 'data')]); // cosmetic models/textures: delivered by the relay to subscribers
  const jobs = [];
  collect(path.join(root, 'src'), path.join(outDir, 'src'), jobs, skip, skipDirs);
  jobs.push({ from: path.join(root, 'main.js'), to: path.join(outDir, 'main.jsc') });
  fs.writeFileSync(path.join(outDir, 'main.js'), STUB);
  fs.copyFileSync(path.join(root, 'preload.js'), path.join(outDir, 'preload.js'));

  const { obfuscateCode } = require('./tools/obfuscate');
  const obfDir = path.join(outDir, '.obf');
  fs.mkdirSync(obfDir, { recursive: true });

  console.log('[aot] obfuscating + compiling ' + jobs.length + ' files to V8 bytecode with Electron ' + require('electron/package.json').version);
  let bytes = 0;
  let idx = 0;
  for (const job of jobs) { // one after another: every file starts its own Electron process
    // obfuscate the plaintext bootstrap source first, then compile the obfuscated copy to bytecode,
    // so a bytecode decompiler only ever recovers obfuscated JavaScript (see tools/obfuscate.js)
    const obfFile = path.join(obfDir, (idx++) + '_' + path.basename(job.to).replace(/\.jsc$/i, '.js'));
    fs.writeFileSync(obfFile, obfuscateCode(fs.readFileSync(job.from, 'utf8')));
    await bytenode.compileFile({ filename: obfFile, output: job.to, compileAsModule: true, electronMain: true, electronPath });
    bytes += fs.statSync(job.to).size;
  }
  fs.rmSync(obfDir, { recursive: true, force: true });
  console.log('[aot] done in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s, ' + (bytes / 1024).toFixed(0) + ' KB of bytecode');
}

module.exports = { buildAot };
