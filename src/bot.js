import { Bot, InlineKeyboard } from 'grammy';
import { config } from './config.js';
import { db, kvSet } from './db.js';
import {
  notifier, getUser, upsertUser, setGate, settleOrder, getOrder, reviewVideo, reviewWithdrawal, fmtRub, rub, ApiError,
} from './service.js';
import { setBotApi } from './payments.js';

export function createBot() {
  if (!config.botToken) return null;
  const bot = new Bot(config.botToken);
  setBotApi(bot.api);
  notifier.send = (uid, text) => bot.api.sendMessage(uid, text);

  const isAdmin = (ctx) => config.admins.includes(ctx.from?.id);
  const kb = () => new InlineKeyboard().webApp('Открыть Hider', config.webappUrl);

  bot.command('start', async (ctx) => {
    upsertUser(ctx.from);
    await ctx.reply('Hider — личный кабинет: подписка, запуск, теги, медиа и заработок.', config.webappUrl ? { reply_markup: kb() } : undefined);
  });

  bot.on('pre_checkout_query', async (ctx) => {
    const id = Number(String(ctx.preCheckoutQuery.invoice_payload).replace('order:', ''));
    const o = getOrder(id);
    const ok = o && o.status === 'pending' && o.expires_at > Date.now() && o.user_id === ctx.from.id;
    await ctx.answerPreCheckoutQuery(!!ok, ok ? undefined : 'Счёт недействителен или время вышло');
  });

  bot.on('message:successful_payment', async (ctx) => {
    const id = Number(String(ctx.message.successful_payment.invoice_payload).replace('order:', ''));
    settleOrder(id, { by: 'stars' });
  });

  /* ----- admin ----- */
  const guard = (fn) => async (ctx) => {
    if (!isAdmin(ctx)) return;
    try {
      await fn(ctx, ctx.match?.trim().split(/\s+/).filter(Boolean) || []);
    } catch (e) {
      await ctx.reply(e instanceof ApiError ? `Ошибка: ${e.code}` : `Ошибка: ${e.message}`);
    }
  };

  bot.command('admin', guard((ctx) => ctx.reply([
    '/orders — ожидающие заказы', '/confirm <id> — подтвердить оплату (СБП/FunPay)',
    '/grant <uid> <дней> — выдать подписку', '/media <uid> on|off — статус Медиа',
    '/videos — ролики на проверке', '/video <id> <просмотры> | /video <id> no [причина]',
    '/withdrawals — заявки на вывод', '/wpay <id> [заметка] | /wno <id> [причина]',
    '/maintenance on [минут]|off', '/user <uid>',
  ].join('\n'))));

  bot.command('orders', guard(async (ctx) => {
    const rows = db.prepare("SELECT * FROM orders WHERE status='pending' AND expires_at>? ORDER BY id DESC LIMIT 30").all(Date.now());
    await ctx.reply(rows.length ? rows.map((o) => `№${o.id} · ${o.method} · ${o.kind}:${o.item} · ${o.amount_rub} ₽ · uid ${o.user_id}`).join('\n') : 'Нет ожидающих заказов');
  }));

  bot.command('confirm', guard(async (ctx, [id]) => {
    const o = settleOrder(Number(id), { by: String(ctx.from.id) });
    await ctx.reply(`Заказ №${o.id} оплачен`);
  }));

  bot.command('grant', guard(async (ctx, [uid, days]) => {
    const u = getUser(Number(uid));
    if (!u) throw new ApiError(404, 'user_not_found');
    const d = Number(days);
    const until = Math.max(Date.now(), u.sub_until) + d * 86400000;
    db.prepare('UPDATE users SET sub_until=?, sub_total_days=? WHERE id=?').run(until, Math.ceil((until - Date.now()) / 86400000), u.id);
    await ctx.reply(`Подписка uid ${u.id} продлена на ${d} дн.`);
  }));

  bot.command('media', guard(async (ctx, [uid, mode]) => {
    const u = getUser(Number(uid));
    if (!u) throw new ApiError(404, 'user_not_found');
    db.prepare('UPDATE users SET media_status=? WHERE id=?').run(mode === 'on' ? 1 : 0, u.id);
    await ctx.reply(`Статус Медиа для ${u.id}: ${mode === 'on' ? 'выдан' : 'снят'}`);
  }));

  bot.command('videos', guard(async (ctx) => {
    const rows = db.prepare("SELECT * FROM videos WHERE status='pending' ORDER BY id LIMIT 30").all();
    await ctx.reply(rows.length ? rows.map((v) => `№${v.id} · ${v.platform} · uid ${v.user_id}\n${v.url}`).join('\n\n') : 'Нет роликов на проверке', { link_preview_options: { is_disabled: true } });
  }));

  bot.command('video', guard(async (ctx, [id, arg, ...rest]) => {
    const v = arg === 'no' ? reviewVideo(Number(id), { reject: true, note: rest.join(' ') }) : reviewVideo(Number(id), { views: Number(arg) });
    await ctx.reply(`Ролик №${v.id}: ${v.status}${v.payout_k ? ` · ${fmtRub(rub(v.payout_k))}` : ''}`);
  }));

  bot.command('withdrawals', guard(async (ctx) => {
    const rows = db.prepare("SELECT * FROM withdrawals WHERE status='pending' ORDER BY id LIMIT 30").all();
    await ctx.reply(rows.length ? rows.map((w) => `№${w.id} · ${fmtRub(rub(w.amount_k))} · ${w.method}\n${w.details} · uid ${w.user_id}`).join('\n\n') : 'Нет заявок');
  }));
  bot.command('wpay', guard(async (ctx, [id, ...note]) => { reviewWithdrawal(Number(id), { approve: true, note: note.join(' ') }); await ctx.reply('Выплачено'); }));
  bot.command('wno', guard(async (ctx, [id, ...note]) => { reviewWithdrawal(Number(id), { approve: false, note: note.join(' ') }); await ctx.reply('Отклонено'); }));

  bot.command('maintenance', guard(async (ctx, [mode, minutes]) => {
    const min = Number(minutes) || 0;
    kvSet('maintenance', mode === 'on' ? '1' : '0');
    kvSet('maintenance_until', mode === 'on' && min ? Date.now() + min * 60000 : 0);
    await ctx.reply(`Технические работы: ${mode === 'on' ? `включены${min ? ` на ${min} мин` : ''}` : 'выключены'}`);
  }));

  bot.command('user', guard(async (ctx, [uid]) => {
    const u = getUser(Number(uid));
    await ctx.reply(u ? JSON.stringify({ ...u, photo_url: undefined }, null, 1) : 'Не найден');
  }));

  bot.catch((e) => console.error('bot error', e.message));
  return bot;
}

export async function checkChannel(api, userId) {
  const m = await api.getChatMember(config.channel, userId);
  return ['creator', 'administrator', 'member', 'restricted'].includes(m.status) && (m.status !== 'restricted' || m.is_member);
}

export async function setupMenu(bot) {
  if (!config.webappUrl) return;
  await bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Hider', web_app: { url: config.webappUrl } } });
  await bot.api.setMyCommands([{ command: 'start', description: 'Открыть Hider' }]);
}

export { setGate };
