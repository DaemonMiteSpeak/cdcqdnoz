import { get, post, HttpError } from './api.js';
import { $, $$, openLink, toast } from './ui.js';

const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  try { tg.setHeaderColor('#0F0F0F'); tg.setBackgroundColor('#0F0F0F'); tg.disableVerticalSwipes?.(); } catch { /* old client */ }
}

export const app = { S: null, root: null, route: null, depth: 0 };
const ROUTES = [
  [/^\/$/, () => import('./screens/home.js')],
  [/^\/gate$/, () => import('./screens/gate.js')],
  [/^\/profile$/, () => import('./screens/profile.js')],
  [/^\/tags$/, () => import('./screens/tags.js')],
  [/^\/launch$/, () => import('./screens/launch.js?v=4')],
  [/^\/buy$/, () => import('./screens/buy.js')],
  [/^\/pay$/, () => import('./screens/pay.js')],
  [/^\/order\/(\d+)$/, () => import('./screens/order.js')],
  [/^\/media$/, () => import('./screens/media.js')],
  [/^\/media\/videos$/, () => import('./screens/videos.js')],
  [/^\/withdraw$/, () => import('./screens/withdraw.js')],
  [/^\/withdraw\/history$/, () => import('./screens/history.js')],
];

export function go(path, { replace = false } = {}) {
  if (replace) location.replace(`#${path}`);
  else location.hash = path;
}
export function setState(S) { app.S = S; }
export async function refresh() { app.S = await get('/state'); return app.S; }

function parse() {
  const h = location.hash.slice(1) || '/';
  const [path, qs] = h.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

let navId = 0;
let dir = 'left';
let lastPath = null;

async function render() {
  const id = ++navId;
  const { path, query } = parse();
  const root = app.root;
  const route = ROUTES.find(([re]) => re.test(path));
  if (!route) return go('/', { replace: true });
  const params = path.match(route[0]).slice(1);
  const ctx = { S: app.S, params, query, path, go, refresh, setState };

  try {
    if (!app.S) {
      root.innerHTML = (await import('./screens/system.js')).loading();
      app.S = await get('/state');
      ctx.S = app.S;
    }
    if (app.S.maintenance) return show(id, (await import('./screens/system.js')).maintenance({ until: app.S.maintenanceUntil }), (el) => $('[data-retry]', el)?.addEventListener('click', () => { app.S = null; render(); }), path);
    if (!app.S.user.gate && path !== '/gate') return go('/gate', { replace: true });
    const mod = await route[1]();
    const view = await mod.default(ctx);
    show(id, view.html, view.mount, path, ctx);
  } catch (e) {
    if (id !== navId) return;
    const sys = await import('./screens/system.js');
    if (e instanceof HttpError && e.code === 'gate') { app.S = null; return go('/gate', { replace: true }); }
    if (e instanceof HttpError && e.code === 'maintenance') return show(id, sys.maintenance(), (el) => $('[data-retry]', el)?.addEventListener('click', () => { app.S = null; render(); }), path);
    console.error(e);
    show(id, sys.unavailable(), (el) => $('[data-retry]', el)?.addEventListener('click', () => { app.S = null; render(); }), path);
  }
}

function show(id, html, mount, path, ctx) {
  if (id !== navId) return;
  const root = app.root;
  root.innerHTML = html;
  const el = root.firstElementChild;
  if (el && lastPath !== null && lastPath !== path) el.classList.add(dir === 'left' ? 'push-left' : 'push-right');
  lastPath = path;
  dir = 'left';
  window.scrollTo(0, 0);
  if (tg) {
    if (path === '/' || path === '/gate') tg.BackButton.hide(); else tg.BackButton.show();
  }
  mount?.(el, ctx);
}

document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-go]');
  if (g && !g.disabled) { e.preventDefault(); dir = g.hasAttribute('data-back') || g.dataset.go === '/' ? 'right' : 'left'; go(g.dataset.go); return; }
  const x = e.target.closest('[data-ext]');
  if (x) { e.preventDefault(); openLink(x.dataset.ext); }
});

if (tg) tg.BackButton.onClick(() => { dir = 'right'; history.length > 1 ? history.back() : go('/'); });

window.addEventListener('hashchange', render);
window.addEventListener('popstate', () => { dir = 'right'; });

export function start() {
  app.root = $('#root');
  render();
}
export { toast, post };
