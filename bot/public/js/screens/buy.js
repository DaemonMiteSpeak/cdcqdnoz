import { esc, icon, bar, rub, dmy, days, plural, toast, num } from '../ui.js';
import { post, HttpError } from '../api.js';
import { go } from '../app.js';

const perDay = (p, d) => { const v = p / d; return `${Number.isInteger(v) ? '' : '≈'}${Math.round(v)} ₽/день`; };

export default async function buy({ S, query }) {
  let tab = query.tab === 'hwid' ? 'hwid' : 'sub';
  let plan = 30;
  let pack = 3;
  let promo = query.promo ? { code: query.promo } : null;
  let promoOpen = false;
  let promoErr = '';
  let q = null;

  const quote = async () => {
    try { q = await post('/quote', { kind: tab, item: tab === 'sub' ? plan : pack, promo: promo?.code }); } catch (e) { if (e instanceof HttpError && e.code === 'promo_not_found') { promo = null; promoErr = 'Промокод не найден'; q = await post('/quote', { kind: tab, item: tab === 'sub' ? plan : pack }); } else throw e; }
  };
  await quote();

  const promoBlock = () => promo
    ? `<div class="stack"><div class="field promo ok">${icon('ticket')}<span class="code mono">${esc(promo.code)}</span><span class="pill ok">−${q.pct}%</span><button class="x" id="unpromo" aria-label="Убрать">${icon('x')}</button></div>
        <p class="hint ok">Промокод ${esc(promo.code)} применён — скидка ${q.pct}%</p></div>`
    : `<div class="stack"><div class="field promo ${promoErr ? 'err' : ''}">${icon('ticket')}<input id="pin" placeholder="Промокод, если есть" autocomplete="off" autocapitalize="off" maxlength="16"><button class="btn-sm" id="papply" disabled>Применить</button></div>${promoErr ? `<p class="hint bad">${promoErr}</p>` : ''}</div>`;

  const view = () => {
    const subTab = `<div class="seg"><button class="seg-b ${tab === 'sub' ? 'on' : ''}" data-tab="sub">${icon('clock')}Подписка</button><button class="seg-b ${tab === 'hwid' ? 'on' : ''}" data-tab="hwid">${icon('reset')}Сброс HWID</button></div>`;
    const meta = tab === 'sub' ? (S.sub.active ? `осталось ${days(S.sub.daysLeft)}` : 'подписка не активна') : `сбросов: ${S.hwid.resets}`;
    let body;
    if (tab === 'sub') {
      body = `<section class="sec"><div class="sec-head"><div><span class="s-t">Срок подписки</span><span class="s-d">дни прибавятся к оставшимся</span></div></div>
        <div class="plans">${S.catalog.plans.map((p) => `<button class="plan ${p.days === plan ? 'on' : ''}" data-plan="${p.days}"><span class="plan-d">${days(p.days)}</span><span class="plan-p"><b>${rub(p.price)}</b><i>${perDay(p.price, p.days)}</i></span><span class="radio ${p.days === plan ? 'on' : ''}"></span></button>`).join('')}</div></section>
        ${promoBlock()}
        <div class="field rows"><div class="row"><span class="k">Будет активна до</span><span class="v">${dmy(q.activeUntil)}</span></div>${q.discount ? `<div class="row"><span class="k">Скидка по промокоду</span><span class="v ok">−${rub(q.discount)}</span></div>` : ''}</div>`;
    } else {
      body = `<section class="sec"><div class="sec-head"><div><span class="s-t">Сброс HWID</span><span class="s-d">отвязывает Hider от старого ПК</span></div><span class="s-r">есть ${S.hwid.resets}</span></div>
        <div class="opts">${S.catalog.hwidPacks.map((p) => `<button class="opt ${p.count === pack ? 'on' : ''}" data-pack="${p.count}"><span class="radio ${p.count === pack ? 'on' : ''}"></span><span class="opt-text"><b>${p.count} ${plural(p.count, 'сброс', 'сброса', 'сбросов')}</b><i>${p.count === 1 ? `${p.price} ₽ за сброс` : `${Number.isInteger(p.price / p.count) ? '' : '≈'}${Math.round(p.price / p.count)} ₽ за сброс`}</i></span><span class="opt-price">${rub(p.price)}</span></button>`).join('')}</div></section>
        ${promoBlock()}
        <div class="field rows"><div class="row"><span class="k">Станет сбросов</span><span class="v">${q.resetsAfter}</span></div></div>`;
    }
    return `<main class="app">${bar({ title: 'Покупка', meta })}${subTab}${body}
      <button class="btn" id="go">${icon('arrowRight')}<span>К оплате · ${rub(q.total)}</span></button></main>`;
  };

  return {
    html: view(),
    mount(el) {
      const root = el.parentElement;
      const paint = async () => { await quote(); root.innerHTML = view(); bind(); };
      const bind = () => {
        root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; promoErr = ''; paint(); }));
        root.querySelectorAll('[data-plan]').forEach((b) => b.addEventListener('click', () => { plan = Number(b.dataset.plan); paint(); }));
        root.querySelectorAll('[data-pack]').forEach((b) => b.addEventListener('click', () => { pack = Number(b.dataset.pack); paint(); }));
        const pin = root.querySelector('#pin');
        const ap = root.querySelector('#papply');
        pin?.addEventListener('input', () => { ap.disabled = !pin.value.trim(); ap.style.opacity = pin.value.trim() ? 1 : ''; });
        const apply = async () => { promoErr = ''; promo = { code: pin.value.trim() }; await paint(); };
        ap?.addEventListener('click', apply);
        pin?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && pin.value.trim()) apply(); });
        root.querySelector('#unpromo')?.addEventListener('click', () => { promo = null; paint(); });
        root.querySelector('#go').addEventListener('click', () => go(`/pay?kind=${tab}&item=${tab === 'sub' ? plan : pack}${promo ? `&promo=${encodeURIComponent(promo.code)}` : ''}`));
      };
      bind();
    },
  };
}
