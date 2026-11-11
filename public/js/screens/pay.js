import { esc, icon, bar, rub, dmy, plural, toast, openLink } from '../ui.js';
import { post, HttpError } from '../api.js';
import { go } from '../app.js';

const METHODS = [
  ['sbp', 'sbp', 'СБП и карта', 'рубли · любой банк РФ'],
  ['cryptobot', 'cryptobot', 'CryptoBot', 'USDT, TON, BTC'],
  ['funpay', 'funpay', 'FunPay', 'покупка через лот'],
  ['stars', 'stars', 'Telegram Stars', 'звёздами прямо в боте'],
];

export default async function pay({ S, query }) {
  const { kind, item, promo } = query;
  const q = await post('/quote', { kind, item, promo });
  const avail = S.methods;
  let method = METHODS.map((m) => m[0]).find((m) => avail[m]) || 'sbp';
  const tagName = kind === 'tag' ? S.catalog.tags.find((t) => t.id === item)?.title : '';
  const title = kind === 'sub' ? `Подписка на ${item} ${plural(Number(item), 'день', 'дня', 'дней')}` : kind === 'hwid' ? `${item} ${plural(Number(item), 'сброс', 'сброса', 'сбросов')} HWID` : `Тег «${tagName}»`;
  const sub = kind === 'sub' ? `будет активна до ${dmy(q.activeUntil)}` : kind === 'hwid' ? `станет ${q.resetsAfter} ${plural(q.resetsAfter, 'сброс', 'сброса', 'сбросов')} в профиле` : 'сразу появится в «Моих тегах»';

  const view = () => `<main class="app">${bar({ title: 'Оплата' })}
    <div class="field order-card"><div class="order"><div><span class="o-t">${esc(title)}</span><span class="o-s">${esc(sub)}</span></div>
      <span class="order-r">${q.discount ? `<s>${rub(q.base)}</s>` : ''}<b>${rub(q.total)}</b></span></div>
      ${q.promo ? `<div class="order-promo">${icon('ticket')}<span>Промокод ${esc(q.promo)}</span><span class="pill ok">−${q.pct}%</span></div>` : ''}</div>
    <section class="sec"><span class="s-t pad">Способ оплаты</span><div class="opts">
      ${METHODS.map(([id, logo, t, d]) => `<button class="opt ${method === id ? 'on' : ''} ${avail[id] ? '' : 'na'}" data-m="${id}" ${avail[id] ? '' : 'disabled'}>
        <span class="lg-tile"><img src="/img/${logo}.png" alt=""></span><span class="opt-text"><b>${t}</b><i>${avail[id] ? d : 'не подключено'}</i></span><span class="radio ${method === id ? 'on' : ''}"></span></button>`).join('')}
    </div></section>
    <div class="foot"><button class="btn" id="go" ${avail[method] ? '' : 'disabled'}>${icon('lock')}<span>Перейти к оплате</span></button>
      <p class="foot-note">Оплачивая, ты принимаешь условия <a data-ext="${esc(S.links.offer)}">оферты</a></p></div></main>`;

  return {
    html: view(),
    mount(el) {
      const root = el.parentElement;
      const bind = () => {
        root.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => { method = b.dataset.m; root.innerHTML = view(); bind(); }));
        root.querySelector('#go').addEventListener('click', async (e) => {
          const btn = e.currentTarget; btn.disabled = true;
          try {
            const o = await post('/orders', { kind, item, promo: q.promo, method });
            go(`/order/${o.id}?open=1`, { replace: true });
          } catch (er) {
            btn.disabled = false;
            toast(er instanceof HttpError && er.code === 'promo_not_found' ? 'Промокод не найден' : 'Не удалось создать счёт — попробуй ещё раз');
          }
        });
      };
      bind();
    },
  };
}
