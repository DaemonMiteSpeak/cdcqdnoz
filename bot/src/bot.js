import { Bot } from 'grammy';
import { config } from './config.js';
import { db } from './db.js';
import {
  notifier, upsertUser, setGate, settleOrder, getOrder, escHtml, isAdmin, adminIds,
} from './service.js';
import { setBotApi } from './payments.js';
import { registerAdmin, sendToAdmins } from './admin.js';

const HELLO_EMOJI = '5339441129785929529'; // премиум-эмодзи рядом с приветствием
const BUTTON_EMOJI = '5402406965252989103'; // премиум-эмодзи на кнопке

/* Премиум-эмодзи Telegram принимает не у каждого бота (нужен Premium у владельца или юзернеймы на Fragment).
   Если отправка с ними не прошла, пробуем упрощённые варианты и запоминаем рабочий. */
const VARIANTS = [{ te: true, ic: true }, { te: false, ic: true }, { te: true, ic: false }, { te: false, ic: false }];
let best = 0;
let bestAt = 0;

function welcome(user, v, admin) {
  const name = escHtml(user.first_name || user.username || 'друг');
  const head = v.te ? `<tg-emoji emoji-id="${HELLO_EMOJI}">👋</tg-emoji>` : '👋';
  const text = `${head} <b>Привет, ${name}!</b>\n\n<blockquote>Нажми на кнопку ниже, чтобы пользоваться ботом.</blockquote>`;
  const rows = [];
  if (config.webappUrl) {
    rows.push([{ text: 'Открыть Hider', web_app: { url: config.webappUrl }, style: 'success', ...(v.ic ? { icon_custom_emoji_id: BUTTON_EMOJI } : {}) }]);
  }
  if (admin) rows.push([{ text: '🛠 Админ-панель', callback_data: 'a:home' }]);
  return { text, reply_markup: rows.length ? { inline_keyboard: rows } : undefined };
}

export async function sendWelcome(api, chatId, user) {
  if (Date.now() - bestAt > 3600000) best = 0;
  const admin = isAdmin(user.id);
  let lastErr;
  for (let i = best; i < VARIANTS.length; i++) {
    const { text, reply_markup } = welcome(user, VARIANTS[i], admin);
    try {
      await api.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup });
      if (i !== best || !bestAt) console.log(`welcome variant ${i} (${JSON.stringify(VARIANTS[i])})`);
      best = i; bestAt = Date.now();
      return;
    } catch (e) {
      lastErr = e;
      if (e.error_code !== 400) throw e;
      console.warn(`welcome variant ${i} rejected: ${e.description}`);
    }
  }
  throw lastErr;
}

export function createBot() {
  if (!config.botToken) return null;
  const bot = new Bot(config.botToken, process.env.TG_API_ROOT ? { client: { apiRoot: process.env.TG_API_ROOT } } : undefined);
  setBotApi(bot.api);
  notifier.admin = (type, text, rows) => sendToAdmins(bot.api, type, text, rows);

  /* забаненных бот не обслуживает */
  const lastWelcome = new Map();
  bot.use(async (ctx, next) => {
    if (ctx.from && !isAdmin(ctx.from.id)) {
      const u = db.prepare('SELECT banned FROM users WHERE id=?').get(ctx.from.id);
      if (u?.banned) return null;
    }
    return next();
  });

  bot.on('my_chat_member', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    db.prepare('UPDATE users SET bot_blocked=? WHERE id=?').run(ctx.myChatMember.new_chat_member.status === 'kicked' ? 1 : 0, ctx.from.id);
  });

  bot.command('start', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    upsertUser(ctx.from);
    db.prepare('UPDATE users SET bot_blocked=0 WHERE id=?').run(ctx.from.id);
    lastWelcome.set(ctx.from.id, Date.now());
    await sendWelcome(ctx.api, ctx.chat.id, ctx.from);
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

  registerAdmin(bot);

  /* единственное сообщение для пользователей — то же приветствие с кнопкой; не чаще раза в 10 секунд */
  bot.on('message', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    if (Date.now() - (lastWelcome.get(ctx.from.id) || 0) < 10000) return;
    lastWelcome.set(ctx.from.id, Date.now());
    upsertUser(ctx.from);
    await sendWelcome(ctx.api, ctx.chat.id, ctx.from);
  });

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
  for (const id of adminIds()) {
    await bot.api.setMyCommands([{ command: 'start', description: 'Открыть Hider' }, { command: 'admin', description: 'Админ-панель' }], { scope: { type: 'chat', chat_id: id } }).catch(() => {});
  }
}

export { setGate };
