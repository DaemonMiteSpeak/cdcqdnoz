import { esc, icon, bar, rub, dmy, days, plural, toast, openLink } from '../ui.js';
import { get, post } from '../api.js';
import { go, setState } from '../app.js';

const M = { sbp: 'СБП и карта', cryptobot: 'CryptoBot', funpay: 'FunPay', stars: 'Telegram Stars' };
const pad = (n) => String(n).padStart(2, '0');
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };
const kv = (k, v, c = '') => `<div class="row"><span class="k">${k}</span><span class="v ${c}">${v}</span></div>`;
const result = (ic, cls, t, d) => `<section class="field gate"><div class="res center"><span class="res-ico ${cls}">${icon(ic)}</span><h1 class="res-t">${t}</h1><p class="res-d">${d}</p></div></section>`;
const orderTitle = (S, o) => o.kind === 'sub' ? `Подписка на ${o.item} ${plural(Number(o.item), 'день', 'дня', 'дней')}` : o.kind === 'hwid' ? `${o.item} ${plural(Number(o.item), 'сброс', 'сброса', 'сбросов')} HWID` : `Тег «${o.tagTitle}»`;

function waiting(S, o, left, total, sbpReq) {
  const hint = o.method === 'sbp' ? 'Оплати в окне СБП, которое открылось.' : o.method === 'cryptobot' ? 'Оплати счёт в окне CryptoBot.' : o.method === 'stars' ? 'Оплати счёт звёздами в открывшемся окне.' : 'Купи лот на FunPay — подтвердим оплату вручную.';
  return `<main class="app">${bar({ title: 'Оплата', meta: `счёт № ${o.id}` })}
    <div class="field order-card"><div class="order"><div><span class="o-t">${esc(orderTitle(S, o))}</span></div><span class="order-r">${o.promo ? `<s>${rub(o.base)}</s>` : ''}<b>${rub(o.total)}</b></span></div>
      ${o.promo ? `<div class="order-promo">${icon('ticket')}<span>Промокод ${esc(o.promo)}</span><span class="pill ok">−${Math.round((1 - o.total / o.base) * 100)}%</span></div>` : ''}</div>
    <div class="field timer"><div class="timer-row"><span class="spin warn"></span><span class="tm mono" id="tm">${mmss(left)}</span></div>
      <div class="track"><div class="fill warn" id="tf" style="width:${Math.round((left / total) * 100)}%"></div></div>
      <p class="hint">${hint} Счёт действует ${Math.round(total / 60000)} минут</p>
      ${sbpReq ? `<pre class="req">${esc(sbpReq)}\nКомментарий: №${o.id}</pre>` : ''}</div>
    <div class="field rows"><div class="row"><span class="k">Способ</span><span class="v">${M[o.method]}</span></div><div class="row"><span class="k">К оплате</span><span class="v">${rub(o.total)}</span></div></div>
    <div class="foot"><button class="btn" id="chk">${icon('check')}<span>Проверить оплату</span></button>
      ${o.payUrl ? `<button class="btn ghost" id="reopen">${icon('external', 'acc')}<span>Открыть оплату снова</span></button>` : ''}
      <button class="foot-note link" id="cancel">Передумал? Отменить оплату</button></div></main>`;
}

function done(S, o) {
  const m = M[o.method];
  if (o.kind === 'sub') {
    return `<main class="app">${bar({ title: 'Оплата', meta: `счёт № ${o.id}` })}${result('check', 'ok', 'Оплата прошла', `Подписка продлена до ${dmy(S.sub.until)} — можно запускать Hider`)}
      <div class="field rows">${kv('Оплачено', rub(o.total))}${kv('Способ', m)}${kv('Подписка', `активна · ${days(S.sub.daysLeft)}`, 'ok')}</div>
      <div class="foot"><button class="btn" data-go="/launch">${icon('play')}<span>Запустить Hider</span></button><button class="btn ghost" data-go="/">На главную</button><p class="foot-note">Чек отправили в этот чат</p></div></main>`;
  }
  if (o.kind === 'tag') {
    return `<main class="app">${bar({ title: 'Оплата', meta: `счёт № ${o.id}` })}${result('check', 'ok', `Тег «${esc(o.tagTitle)}» куплен`, 'Он уже в «Моих тегах». Установи — и так тебя будут видеть в Hider')}
      <div class="field rows">${kv('Оплачено', o.promo ? `<s class="dim">${o.base} ₽</s> ${rub(o.total)}` : rub(o.total))}${kv('Способ', m)}</div>
      <div class="foot"><button class="btn" id="install">${icon('tag')}<span>Установить тег</span></button><button class="btn ghost" data-go="/tags">Позже</button></div></main>`;
  }
  const after = S.hwid.resets;
  return `<main class="app">${bar({ title: 'Оплата', meta: `счёт № ${o.id}` })}${result('check', 'ok', 'Сбросы начислены', `+${o.item} ${plural(Number(o.item), 'сброс', 'сброса', 'сбросов')} HWID уже на аккаунте — сбросить можно в профиле`)}
    <div class="field rows">${kv('Было', after - Number(o.item))}${kv('Стало', after)}${kv('Оплачено', `${rub(o.total)} · ${m}`)}</div>
    <div class="foot"><button class="btn" data-go="/profile">${icon('user')}<span>В профиль</span></button></div></main>`;
}

const cancelled = (S, o) => `<main class="app">${bar({ title: 'Оплата', meta: `счёт № ${o.id}` })}${result('ban', 'bad', 'Оплата отменена', 'Счёт закрыт, деньги не списаны. Если списание всё же прошло — вернём автоматически')}
  <div class="field rows">${kv('Заказ', '<span class="pill bad">отменён</span>')}</div>
  <div class="foot"><button class="btn" data-go="${payLink(o)}">${icon('lock')}<span>Оплатить снова</span></button><button class="btn ghost" data-go="${payLink(o)}">Другой способ оплаты</button></div></main>`;
const expired = (S, o) => `<main class="app">${bar({ title: 'Оплата', meta: `счёт № ${o.id}` })}${result('clock', 'warn', 'Время на оплату вышло', 'Счёт действовал 15 минут и закрылся. Создай новый — тариф и промокод сохранятся')}
  <div class="field rows">${kv(`${rub(o.total)}${o.promo ? ` · ${esc(o.promo)}` : ''}`, '<span class="pill warn">истёк</span>')}</div>
  <div class="foot"><button class="btn" data-go="${payLink(o)}">${icon('reset')}<span>Создать новый счёт</span></button><button class="btn ghost" data-go="/buy${o.kind === 'hwid' ? '?tab=hwid' : ''}">Изменить тариф</button></div></main>`;
const payLink = (o) => `/pay?kind=${o.kind}&item=${o.item}${o.promo ? `&promo=${encodeURIComponent(o.promo)}` : ''}`;

export default async function order({ S, params, query }) {
  const id = params[0];
  let o = await get(`/orders/${id}`);
  let sbpReq = S.payInfo?.sbpRequisites || '';
  const total = 15 * 60000;
  const paint = (root) => {
    S = window.__S || S;
    if (o.status === 'paid') root.innerHTML = done(S, o);
    else if (o.status === 'cancelled') root.innerHTML = cancelled(S, o);
    else if (o.status === 'expired') root.innerHTML = expired(S, o);
    else root.innerHTML = waiting(S, o, o.expiresAt - Date.now(), total, o.method === 'sbp' && !o.payUrl ? sbpReq : '');
    root.querySelector('#install')?.addEventListener('click', async () => { try { setState(await post('/tags/select', { tag: o.item })); go('/tags'); } catch { toast('Не удалось установить тег'); } });
  };
  const openPay = () => {
    const tg = window.Telegram?.WebApp;
    if (!o.payUrl) return;
    if (o.method === 'stars' && tg?.openInvoice) tg.openInvoice(o.payUrl, () => check(document.querySelector('#root')));
    else openLink(o.payUrl);
  };
  let timer;
  async function check(root) {
    try {
      const r = await post(`/orders/${id}/check`);
      o = r.order; setState(r.state); window.__S = r.state;
      if (o.status !== 'pending') { clearInterval(timer); paint(root); }
    } catch { /* retry on next tick */ }
  }
  return {
    html: o.status === 'pending' ? waiting(S, o, o.expiresAt - Date.now(), total, '') : '<main class="app"></main>',
    mount(el) {
      const root = el.parentElement;
      if (o.status !== 'pending') { check(root).then(() => paint(root)); return; }
      const bind = () => {
        root.querySelector('#chk')?.addEventListener('click', async (e) => { e.currentTarget.disabled = true; await check(root); const b = root.querySelector('#chk'); if (b) b.disabled = false; });
        root.querySelector('#reopen')?.addEventListener('click', openPay);
        root.querySelector('#cancel')?.addEventListener('click', async () => { clearInterval(timer); o = await post(`/orders/${id}/cancel`); paint(root); });
      };
      paint(root); bind();
      if (query.open) openPay();
      let n = 0;
      timer = setInterval(async () => {
        if (!root.querySelector('#tm')) return clearInterval(timer);
        const left = o.expiresAt - Date.now();
        if (left <= 0) { o.status = 'expired'; clearInterval(timer); return paint(root); }
        root.querySelector('#tm').textContent = mmss(left);
        root.querySelector('#tf').style.width = `${Math.round((left / total) * 100)}%`;
        if (++n % 2 === 0) await check(root);
      }, 1000);
    },
  };
}
