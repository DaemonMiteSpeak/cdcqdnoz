'use strict';

/* release build: icon -> unpacked app -> exe metadata/icon -> installer + portable
 *
 * minecraft-data ships ~490 MB of JSON for every Minecraft version (plus all of Bedrock).
 * The app only needs the versions listed in src/relay-config.json (+ the 26.1 base used by
 * src/versions.js and the versions in src/protocol-patches.json), so the build generates an
 * electron-builder config that leaves every other data directory out of app.asar.
 *
 * The engine (tools/engine-manifest.js) is encrypted into src/engine.bin before packaging; the
 * matching key is written to server/data/engine.key for deployment to the relay host. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const root = __dirname;
const pkg = require('./package.json');
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });

const enginePack = require('./tools/pack-engine');
const ENGINE_FILES = require('./tools/engine-manifest');
const ENGINE_KEY_FILE = path.join(root, 'server', 'data', 'engine.key');

const GENERATED_CONFIG = 'electron-builder.generated.json';
const BASE_VERSION = '26.1'; // keep in sync with BASE in src/versions.js
/* Minecraft versions the client can proxy; decides which minecraft-data dirs are bundled.
 * The relay advertises the runtime list in its hello (src/relay-config.json no longer ships it),
 * so keep this a superset of the server's CFG.versions. */
const BUILD_VERSIONS = ['26.2', '26.1', '1.21.11', '1.21.8', '1.21.4', '1.16.5'];

/* AOT (default): main.js + src/** are precompiled to V8 bytecode before packaging (see aot.js).
 * "node build.js --jit" or HIDER_AOT=0 builds the plain JavaScript version instead. */
const AOT = !process.argv.includes('--jit') && process.env.HIDER_AOT !== '0';
const AOT_DIR = 'build/aot';

/* The engine key encrypts src/engine.bin (client) and is served by the relay (server). Keep it
 * stable across builds by reusing server/data/engine.key when present; deploy that file to the
 * relay host so the server and the shipped engine.bin always match. */
function ensureEngineKey() {
  try { const k = fs.readFileSync(ENGINE_KEY_FILE, 'utf8').trim(); if (/^[0-9a-f]{64}$/i.test(k)) return k; } catch { /* generate a new one below */ }
  const k = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(ENGINE_KEY_FILE), { recursive: true });
  fs.writeFileSync(ENGINE_KEY_FILE, k, { mode: 0o600 });
  return k;
}

async function makeIcon() {
  const sharp = require('sharp');
  const mod = require('png-to-ico');
  const pngToIco = mod.default || mod.imagesToIco || mod;
  const svg = fs.readFileSync(path.join(root, 'app', 'assets', 'favicon.svg'));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = [];

  for (const size of sizes) {
    pngs.push(await sharp(svg, { density: 384 }).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer());
  }

  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), pngs[pngs.length - 1]);
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), await pngToIco(pngs));
}

/* Which minecraft-data/pc/<dir> folders do the supported versions actually read? */
function planMinecraftData() {
  const dataRoot = path.join(root, 'node_modules', 'minecraft-data', 'minecraft-data', 'data');
  const patches = require('./src/protocol-patches.json');
  const pcPaths = require(path.join(dataRoot, 'dataPaths.json')).pc;

  const used = [...new Set([...BUILD_VERSIONS, BASE_VERSION, ...Object.keys(patches)])];
  const keep = new Set(['common']);
  for (const v of used) {
    const entry = pcPaths[v];
    if (!entry) continue; // e.g. 26.2: reuses the 26.1 data via src/versions.js
    for (const p of Object.values(entry)) {
      const m = /^pc\/(.+)$/.exec(String(p));
      if (m) keep.add(m[1]);
    }
  }

  const pcDir = path.join(dataRoot, 'pc');
  const drop = fs.readdirSync(pcDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !keep.has(d.name))
    .map((d) => d.name);

  // Bedrock is never used, but minecraft-data eagerly loads bedrock/common/*.json at startup.
  const bedrockDir = path.join(dataRoot, 'bedrock');
  const dropBedrock = fs.existsSync(bedrockDir)
    ? fs.readdirSync(bedrockDir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'common').map((d) => d.name)
    : [];
  return { used, keep: [...keep].sort(), drop, dropBedrock };
}

function writeBuilderConfig() {
  const plan = planMinecraftData();
  const base = 'node_modules/minecraft-data/minecraft-data/data';
  const excludes = plan.drop.map((d) => `!${base}/pc/${d}`);
  for (const d of plan.dropBedrock) excludes.push(`!${base}/bedrock/${d}`); // the app is Java-only
  excludes.push('!src/protocol-patches.json'); // delivered by the relay at runtime, never shipped in the app
  excludes.push('!src/cosmetics/catalog.json', '!src/cosmetics/data', '!src/cosmetics/data/**/*'); // cosmetic assets delivered by the relay to subscribers
  excludes.push('!src/cosmetics/convert.js'); // build-only bbmodel->vanilla converter: parts are precomputed server-side, never shipped
  if (!AOT) for (const rel of ENGINE_FILES) excludes.push('!src/' + rel); // engine ships encrypted as src/engine.bin (the AOT tree already omits it)

  const cfg = JSON.parse(JSON.stringify(pkg.build));
  if (AOT) {
    // main.js, preload.js and src/** come from the precompiled tree instead of the project folder
    const fromProject = new Set(['main.js', 'preload.js', 'src/**/*']);
    cfg.files = [...cfg.files.filter((f) => !fromProject.has(f)), { from: AOT_DIR, to: '.', filter: ['**/*'] }];
  }
  cfg.files = [...cfg.files, ...excludes];
  fs.writeFileSync(path.join(root, GENERATED_CONFIG), JSON.stringify(cfg, null, 2));

  console.log(`[build] minecraft-data: versions in use = ${plan.used.join(', ')}`);
  console.log(`[build] minecraft-data: keeping ${plan.keep.length} pc dirs, excluding ${plan.drop.length} pc dirs + ${plan.dropBedrock.length} bedrock dirs`);
}

async function main() {
  fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });

  await makeIcon();
  const engineKey = ensureEngineKey();
  if (AOT) {
    await require('./aot').buildAot(root, path.join(root, AOT_DIR));
    enginePack.packEngine(path.join(root, 'src'), path.join(root, AOT_DIR, 'src', 'engine.bin'), engineKey);
  } else {
    console.log('[build] AOT off: plain JavaScript');
    enginePack.packEngine(path.join(root, 'src'), path.join(root, 'src', 'engine.bin'), engineKey);
  }
  console.log('[build] engine encrypted -> engine.bin; key in server/data/engine.key (deploy it to the relay host)');
  { const r = require('./tools/pack-cosmetics').packCosmetics(root); console.log('[build] cosmetics bundle -> server/cosmetics-assets.json (' + r.count + ' items, ' + r.size + ' bytes; deploy it to the relay host)'); }
  writeBuilderConfig();
  run(`npx electron-builder --config ${GENERATED_CONFIG} --win dir --x64`);

  const exe = path.join(root, 'dist', 'win-unpacked', 'Hider.exe');
  const { rcedit } = require('rcedit');
  await rcedit(exe, {
    icon: path.join(root, 'build', 'icon.ico'),
    'version-string': {
      ProductName: 'Hider',
      FileDescription: 'Hider',
      CompanyName: 'Hider',
      LegalCopyright: 'Hider',
      OriginalFilename: 'Hider.exe',
      InternalName: 'Hider',
    },
    'file-version': pkg.version,
    'product-version': pkg.version,
  });

  // Harden the packaged binary: block run-as-Node, NODE_OPTIONS and --inspect so the decrypted
  // engine can't be dumped via a debugger or a plain node REPL, and only load app code from app.asar.
  {
    const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
    await flipFuses(exe, {
      version: FuseVersion.V1,
      resetAdHocDarwinSignature: false,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    });
    console.log('[build] Electron fuses set: RunAsNode/NodeOptions/NodeCliInspect off, OnlyLoadAppFromAsar on');
  }
  run(`npx electron-builder --config ${GENERATED_CONFIG} --prepackaged dist/win-unpacked --win nsis portable --x64`);
  fs.rmSync(path.join(root, GENERATED_CONFIG), { force: true });
  if (AOT) fs.rmSync(path.join(root, AOT_DIR), { recursive: true, force: true });
  else fs.rmSync(path.join(root, 'src', 'engine.bin'), { force: true });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
