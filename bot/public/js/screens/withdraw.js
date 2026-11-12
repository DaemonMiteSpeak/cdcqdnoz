import { esc, icon, bar, rub, rubK, dmy, hm, num, toast } from '../ui.js';
import { get, post, HttpError } from '../api.js';
import { go, setState } from '../app.js';

const OPTS = [
  ['card', 'mir', 'Карта РФ', 'любой банк России', 'Номер карты', '2202 2061 •••• 4417', 'num'],
  ['funpay', 'funpay', 'FunPay', 'на баланс аккаунта', 'Ник на FunPay', 'username', 'text'],
  ['crypto', 'usdt', 'Криптой', 'USDT · TRC-20 или TON', 'Адрес USDT · TRC-20 или TON', 'TQn9Y2kH…e7xKpL', 'text'],
];
const fmtCard = (v) => v.replace(/\D/g, '').slice(0, 19).replace(/(.{4})/g, '$1 ').trim();

export default async function withdraw({ S }) {
  const bal = S.media.balanceK / 100;
  let amount = bal >= S.catalog.minWithdraw ? Math.floor(bal) : '';
  let method = 'card';
  let details = '';
  let err = '';
  let sent = null;

  const view = () => {
    if (sent) {
      return `<main class="app">${bar({ title: 'Вывод', meta: `заявка № ${sent.id}` })}<section class="field gate"><div class="res center"><span class="res-ico ok">${icon('check')}</span><h1 class="res-t">Заявка отправлена</h1>
        <p class="res-d">Проверим вручную — обычно в течение 24 часов. Статус придёт в бот</p></div></section>
        <div class="field rows"><div class="row"><span class="k">Сумма</span><span class="v">${rub(sent.amount)}</span></div><div class="row"><span class="k">Куда</span><span class="v">${esc(sent.where)}</span></div>
          <div class="row"><span class="k">Статус</span><span class="pill warn">на проверке</span></div></div>
        <div class="foot"><button class="btn" data-go="/withdraw/history">${icon('clock')}<span>История выводов</span></button><button class="btn ghost" data-go="/media">Готово</button></div></main>`;
    }
    const o = OPTS.find((x) => x[0] === method);
    const n = Number(amount) || 0;
    const min = S.catalog.minWithdraw;
    let hint = '';
    if (err) hint = `<p class="hint bad">${err}</p>`;
    else if (n && n < min) hint = `<p class="hint bad">Минимальный вывод — ${rub(min)}. Не хватает ${rub(min - n)}</p>`;
    else if (n > bal) hint = `<p class="hint bad">На балансе только ${rubK(S.media.balanceK)}</p>`;
    const bad = !n || n < min || n > bal || !details.trim();
    return `<main class="app">${bar({ title: 'Вывод', meta: `баланс ${rubK(S.media.balanceK)}`, right: `<button class="btn-sm" data-go="/withdraw/history">${icon('clock')}История</button>` })}
      <section class="sec"><div class="sec-head"><div><span class="s-t">Сумма</span><span class="s-d">минимум ${rub(min)}</span></div></div>
        <div class="stack"><div class="field amt ${hint && !err ? 'err' : ''}"><span class="amt-w"><span class="amt-m">${amount === '' ? '0' : num(amount)}</span><input id="amt" inputmode="numeric" placeholder="0" value="${amount === '' ? '' : num(amount)}"></span><b>₽</b><button class="btn-sm lit" id="all">Всё</button></div>${hint}</div></section>
      <section class="sec"><span class="s-t pad">Куда вывести</span><div class="opts">
        ${OPTS.map(([id, logo, t, d]) => `<button class="opt ${method === id ? 'on' : ''}" data-m="${id}"><span class="lg-tile"><img src="/img/${logo}.png" alt=""></span><span class="opt-text"><b>${t}</b><i>${d}</i></span><span class="radio ${method === id ? 'on' : ''}"></span></button>`).join('')}</div></section>
      <div class="field det"><i>${o[4]}</i><input id="det" class="mono" style="letter-spacing:.02em" ${o[6] === 'num' ? 'inputmode="numeric"' : ''} placeholder="${o[5]}" autocomplete="off" value="${esc(details)}"></div>
      <div class="foot"><button class="btn" id="send" ${bad ? 'disabled' : ''}>${icon('arrowUpRight')}<span>Вывести ${n ? rub(n) : ''}</span></button><p class="foot-note">Заявку проверим вручную — статус придёт в бот</p></div></main>`;
  };

  return {
    html: view(),
    mount(el) {
      const root = el.parentElement;
      const bind = () => {
        const amt = root.querySelector('#amt');
        const det = root.querySelector('#det');
        const sync = () => {
          amount = amt.value.replace(/\D/g, ''); details = det.value; err = '';
          const keep = [amt.selectionStart];
          root.innerHTML = view(); bind();
          const f = root.querySelector(document.activeElement?.id === 'det' ? '#det' : '#amt');
        };
        const refresh = (focusId) => { root.innerHTML = view(); bind(); const f = root.querySelector(`#${focusId}`); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } };
        amt.addEventListener('input', () => { amount = amt.value.replace(/\D/g, ''); err = ''; refresh('amt'); });
        det.addEventListener('input', () => { details = method === 'card' ? fmtCard(det.value) : det.value.trim(); err = ''; refresh('det'); });
        root.querySelector('#all').addEventListener('click', () => { amount = Math.floor(bal) || ''; err = ''; refresh('amt'); });
        root.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => { method = b.dataset.m; details = ''; err = ''; root.innerHTML = view(); bind(); }));
        root.querySelector('#send').addEventListener('click', async (e) => {
          e.currentTarget.disabled = true;
          try {
            const r = await post('/withdrawals', { method, details, amount: Number(amount) });
            setState(r.state);
            const where = method === 'card' ? `•••• ${details.replace(/\s/g, '').slice(-4)}` : method === 'funpay' ? `FunPay · ${details}` : `${details.slice(0, 6)}…${details.slice(-4)}`;
            sent = { id: r.id, amount: Number(amount), where }; root.innerHTML = view(); bind();
          } catch (er) {
            err = ({ below_min: `Минимальный вывод — ${rub(S.catalog.minWithdraw)}`, over_balance: `На балансе только ${rubK(er.body?.balanceK ?? 0)}`, bad_details: method === 'card' ? 'Проверь номер карты' : method === 'funpay' ? 'Проверь ник FunPay' : 'Проверь адрес кошелька', no_media_status: 'Вывод доступен только со статусом Медиа' })[er.code] || 'Не удалось отправить заявку';
            root.innerHTML = view(); bind();
          }
        });
      };
      bind();
    },
  };
}
