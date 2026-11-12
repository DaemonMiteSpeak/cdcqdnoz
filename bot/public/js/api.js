const tg = window.Telegram?.WebApp;
export const initData = () => tg?.initData || '';

export class HttpError extends Error {
  constructor(status, body) {
    super(body?.error || `http_${status}`);
    this.status = status;
    this.code = body?.error || `http_${status}`;
    this.body = body || {};
  }
}

const devUser = () => {
  const q = new URLSearchParams(location.search);
  return q.get('dev');
};

export async function api(method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  const idata = initData();
  if (idata) headers.Authorization = `tma ${idata}`;
  const dev = devUser();
  if (dev) { headers['x-dev-user'] = dev; headers['x-dev-username'] = new URLSearchParams(location.search).get('name') || 'YukeeDesign'; }
  let r;
  try {
    r = await fetch(`/api${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new HttpError(0, { error: 'network' });
  }
  let j = null;
  try { j = await r.json(); } catch { /* empty body */ }
  if (!r.ok) throw new HttpError(r.status, j);
  return j;
}
export const get = (u) => api('GET', u);
export const post = (u, b) => api('POST', u, b || {});
