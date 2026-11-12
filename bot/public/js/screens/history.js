import { esc, icon, bar, rubK, dmy, hm } from '../ui.js';
import { get } from '../api.js';

const ST = { pending: ['на проверке', 'warn'], paid: ['выплачено', 'ok'], rejected: ['отклонено', 'bad'] };
const WH = { card: 'Карта РФ', funpay: 'FunPay', crypto: 'USDT' };
const mask = (m, d) => (m === 'card' ? `•••• ${d.slice(-4)}` : m === 'funpay' ? d : `${d.slice(0, 6)}…${d.slice(-4)}`);

export default async function history() {
  const { items } = await get('/withdrawals');
  return {
    html: `<main class="app">${bar({ title: 'История выводов', meta: `${items.length} шт.` })}
      <div class="field vlist">${items.length ? items.map((w) => `<div class="vrow"><div class="vt"><b>${WH[w.method]} · ${esc(mask(w.method, w.details))}</b><span>${dmy(w.created_at)} ${hm(w.created_at)}${w.note ? ` · ${esc(w.note)}` : ''}</span></div>
        <div class="vr"><b>${rubK(w.amount_k)}</b><span class="pill ${ST[w.status][1]}">${ST[w.status][0]}</span></div></div>`).join('') : '<p class="empty">Заявок пока нет</p>'}</div>
      <p class="foot-note">Заявки проверяют вручную, обычно в течение 24 часов. Статус приходит в бот</p>
      <button class="btn ghost" data-go="/withdraw">Назад к выводу</button></main>`,
  };
}
