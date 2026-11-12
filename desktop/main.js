'use strict';

const { app, BrowserWindow, ipcMain, shell, Menu, safeStorage, clipboard } = require('electron');
const path = require('path');

const T0 = Date.now();
const fs = require('fs');
const os = require('os');
const startupLogFile = path.join(os.tmpdir(), 'hider-startup.log');
const mark = (label) => {
  const line = `[startup] +${Date.now() - T0}ms ${label}`;
  console.log(line);
  try { fs.appendFileSync(startupLogFile, `${new Date().toISOString()} ${line}\n`); } catch { /* ignore */ }
};

const SCREENS = {
  login: { width: 495, height: 400 },
  app: { width: 600, height: 395 },
};

let win = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => { mark('app ready'); createWindow(); });
  app.on('window-all-closed', () => app.quit());
}

function createWindow() {
  Menu.setApplicationMenu(null);

  win = new BrowserWindow({
    width: SCREENS.login.width,
    height: SCREENS.login.height,
    useContentSize: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: 'Hider',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false,
      spellcheck: false,
    },
  });

  mark('window created');
  win.once('ready-to-show', () => { mark('ready-to-show'); win.show(); mark('shown'); });
  win.webContents.on('did-finish-load', () => mark('did-finish-load'));
  win.on('closed', () => { win = null; });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  win.loadFile(path.join(__dirname, 'app', 'index.html'));
}

/* ---------- Hider backend (login, relay tunnel, Minecraft proxy) ---------- */
let backend = null;
function getBackend() {
  if (backend) return backend;
  const { Backend } = require('./src/backend');
  backend = new Backend({
    dir: path.join(app.getPath('userData'), 'hider'),
    encrypt: (s) => (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(s).toString('base64') : null),
    decrypt: (b) => (safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(b, 'base64')) : null),
    openExternal: (u) => { if (/^https:\/\//i.test(u)) shell.openExternal(u); },
    copy: (t) => clipboard.writeText(String(t)),
  });
  const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };
  backend.on('state', (s) => send('hider:state', s));
  backend.on('log', (e) => send('hider:log', e));
  backend.on('logs', (a) => send('hider:logs', a));
  return backend;
}

const safe = (fn) => async (...a) => {
  try { return await fn(...a); } catch (e) { return { ok: false, error: 'internal', message: String(e && e.message || e) }; }
};
ipcMain.handle('hider:init', safe(() => { const b = getBackend(); return { ok: true, lastUser: b.lastUser(), versions: b.versions(), state: b.getState(), logs: b.logs }; }));
ipcMain.handle('hider:login', safe((_e, u, k) => getBackend().login(u, k)));
ipcMain.handle('hider:resume', safe(() => getBackend().resume()));
ipcMain.handle('hider:logout', safe(() => { getBackend().logout(); return { ok: true }; }));
ipcMain.handle('hider:open', safe((_e, server, version, msa) => getBackend().open(server, version, msa)));
ipcMain.handle('hider:stop', safe(() => ({ ok: getBackend().stop() })));
ipcMain.handle('hider:switch', safe(() => ({ ok: getBackend().switchRole() })));
ipcMain.handle('hider:clear', safe(() => { getBackend().clearLogs(); return { ok: true }; }));
ipcMain.handle('hider:prefs', safe((_e, p) => ({ ok: true, prefs: getBackend().setPrefs(p) })));
ipcMain.handle('hider:cosmetics:catalog', safe(() => ({ ok: true, catalog: getBackend().catalog(), equipped: getBackend().cosState().equipped, selfView: !!getBackend().store.cosSelf })));
  ipcMain.handle('hider:cosmetics:self', safe((_e, v) => getBackend().setCosSelfView(v)));
ipcMain.handle('hider:cosmetics:set', safe((_e, eq) => getBackend().setCosmetics(eq)));
ipcMain.handle('hider:top', safe((_e, v) => { if (win && !win.isDestroyed()) win.setAlwaysOnTop(!!v); return { ok: true }; }));
ipcMain.handle('hider:copy', safe((_e, t) => { clipboard.writeText(String(t || '')); return { ok: true }; }));
app.on('before-quit', () => { try { backend && backend.shutdown(); } catch { /* ignore */ } });

ipcMain.on('win:minimize', () => win?.minimize());
ipcMain.on('win:close', () => win?.close());

ipcMain.on('win:screen', (_event, name) => {
  const size = SCREENS[name];
  if (!win || !size) return;

  const bounds = win.getBounds();
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;

  win.setResizable(true);
  win.setContentSize(size.width, size.height);
  const next = win.getBounds();
  win.setPosition(Math.round(cx - next.width / 2), Math.round(cy - next.height / 2));
  win.setResizable(false);
});
