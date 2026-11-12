'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
const listeners = { state: [], log: [], logs: [] };
for (const k of Object.keys(listeners)) ipcRenderer.on('hider:' + k, (_e, d) => listeners[k].forEach((f) => { try { f(d); } catch { /* ignore */ } }));

contextBridge.exposeInMainWorld('hider', {
  minimize: () => ipcRenderer.send('win:minimize'),
  close: () => ipcRenderer.send('win:close'),
  screen: (name) => ipcRenderer.send('win:screen', name),
  init: inv('hider:init'),
  login: inv('hider:login'),
  resume: inv('hider:resume'),
  logout: inv('hider:logout'),
  open: inv('hider:open'),
  stop: inv('hider:stop'),
  switchRole: inv('hider:switch'),
  clearLogs: inv('hider:clear'),
  copy: inv('hider:copy'),
  setPrefs: inv('hider:prefs'),
  cosCatalog: inv('hider:cosmetics:catalog'),
  setCosmetics: inv('hider:cosmetics:set'),
  setCosSelf: inv('hider:cosmetics:self'),
  setTop: inv('hider:top'),
  on: (kind, fn) => { if (listeners[kind]) listeners[kind].push(fn); },
});
