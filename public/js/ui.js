import { icon, logo } from './icons.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const NB = '\u00A0';
export const num = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NB);
export const rub = (n) => {
  const r = Math.round(n * 100) / 100;
  const s = Number.isInteger(r) ? num(r) : num(Math.trunc(r)) + ',' + String(Math.round((r % 1) * 100)).padStart(2, '0').replace(/0$/, '');
  return `${s}${NB}₽`;
};
export const rubK = (k) => rub(k / 100);
const p2 = (n) => String(n).padStart(2, '0');
export const dmy = (ts) => { const d = new Date(ts); return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`; };
export const hm = (ts) => { const d = new Date(ts); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
export const plural = (n, a, b, c) => {
  const m = Math.abs(n) % 100; const m1 = m % 10;
  return m > 10 && m < 20 ? c : m1 > 1 && m1 < 5 ? b : m1 === 1 ? a : c;
};
export const days = (n) => `${n} ${plural(n, 'день', 'дня', 'дней')}`;
export const greeting = () => {
  const h = new Date().getHours();
  return h >= 5 && h < 12 ? 'Доброе утро,' : h >= 12 && h < 18 ? 'Добрый день,' : h >= 18 && h < 23 ? 'Добрый вечер,' : 'Доброй ночи,';
};
export const tagOf = (S, id) => S.catalog.tags.find((t) => t.id === id) || S.catalog.tags[0];

export function bar({ title, meta = '', back = true, right = '' }) {
  return `<header class="bar">
    ${back ? `<button class="back" data-go="/" aria-label="На главную">${icon('chevronLeft')}</button>` : logo()}
    <span class="bar-title">${esc(title)}</span>
    ${right || (meta ? `<span class="bar-meta">${esc(meta)}</span>` : '')}
  </header>`;
}

export function avatar(S, size = 42) {
  const u = S.user;
  const p = Math.round((S.sub.progress || 0) * 100);
  const face = u.photo
    ? `<img class="avatar-face has-img" src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer">`
    : `<div class="avatar-face">${esc((u.name || '?').slice(0, 1).toUpperCase())}</div>`;
  return `<div class="avatar" style="--p:${S.sub.active ? p : 0};--sz:${size}px">${face}</div>`;
}

export function profileCard(S, { top, sub, big = false }) {
  const t = tagOf(S, S.user.tag);
  const bg = S.user.photo ? `style="--ban:url('${esc(S.user.photo)}')"` : '';
  return `<section class="profile ${S.user.photo ? 'has-img' : ''} ${big ? 'big' : ''}" ${bg}>
    ${avatar(S, big ? 54 : 42)}
    <div class="p-info">
      <span class="p-top">${esc(top)}</span>
      <div class="p-name"><span class="p-nm">${esc(S.user.name)}</span><span class="p-tag" style="color:${t.color}">${esc(t.title)}</span></div>
      <span class="p-sub">${sub}</span>
    </div>
  </section>`;
}

export function secHead(title, sub, right = '') {
  return `<div class="sec-head"><div><span class="s-t">${esc(title)}</span>${sub ? `<span class="s-d">${esc(sub)}</span>` : ''}</div>${right}</div>`;
}

export function radio(on) { return `<span class="radio ${on ? 'on' : ''}"></span>`; }

export const LOGO = (n) => `<span class="lg-tile"><img src="/img/${n}.png" alt=""></span>`;

export function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 2600);
}

export function openLink(url) {
  const tg = window.Telegram?.WebApp;
  if (tg && /^https?:\/\/t\.me\//.test(url)) tg.openTelegramLink(url);
  else if (tg) tg.openLink(url);
  else window.open(url, '_blank');
}

export { icon, logo };
