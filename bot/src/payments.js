import { config } from './config.js';
import { db } from './db.js';
import { settleOrder, getOrder } from './service.js';

let botApi = null;
export const setBotApi = (api) => { botApi = api; };

const LABELS = { sub: 'Подписка Hider', hwid: 'Сброс HWID', tag: 'Тег профиля' };

async function cryptoCall(method, body) {
  const r = await fetch(`${config.cryptoBotApi}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Crypto-Pay-API-Token': config.cryptoBotToken },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`cryptobot ${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}

export async function startPayment(order) {
  const title = `${LABELS[order.kind]} · №${order.id}`;
  let url = null;
  let extId = null;
  if (order.method === 'stars') {
    if (!botApi) throw new Error('bot_unavailable');
    const stars = Math.max(1, Math.ceil(order.amount_rub / config.rubPerStar));
    url = await botApi.createInvoiceLink(title, `Заказ №${order.id}`, `order:${order.id}`, '', 'XTR', [{ label: title, amount: stars }]);
  } else if (order.method === 'cryptobot') {
    const inv = await cryptoCall('createInvoice', {
      currency_type: 'fiat', fiat: 'RUB', accepted_assets: 'USDT,TON,BTC',
      amount: String(order.amount_rub), description: title, payload: String(order.id),
      expires_in: config.orderTtlMin * 60,
    });
    url = inv.mini_app_invoice_url || inv.bot_invoice_url;
    extId = String(inv.invoice_id);
  } else if (order.method === 'sbp') {
    if (config.sbpUrlTemplate) {
      url = config.sbpUrlTemplate.replaceAll('{order}', order.id).replaceAll('{amount}', order.amount_rub);
    }
  } else if (order.method === 'funpay') {
    url = config.funpayLotUrl;
  }
  db.prepare('UPDATE orders SET pay_url=?, ext_id=? WHERE id=?').run(url, extId, order.id);
  return getOrder(order.id);
}

/** Polls the provider (where it has an API) and settles the order when paid. */
export async function checkPayment(order) {
  if (order.status !== 'pending') return order;
  if (order.method === 'cryptobot' && order.ext_id) {
    const res = await cryptoCall('getInvoices', { invoice_ids: order.ext_id });
    const inv = res.items?.[0];
    if (inv?.status === 'paid') return settleOrder(order.id, { by: 'cryptobot' });
  }
  return getOrder(order.id);
}

export function startPayments() {
  if (!config.cryptoBotToken) return;
  setInterval(async () => {
    const rows = db.prepare("SELECT * FROM orders WHERE status='pending' AND method='cryptobot' AND ext_id IS NOT NULL AND expires_at>?").all(Date.now());
    for (const o of rows) await checkPayment(o).catch(() => {});
  }, 20000).unref();
}
