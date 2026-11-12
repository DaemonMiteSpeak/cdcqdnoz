// Админ-панель внутри чата: инлайн-кнопки, а где нужен ввод — «ждём ответ» от админа.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { InlineKeyboard, InputFile } from 'grammy';
import { config } from './config.js';
import { db, kvGet, kvSet } from './db.js';
import * as S from './service.js';

const DAY = 86400000;
const TZ = 'Europe/Moscow';
const esc = S.escHtml;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dt = (ms) => (ms ? new Date(ms).toLocaleString('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const dd = (ms) => (ms ? new Date(ms).toLocaleDateString('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
const num = (x) => Number(x || 0).toLocaleString('ru-RU');
const money = (rubles) => S.fmtRub(Number(rubles || 0));
const moneyK = (k) => S.fmtRub(S.rub(k || 0));
const dayStart = () => Math.floor((Date.now() + 3 * 3600000) / DAY) * DAY - 3 * 3600000; // полночь по МСК
const one = (sql, ...p) => db.prepare(sql).get(...p);
const all = (sql, ...p) => db.prepare(sql).all(...p);

const uname = (u) => esc(u.username ? `@${u.username}` : u.first_name || `id${u.id}`);
const NOTIFY_TYPES = {
  user_new: '🆕 Новые пользователи', purchase: '💰 Покупки', key: '🔑 Активации ключей', promo: '🏷 Новые промокоды',
  video: '🎬 Заявки на ролики', withdraw: '💸 Заявки на вывод', hwid: '♻️ Сбросы HWID', error: '⚠️ Ошибки оплаты',
};
const AUDIENCES = {
  all: ['Все пользователи', '1=1'],
  sub: ['С активной подпиской', () => `sub_until>${Date.now()}`],
  nosub: ['Без подписки', () => `sub_until<=${Date.now()}`],
  media: ['Со статусом Медиа', 'media_status=1'],
};
const audSql = (a) => `banned=0 AND bot_blocked=0 AND (${typeof AUDIENCES[a][1] === 'function' ? AUDIENCES[a][1]() : AUDIENCES[a][1]})`;
const audCount = (a) => one(`SELECT COUNT(*) n FROM users WHERE ${audSql(a)}`).n;

const audit = (adminId, action, target = '', info = '') => db.prepare('INSERT INTO admin_log(ts, admin_id, action, target, info) VALUES(?,?,?,?,?)').run(Date.now(), adminId, action, String(target), String(info).slice(0, 300));

/* ---------- уведомления администраторам ---------- */
const offTypes = () => { try { return new Set(JSON.parse(kvGet('adm_off', '[]'))); } catch { return new Set(); } };

export async function sendToAdmins(api, type, text, rows) {
  if (offTypes().has(type)) return;
  const reply_markup = rows ? { inline_keyboard: rows } : undefined;
  await Promise.all(S.adminIds().map((id) => api.sendMessage(id, text, { parse_mode: 'HTML', reply_markup, link_preview_options: { is_disabled: true } }).catch((e) => console.error('admin notify', id, e.message))));
}

/* ---------- состояние диалогов ---------- */
const pending = new Map(); // adminId -> { kind, ...данные }
const drafts = new Map(); // adminId -> { aud, withBtn, chatId, msgId }
const running = new Map(); // broadcastId -> { cancel }

const kbd = () => new InlineKeyboard();
const homeBtn = (kb) => kb.text('🏠 В меню', 'a:home');
const pager = (kb, prefix, page, total, per) => {
  const pages = Math.max(1, Math.ceil(total / per));
  if (pages > 1) {
    if (page > 0) kb.text('‹', `${prefix}:${page - 1}`);
    kb.text(`${page + 1}/${pages}`, 'a:noop');
    if (page < pages - 1) kb.text('›', `${prefix}:${page + 1}`);
    kb.row();
  }
};

/* ---------- экраны ---------- */
function screenHome() {
  const o = one("SELECT COUNT(*) n FROM orders WHERE status='pending' AND expires_at>?", Date.now()).n;
  const v = one("SELECT COUNT(*) n FROM videos WHERE status='pending'").n;
  const w = one("SELECT COUNT(*) n FROM withdrawals WHERE status='pending'").n;
  const badge = (n) => (n ? ` (${n})` : '');
  const kb = kbd()
    .text('📊 Статистика', 'a:stats').text('👥 Пользователи', 'a:u').row()
    .text('🔑 Ключи', 'a:k').text(`🧾 Заказы${badge(o)}`, 'a:ol:p:0').row()
    .text(`🎬 Ролики${badge(v)}`, 'a:v').text(`💸 Выводы${badge(w)}`, 'a:w').row()
    .text('📣 Рассылка', 'a:b').text('🏷 Промокоды', 'a:p').row()
    .text('⚙️ Система', 'a:s').text('👮 Админы', 'a:ad');
  return [`🛠 <b>Админ-панель Hider</b>\n\nВыбери раздел. Ожидают: заказов ${o}, роликов ${v}, выводов ${w}.`, kb];
}

function screenStats() {
  const now = Date.now();
  const t0 = dayStart();
  const rev = (from) => one("SELECT COUNT(*) c, COALESCE(SUM(amount_rub),0) s FROM orders WHERE status='paid' AND paid_at>=?", from);
  const [td, w7, m30, tot] = [rev(t0), rev(now - 7 * DAY), rev(now - 30 * DAY), rev(0)];
  const users = one('SELECT COUNT(*) n FROM users').n;
  const cnt = (where, ...p) => one(`SELECT COUNT(*) n FROM users WHERE ${where}`, ...p).n;
  const byMethod = all("SELECT method, COUNT(*) c, SUM(amount_rub) s FROM orders WHERE status='paid' AND paid_at>=? GROUP BY method ORDER BY s DESC", now - 30 * DAY);
  const keys = one('SELECT SUM(used_by IS NULL) free, SUM(used_by IS NOT NULL) used FROM keys');
  const wd = one("SELECT COUNT(*) c, COALESCE(SUM(amount_k),0) s FROM withdrawals WHERE status='pending'");
  const top = all("SELECT promo_code p, COUNT(*) c, SUM(amount_rub) s FROM orders WHERE status='paid' AND promo_code IS NOT NULL GROUP BY promo_code COLLATE NOCASE ORDER BY s DESC LIMIT 5");
  const text = [
    '📊 <b>Статистика</b>', '',
    `👥 <b>Пользователи:</b> ${num(users)}`,
    `   новых: сегодня ${cnt('created_at>=?', t0)} · за 7 дн. ${cnt('created_at>=?', now - 7 * DAY)} · за 30 дн. ${cnt('created_at>=?', now - 30 * DAY)}`,
    `   с подпиской: ${cnt('sub_until>?', now)} · Медиа: ${cnt('media_status=1')} · в бане: ${cnt('banned=1')}`,
    `   недоступны для рассылки: ${cnt('bot_blocked=1')}`, '',
    '💰 <b>Выручка (оплачено)</b>',
    `   сегодня: ${money(td.s)} (${td.c})`, `   7 дней: ${money(w7.s)} (${w7.c})`, `   30 дней: ${money(m30.s)} (${m30.c})`, `   всего: ${money(tot.s)} (${tot.c})`,
    byMethod.length ? `   по способам за 30 дн.: ${byMethod.map((m) => `${esc(m.method)} ${money(m.s)}`).join(' · ')}` : null, '',
    `🧾 Ждут оплаты: ${one("SELECT COUNT(*) n FROM orders WHERE status='pending' AND expires_at>?", now).n}`,
    `🔑 Ключи: свободных ${keys.free || 0} · использовано ${keys.used || 0}`,
    `🎬 Роликов на проверке: ${one("SELECT COUNT(*) n FROM videos WHERE status='pending'").n}`,
    `💸 Заявок на вывод: ${wd.c} на ${moneyK(wd.s)} · на балансах: ${moneyK(one('SELECT COALESCE(SUM(balance_k),0) s FROM users').s)}`,
    top.length ? `\n🏷 <b>Топ промокодов:</b>\n${top.map((t, i) => `${i + 1}. ${esc(t.p)} — ${money(t.s)} (${t.c})`).join('\n')}` : null,
  ].filter((x) => x !== null).join('\n');
  return [text, homeBtn(kbd().text('🔄 Обновить', 'a:stats'))];
}

function screenUsers() {
  const now = Date.now();
  const c = (w) => one(`SELECT COUNT(*) n FROM users WHERE ${w}`).n;
  const kb = kbd()
    .text('🔍 Найти', 'a:uf').text('🆕 Новые', 'a:ul:r:0').row()
    .text(`💎 С подпиской (${one('SELECT COUNT(*) n FROM users WHERE sub_until>?', now).n})`, 'a:ul:s:0').row()
    .text(`🎬 Медиа (${c('media_status=1')})`, 'a:ul:m:0').text(`🚫 В бане (${c('banned=1')})`, 'a:ul:b:0').row();
  return [`👥 <b>Пользователи</b>\nВсего: ${num(c('1=1'))}\n\nНайти можно по ID или @username.`, homeBtn(kb)];
}

const LIST_MODES = {
  r: ['🆕 Новые пользователи', '1=1', 'created_at DESC'],
  s: ['💎 С подпиской', () => `sub_until>${Date.now()}`, 'sub_until ASC'],
  m: ['🎬 Со статусом Медиа', 'media_status=1', 'created_at DESC'],
  b: ['🚫 В бане', 'banned=1', 'created_at DESC'],
};
function screenUserList(mode, page) {
  const [title, where, order] = LIST_MODES[mode];
  const w = typeof where === 'function' ? where() : where;
  const per = 8;
  const total = one(`SELECT COUNT(*) n FROM users WHERE ${w}`).n;
  const rows = all(`SELECT * FROM users WHERE ${w} ORDER BY ${order} LIMIT ? OFFSET ?`, per, page * per);
  const kb = kbd();
  for (const u of rows) kb.text(`${u.username ? `@${u.username}` : u.first_name || 'без имени'} · ${u.id}${u.sub_until > Date.now() ? ` · до ${dd(u.sub_until)}` : ''}`, `a:u:${u.id}`).row();
  pager(kb, `a:ul:${mode}`, page, total, per);
  kb.text('‹ Пользователи', 'a:u');
  return [`${title}: ${num(total)}`, homeBtn(kb)];
}

function screenUser(id, note = '') {
  const u = S.getUser(Number(id));
  if (!u) return [`Пользователь <code>${esc(id)}</code> не найден`, homeBtn(kbd().text('‹ Пользователи', 'a:u'))];
  const left = S.daysLeft(u);
  const paid = one("SELECT COUNT(*) n, COALESCE(SUM(amount_rub),0) s FROM orders WHERE user_id=? AND status='paid'", u.id);
  const text = [
    `👤 <b>${uname(u)}</b>${u.banned ? ' · 🚫 в бане' : ''}`,
    `ID: <code>${u.id}</code> · с ${dd(u.created_at)}`,
    `Подписка: ${left > 0 ? `до ${dt(u.sub_until)} (${left} дн.)` : 'нет'}`,
    `HWID: <code>${S.hwidCode(u.hwid) || '—'}</code> · сбросов: ${u.hwid_resets}${u.last_reset_at ? ` · последний: ${dt(u.last_reset_at)}` : ''}`,
    `Запусков: ${u.launches}${u.last_launch_at ? ` · последний: ${dt(u.last_launch_at)}` : ''}`,
    `Тег: ${esc(u.tag)} · гейт: ${u.gate_ok ? '✅' : '❌'} · бот: ${u.bot_blocked ? '🚫 недоступен' : 'ок'}`,
    `Медиа: ${u.media_status ? 'да' : 'нет'}${u.promo_code ? ` · промокод ${esc(u.promo_code)}` : ''}`,
    `Баланс: ${moneyK(u.balance_k)} · заработано ${moneyK(u.earned_k)} · выведено ${moneyK(u.withdrawn_k)}`,
    `Оплачено заказов: ${paid.n} на ${money(paid.s)}`,
    note ? `\n${note}` : null,
  ].filter((x) => x !== null).join('\n');
  const kb = kbd()
    .text('+3 дн.', `a:ug:${u.id}:3`).text('+7 дн.', `a:ug:${u.id}:7`).text('+30 дн.', `a:ug:${u.id}:30`).row()
    .text('−7 дн.', `a:ug:${u.id}:-7`).text('✏️ Свой срок', `a:ugc:${u.id}`).text('Обнулить', `a:ug:${u.id}:0`).row()
    .text('♻️ Сбросить HWID', `a:uh:${u.id}`).text('+1 сброс', `a:ur:${u.id}`).row()
    .text(u.media_status ? '🎬 Снять Медиа' : '🎬 Выдать Медиа', `a:um:${u.id}`).text(u.banned ? '✅ Разбанить' : '🚫 Забанить', `a:ub:${u.id}`).row()
    .text('✉️ Написать', `a:uw:${u.id}`).text('🧾 Заказы', `a:uo:${u.id}`).row()
    .text('‹ Пользователи', 'a:u');
  return [text, homeBtn(kb)];
}

function screenKeys() {
  const free = all('SELECT days, COUNT(*) c FROM keys WHERE used_by IS NULL GROUP BY days ORDER BY days');
  const used = one('SELECT COUNT(*) n FROM keys WHERE used_by IS NOT NULL').n;
  const kb = kbd().text('➕ Создать ключи', 'a:kn').row().text('📋 Свободные', 'a:kl:u:0').text('✅ Использованные', 'a:kl:a:0').row().text('🗑 Удалить ключ', 'a:kx');
  return [`🔑 <b>Ключи</b> · формат HIDER-XXXX-XXXX-XXXX\n\nСвободные: ${free.length ? free.map((f) => `${f.days} дн. × ${f.c}`).join(' · ') : 'нет'}\nИспользовано: ${used}`, homeBtn(kb)];
}

function screenKeyDays() {
  const kb = kbd();
  [1, 3, 7, 14, 30, 90, 365].forEach((d, i) => { kb.text(`${d} дн.`, `a:kd:${d}`); if (i % 4 === 3) kb.row(); });
  kb.row().text('✏️ Свой срок', 'a:kdd').row().text('‹ Ключи', 'a:k');
  return ['🔑 На сколько дней создать ключи?', kb];
}

function screenKeyCount(days) {
  const kb = kbd();
  [1, 5, 10, 25, 50].forEach((c) => kb.text(`× ${c}`, `a:kc:${days}:${c}`));
  kb.row().text('✏️ Своё количество', `a:kcc:${days}`).row().text('‹ Срок', 'a:kn');
  return [`🔑 Ключи на <b>${days} дн.</b> — сколько создать?`, kb];
}

function screenKeysCreated(days, count) {
  const codes = S.createKeys(days, count);
  return [`✅ Создано ключей: ${count} · по ${days} дн.\n\n${codes.map((c) => `<code>${c}</code>`).join('\n')}\n\nНажми на ключ, чтобы скопировать.`, homeBtn(kbd().text('➕ Ещё', 'a:kn').text('‹ Ключи', 'a:k'))];
}

function screenKeyList(mode, page) {
  const per = 20;
  const where = mode === 'u' ? 'used_by IS NULL' : 'used_by IS NOT NULL';
  const total = one(`SELECT COUNT(*) n FROM keys WHERE ${where}`).n;
  const rows = all(`SELECT * FROM keys WHERE ${where} ORDER BY ${mode === 'u' ? 'created_at' : 'used_at'} DESC LIMIT ? OFFSET ?`, per, page * per);
  const lines = rows.map((k) => (mode === 'u' ? `<code>${k.code}</code> · ${k.days} дн.` : `<code>${k.code}</code> · ${k.days} дн. · uid ${k.used_by} · ${dt(k.used_at)}`));
  const kb = kbd();
  pager(kb, `a:kl:${mode}`, page, total, per);
  kb.text('‹ Ключи', 'a:k');
  return [`${mode === 'u' ? '📋 Свободные ключи' : '✅ Использованные ключи'}: ${total}\n\n${lines.join('\n') || 'Пусто'}`, homeBtn(kb)];
}

const ORDER_FILTERS = {
  p: ['⏳ Ожидают оплаты', () => `status='pending' AND expires_at>${Date.now()}`],
  d: ['✅ Оплаченные', () => "status='paid'"],
  c: ['🚫 Отменённые и истёкшие', () => `status IN ('cancelled','expired') OR (status='pending' AND expires_at<=${Date.now()})`],
  a: ['Все заказы', () => '1=1'],
};
const ORDER_ICON = { paid: '✅', pending: '⏳', cancelled: '🚫', expired: '⌛' };
const orderLabel = (o) => ({ sub: `подписка ${o.item} дн.`, hwid: `сбросы × ${o.item}`, tag: `тег ${o.item}` }[o.kind] || o.kind);

function screenOrderList(f, page) {
  const [title, where] = ORDER_FILTERS[f];
  const w = where();
  const per = 8;
  const total = one(`SELECT COUNT(*) n FROM orders WHERE ${w}`).n;
  const rows = all(`SELECT * FROM orders WHERE ${w} ORDER BY id DESC LIMIT ? OFFSET ?`, per, page * per);
  const kb = kbd();
  Object.entries(ORDER_FILTERS).forEach(([k, [t]]) => kb.text(k === f ? `• ${t.split(' ')[0]}` : t.split(' ')[0], `a:ol:${k}:0`));
  kb.row();
  rows.forEach((o, i) => { kb.text(`№${o.id}`, `a:o:${o.id}`); if (i % 4 === 3) kb.row(); });
  if (rows.length % 4) kb.row();
  pager(kb, `a:ol:${f}`, page, total, per);
  const lines = rows.map((o) => `${ORDER_ICON[o.status] || '•'} №${o.id} · ${esc(orderLabel(o))} · ${money(o.amount_rub)} · ${esc(o.method || '—')} · uid ${o.user_id}`);
  return [`🧾 <b>${title}</b>: ${num(total)}\n\n${lines.join('\n') || 'Пусто'}`, homeBtn(kb)];
}

function screenOrder(id) {
  const o = S.getOrder(Number(id));
  if (!o) return ['Заказ не найден', homeBtn(kbd().text('‹ Заказы', 'a:ol:p:0'))];
  const u = S.getUser(o.user_id);
  const text = [
    `🧾 <b>Заказ №${o.id}</b> ${ORDER_ICON[o.status] || ''} ${o.status}`,
    `${esc(orderLabel(o))} · ${money(o.amount_rub)}${o.base_rub !== o.amount_rub ? ` (без скидки ${money(o.base_rub)})` : ''}`,
    `Способ: ${esc(o.method || '—')}${o.promo_code ? ` · промокод ${esc(o.promo_code)}` : ''}`,
    `Создан: ${dt(o.created_at)} · истекает: ${dt(o.expires_at)}${o.paid_at ? ` · оплачен: ${dt(o.paid_at)}` : ''}`,
    o.ext_id ? `Внешний ID: <code>${esc(o.ext_id)}</code>` : null,
    o.note ? `Заметка: ${esc(o.note)}` : null,
    u ? `👤 ${S.userRef(u)} · <code>${u.id}</code>` : null,
  ].filter(Boolean).join('\n');
  const kb = kbd();
  if (o.status === 'pending') kb.text('✅ Подтвердить оплату', `a:oc:${o.id}`).text('🚫 Отменить', `a:ox:${o.id}`).row();
  if (u) kb.text('👤 Пользователь', `a:u:${u.id}`).row();
  kb.text('‹ Заказы', 'a:ol:p:0');
  return [text, homeBtn(kb)];
}

function screenVideos() {
  const rows = all("SELECT * FROM videos WHERE status='pending' ORDER BY id LIMIT 15");
  const kb = kbd();
  for (const v of rows) kb.text(`№${v.id} · ${v.platform} · uid ${v.user_id}`, `a:v:${v.id}`).row();
  return [`🎬 <b>Ролики на проверке:</b> ${one("SELECT COUNT(*) n FROM videos WHERE status='pending'").n}`, homeBtn(kb)];
}

function screenVideo(id) {
  const v = one('SELECT * FROM videos WHERE id=?', Number(id));
  if (!v) return ['Ролик не найден', homeBtn(kbd().text('‹ Ролики', 'a:v'))];
  const u = S.getUser(v.user_id);
  const text = [
    `🎬 <b>Ролик №${v.id}</b> · ${esc(v.platform)}${v.is_long ? ' · длинный' : ''} · ${esc(v.status)}`,
    esc(v.title || ''), esc(v.url),
    `Опубликован: ${dt(v.published_at)} · заявлен: ${dt(v.created_at)}`,
    `Просмотры: ${v.views ?? '—'} · выплата: ${moneyK(v.payout_k)}`,
    v.note ? `Заметка: ${esc(v.note)}` : null,
    u ? `👤 ${S.userRef(u)} · <code>${u.id}</code>` : null,
  ].filter(Boolean).join('\n');
  const kb = kbd();
  if (v.status === 'pending') {
    kb.text(`✅ Принять (${v.views ?? 0} просм.)`, `a:va:${v.id}`).row().text('✏️ Свои просмотры', `a:vv:${v.id}`).row()
      .text('❌ Отклонить', `a:vr:${v.id}`).text('❌ С причиной', `a:vn:${v.id}`).row();
  }
  kb.text('‹ Ролики', 'a:v');
  return [text, homeBtn(kb)];
}

function screenWithdrawals() {
  const rows = all("SELECT * FROM withdrawals WHERE status='pending' ORDER BY id LIMIT 15");
  const kb = kbd();
  for (const w of rows) kb.text(`№${w.id} · ${moneyK(w.amount_k)} · ${w.method} · uid ${w.user_id}`, `a:w:${w.id}`).row();
  return [`💸 <b>Заявки на вывод:</b> ${one("SELECT COUNT(*) n FROM withdrawals WHERE status='pending'").n}`, homeBtn(kb)];
}

function screenWithdrawal(id) {
  const w = one('SELECT * FROM withdrawals WHERE id=?', Number(id));
  if (!w) return ['Заявка не найдена', homeBtn(kbd().text('‹ Выводы', 'a:w'))];
  const u = S.getUser(w.user_id);
  const text = [
    `💸 <b>Вывод №${w.id}</b> · ${esc(w.status)}`,
    `${moneyK(w.amount_k)} · ${esc(w.method)}`, `<code>${esc(w.details)}</code>`,
    `Создана: ${dt(w.created_at)}`, w.note ? `Заметка: ${esc(w.note)}` : null,
    u ? `👤 ${S.userRef(u)} · <code>${u.id}</code> · баланс ${moneyK(u.balance_k)}` : null,
  ].filter(Boolean).join('\n');
  const kb = kbd();
  if (w.status === 'pending') kb.text('✅ Выплачено', `a:wp:${w.id}`).row().text('❌ Отклонить', `a:wr:${w.id}`).text('❌ С причиной', `a:wn:${w.id}`).row();
  kb.text('‹ Выводы', 'a:w');
  return [text, homeBtn(kb)];
}

function screenPromos() {
  const rows = all("SELECT p.code, p.owner_id, COALESCE(s.c,0) c, COALESCE(s.s,0) s FROM promos p LEFT JOIN (SELECT promo_code, COUNT(*) c, SUM(amount_rub) s FROM orders WHERE status='paid' GROUP BY promo_code COLLATE NOCASE) s ON s.promo_code=p.code COLLATE NOCASE ORDER BY s DESC, p.created_at DESC LIMIT 12");
  const kb = kbd().text('🔍 Найти по коду', 'a:pf').row();
  for (const p of rows) kb.text(`${p.code} · ${money(p.s)} (${p.c})`, `a:p:${p.code}`).row();
  return [`🏷 <b>Промокоды</b> · всего ${one('SELECT COUNT(*) n FROM promos').n}\nТоп по выручке:`, homeBtn(kb)];
}

function screenPromo(code) {
  const p = S.findPromo(code);
  if (!p) return [`Промокод <code>${esc(code)}</code> не найден`, homeBtn(kbd().text('‹ Промокоды', 'a:p'))];
  const o = S.getUser(p.owner_id);
  const st = one("SELECT COUNT(*) c, COALESCE(SUM(amount_rub),0) s FROM orders WHERE promo_code=? COLLATE NOCASE AND status='paid'", p.code);
  const text = [`🏷 <b>${esc(p.code)}</b>`, `Создан: ${dt(p.created_at)}`, o ? `Владелец: ${S.userRef(o)} · <code>${o.id}</code>` : null,
    `Оплаченных заказов: ${st.c} на ${money(st.s)}`, o ? `Заработано: ${moneyK(o.earned_k)} · баланс ${moneyK(o.balance_k)} · выведено ${moneyK(o.withdrawn_k)}` : null].filter(Boolean).join('\n');
  const kb = kbd();
  if (o) kb.text('👤 Владелец', `a:u:${o.id}`).row();
  kb.text('🗑 Удалить промокод', `a:pd:${p.code}`).row().text('‹ Промокоды', 'a:p');
  return [text, homeBtn(kb)];
}

function screenBroadcast() {
  const hist = all('SELECT * FROM broadcasts ORDER BY id DESC LIMIT 1');
  const last = hist[0] ? `\n\nПоследняя: №${hist[0].id} · ${dt(hist[0].created_at)} · доставлено ${hist[0].sent} из ${hist[0].total}` : '';
  const kb = kbd().text('✍️ Новая рассылка', 'a:bn').row().text('📜 История', 'a:bh');
  return [`📣 <b>Рассылка</b>\n\nСообщение уйдёт всем выбранным пользователям от имени бота. Подойдёт любое сообщение: текст, фото, видео, файл, премиум-эмодзи — копия сохранит оформление.${last}`, homeBtn(kb)];
}

function screenBroadcastAudience() {
  const kb = kbd();
  for (const [k, [title]] of Object.entries(AUDIENCES)) kb.text(`${title} (${audCount(k)})`, `a:ba:${k}`).row();
  kb.text('‹ Рассылка', 'a:b');
  return ['📣 Кому отправить?\n\nПользователи, которые заблокировали бота или ещё ни разу его не запускали, в рассылку не попадут.', kb];
}

function screenBroadcastConfirm(d) {
  const n = audCount(d.aud);
  const kb = kbd().text(d.withBtn ? '☑️ Кнопка «Открыть Hider»' : '⬜ Кнопка «Открыть Hider»', 'a:bb').row()
    .text(`🚀 Отправить (${n})`, 'a:bs').row().text('✖️ Отмена', 'a:bq');
  return [`📣 <b>Проверь рассылку</b>\nАудитория: ${AUDIENCES[d.aud][0]} — <b>${n}</b> получателей.\nВыше — как увидят сообщение пользователи.${d.withBtn ? '' : '\n\nМожно добавить под сообщение кнопку, открывающую Mini App.'}`, kb];
}

function screenBroadcastHistory() {
  const rows = all('SELECT * FROM broadcasts ORDER BY id DESC LIMIT 10');
  const lines = rows.map((b) => `№${b.id} · ${dt(b.created_at)} · ${AUDIENCES[b.audience]?.[0] || b.audience}\n   ✅ ${b.sent} · 🚫 ${b.blocked} · ⚠️ ${b.failed} из ${b.total} · ${b.status}`);
  return [`📜 <b>История рассылок</b>\n\n${lines.join('\n\n') || 'Пока пусто'}`, homeBtn(kbd().text('‹ Рассылка', 'a:b'))];
}

function screenSystem() {
  const on = kvGet('maintenance', '0') === '1';
  const until = Number(kvGet('maintenance_until', '0'));
  const kb = kbd();
  if (on) kb.text('✅ Выключить тех. работы', 'a:sm:off').row();
  else kb.text('🛠 Тех. работы 30 мин', 'a:sm:30').text('2 часа', 'a:sm:120').text('Без срока', 'a:sm:0').row();
  kb.text('💾 Бэкап базы', 'a:sb').row().text('🔔 Мои уведомления', 'a:sn').text('📜 Журнал действий', 'a:sl:0');
  const m = config.webappUrl ? `\nMini App: ${esc(config.webappUrl)}` : '';
  return [`⚙️ <b>Система</b>\n\nТехнические работы: ${on ? `🛠 включены${until ? ` до ${dt(until)}` : ' (без срока)'}` : 'выключены'}\nАдминистраторы Mini App проходят при тех. работах.${m}\nБаза: ${(fs.statSync(config.dbFile).size / 1048576).toFixed(1)} МБ`, homeBtn(kb)];
}

function screenNotify() {
  const off = offTypes();
  const kb = kbd();
  for (const [k, title] of Object.entries(NOTIFY_TYPES)) kb.text(`${off.has(k) ? '🔕' : '🔔'} ${title}`, `a:sn:${k}`).row();
  kb.text('‹ Система', 'a:s');
  return ['🔔 <b>Уведомления администраторам</b>\n\nНастройка общая для всех админов. Нажми на тип, чтобы включить или выключить.', kb];
}

function screenLog(page) {
  const per = 15;
  const total = one('SELECT COUNT(*) n FROM admin_log').n;
  const rows = all('SELECT * FROM admin_log ORDER BY id DESC LIMIT ? OFFSET ?', per, page * per);
  const kb = kbd();
  pager(kb, 'a:sl', page, total, per);
  kb.text('‹ Система', 'a:s');
  return [`📜 <b>Журнал действий</b>\n\n${rows.map((r) => `${dt(r.ts)} · ${r.admin_id} · ${esc(r.action)}${r.target ? ` ${esc(r.target)}` : ''}${r.info ? ` — ${esc(r.info)}` : ''}`).join('\n') || 'Пусто'}`, homeBtn(kb)];
}

function screenAdmins(viewerId) {
  const extra = S.adminIds().filter((id) => !S.isSuperAdmin(id));
  const kb = kbd();
  if (S.isSuperAdmin(viewerId)) {
    for (const id of extra) kb.text(`🗑 Убрать ${id}`, `a:adr:${id}`).row();
    kb.text('➕ Добавить админа', 'a:ada').row();
  }
  const text = [`👮 <b>Администраторы</b>`, '', `Главные (из настроек сервера): ${config.admins.map((i) => `<code>${i}</code>`).join(', ') || '—'}`,
    `Добавленные: ${extra.map((i) => `<code>${i}</code>`).join(', ') || '—'}`, S.isSuperAdmin(viewerId) ? '' : '\nДобавлять и убирать админов могут только главные.'].join('\n');
  return [text, homeBtn(kb)];
}

/* ---------- рассылка ---------- */
const openMarkup = () => (config.webappUrl ? { inline_keyboard: [[{ text: 'Открыть Hider', web_app: { url: config.webappUrl }, style: 'success' }]] } : undefined);

async function runBroadcast(api, bc) {
  const upd = db.prepare('UPDATE broadcasts SET sent=?, blocked=?, failed=? WHERE id=?');
  let sent = 0; let blocked = 0; let failed = 0; let last = 0;
  const progress = (final) => {
    const body = `📣 <b>Рассылка №${bc.id}</b>${final ? ` — ${bc.cancel ? 'остановлена' : 'завершена'}` : ''}\nОбработано ${sent + blocked + failed} из ${bc.ids.length}\n✅ доставлено ${sent} · 🚫 недоступны ${blocked} · ⚠️ ошибки ${failed}`;
    return api.editMessageText(bc.chatId, bc.progressMsgId, body, { parse_mode: 'HTML', reply_markup: final ? undefined : new InlineKeyboard().text('⏹ Остановить', `a:bx:${bc.id}`) }).catch(() => {});
  };
  for (const uid of bc.ids) {
    if (bc.cancel) break;
    let done = false;
    for (let attempt = 0; attempt < 3 && !done; attempt++) {
      try {
        await api.copyMessage(uid, bc.chatId, bc.msgId, bc.markup ? { reply_markup: bc.markup } : undefined);
        sent++; done = true;
      } catch (e) {
        const desc = String(e.description || e.message);
        if (e.error_code === 429) { await sleep(((e.parameters?.retry_after) || 3) * 1000 + 500); continue; }
        if (e.error_code === 403 || /chat not found|user is deactivated|bot was blocked/i.test(desc)) {
          blocked++; db.prepare('UPDATE users SET bot_blocked=1 WHERE id=?').run(uid);
        } else failed++;
        done = true;
      }
    }
    if (!done) failed++;
    await sleep(45); // ~20 сообщений в секунду, ниже лимита Telegram
    if (Date.now() - last > 3000) { last = Date.now(); upd.run(sent, blocked, failed, bc.id); await progress(false); }
  }
  upd.run(sent, blocked, failed, bc.id);
  db.prepare('UPDATE broadcasts SET status=?, finished_at=? WHERE id=?').run(bc.cancel ? 'cancelled' : 'done', Date.now(), bc.id);
  running.delete(bc.id);
  audit(bc.adminId, 'broadcast_done', `#${bc.id}`, `sent=${sent} blocked=${blocked} failed=${failed}`);
  await progress(true);
}

/* ---------- регистрация ---------- */
export function registerAdmin(bot) {
  db.prepare("UPDATE broadcasts SET status='interrupted', finished_at=? WHERE status='running'").run(Date.now());
  const isAdm = (ctx) => S.isAdmin(ctx.from?.id);

  const send = async (ctx, [text, kb]) => {
    const opts = { parse_mode: 'HTML', reply_markup: kb, link_preview_options: { is_disabled: true } };
    if (ctx.callbackQuery) {
      try { await ctx.editMessageText(text, opts); } catch (e) {
        if (!/not modified/i.test(String(e.description || e.message))) await ctx.reply(text, opts);
      }
      await ctx.answerCallbackQuery().catch(() => {});
    } else await ctx.reply(text, opts);
  };
  const toast = (ctx, text) => ctx.answerCallbackQuery({ text, show_alert: true }).catch(() => {});
  const ask = (ctx, st, text, back = 'a:home') => {
    pending.set(ctx.from.id, st);
    return send(ctx, [`${text}\n\nОтмена — /cancel`, kbd().text('✖️ Отмена', 'a:cancel')]);
  };
  const needUser = (id) => { const u = S.getUser(Number(id)); if (!u) throw new S.ApiError(404, 'user_not_found'); return u; };

  const grant = (u, days) => {
    const now = Date.now();
    let until;
    if (days === 0) until = 0;
    else if (days > 0) until = Math.max(now, u.sub_until) + days * DAY;
    else until = u.sub_until + days * DAY;
    if (until <= now) until = 0;
    db.prepare('UPDATE users SET sub_until=?, sub_total_days=? WHERE id=?').run(until, until ? Math.ceil((until - now) / DAY) : 0, u.id);
  };

  /* ----- маршруты кнопок ----- */
  const R = {
    noop: async (ctx) => { await ctx.answerCallbackQuery().catch(() => {}); },
    home: (ctx) => send(ctx, screenHome()),
    cancel: (ctx) => { pending.delete(ctx.from.id); return send(ctx, screenHome()); },
    stats: (ctx) => send(ctx, screenStats()),

    u: (ctx, [id]) => (id ? send(ctx, screenUser(id)) : send(ctx, screenUsers())),
    ul: (ctx, [mode, page]) => send(ctx, screenUserList(mode, Number(page) || 0)),
    uf: (ctx) => ask(ctx, { kind: 'find_user' }, '🔍 Пришли ID или @username пользователя.'),
    ug: (ctx, [id, days]) => {
      const u = needUser(id); grant(u, Number(days)); audit(ctx.from.id, 'grant_days', id, days);
      return send(ctx, screenUser(id, `✅ Срок подписки изменён: ${Number(days) > 0 ? '+' : ''}${days} дн.`));
    },
    ugc: (ctx, [id]) => ask(ctx, { kind: 'user_days', id }, `✏️ Сколько дней добавить пользователю ${id}? Можно отрицательное число, чтобы убавить.`),
    uh: (ctx, [id]) => { needUser(id); db.prepare('UPDATE users SET hwid=NULL WHERE id=?').run(id); audit(ctx.from.id, 'hwid_wipe', id); return send(ctx, screenUser(id, '✅ HWID сброшен (счётчик сбросов не тронут).')); },
    ur: (ctx, [id]) => { needUser(id); db.prepare('UPDATE users SET hwid_resets=hwid_resets+1 WHERE id=?').run(id); audit(ctx.from.id, 'hwid_reset_add', id); return send(ctx, screenUser(id, '✅ Добавлен 1 сброс HWID.')); },
    um: (ctx, [id]) => { const u = needUser(id); db.prepare('UPDATE users SET media_status=? WHERE id=?').run(u.media_status ? 0 : 1, id); audit(ctx.from.id, 'media_toggle', id, u.media_status ? 'off' : 'on'); return send(ctx, screenUser(id)); },
    ub: (ctx, [id]) => {
      const u = needUser(id);
      if (S.isAdmin(u.id)) throw new S.ApiError(403, 'cannot_ban_admin');
      db.prepare('UPDATE users SET banned=? WHERE id=?').run(u.banned ? 0 : 1, id); audit(ctx.from.id, u.banned ? 'unban' : 'ban', id);
      return send(ctx, screenUser(id));
    },
    uw: (ctx, [id]) => { needUser(id); return ask(ctx, { kind: 'write_user', id }, `✉️ Пришли сообщение для пользователя ${id}: оно уйдёт от имени бота как есть.`); },
    uo: (ctx, [id]) => {
      const rows = all('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 10', Number(id));
      const kb = kbd();
      rows.forEach((o, i) => { kb.text(`№${o.id}`, `a:o:${o.id}`); if (i % 5 === 4) kb.row(); });
      kb.row().text('‹ Пользователь', `a:u:${id}`);
      return send(ctx, [`🧾 <b>Заказы пользователя ${id}</b>\n\n${rows.map((o) => `${ORDER_ICON[o.status] || '•'} №${o.id} · ${esc(orderLabel(o))} · ${money(o.amount_rub)} · ${dt(o.created_at)}`).join('\n') || 'Пока нет'}`, homeBtn(kb)]);
    },

    k: (ctx) => send(ctx, screenKeys()),
    kn: (ctx) => send(ctx, screenKeyDays()),
    kdd: (ctx) => ask(ctx, { kind: 'key_days' }, '✏️ На сколько дней создать ключи? Число от 1 до 3650.'),
    kd: (ctx, [d]) => send(ctx, screenKeyCount(Number(d))),
    kcc: (ctx, [d]) => ask(ctx, { kind: 'key_count', days: Number(d) }, `✏️ Сколько ключей на ${d} дн. создать? Число от 1 до 100.`),
    kc: (ctx, [d, c]) => { audit(ctx.from.id, 'keys_create', `${d}d`, `x${c}`); return send(ctx, screenKeysCreated(Number(d), Number(c))); },
    kl: (ctx, [mode, page]) => send(ctx, screenKeyList(mode, Number(page) || 0)),
    kx: (ctx) => ask(ctx, { kind: 'key_delete' }, '🗑 Пришли ключ, который нужно удалить (только неиспользованный).'),

    ol: (ctx, [f, page]) => send(ctx, screenOrderList(f, Number(page) || 0)),
    o: (ctx, [id]) => send(ctx, screenOrder(id)),
    oc: (ctx, [id]) => { S.settleOrder(Number(id), { by: String(ctx.from.id) }); audit(ctx.from.id, 'order_confirm', id); return send(ctx, screenOrder(id)); },
    ox: (ctx, [id]) => { db.prepare("UPDATE orders SET status='cancelled' WHERE id=? AND status='pending'").run(Number(id)); audit(ctx.from.id, 'order_cancel', id); return send(ctx, screenOrder(id)); },

    v: (ctx, [id]) => (id ? send(ctx, screenVideo(id)) : send(ctx, screenVideos())),
    va: (ctx, [id]) => { const v = S.reviewVideo(Number(id), {}); audit(ctx.from.id, 'video_accept', id, `views=${v.views}`); return send(ctx, screenVideo(id)); },
    vv: (ctx, [id]) => ask(ctx, { kind: 'video_views', id }, `✏️ Сколько просмотров засчитать у ролика №${id}?`),
    vr: (ctx, [id]) => { S.reviewVideo(Number(id), { reject: true }); audit(ctx.from.id, 'video_reject', id); return send(ctx, screenVideo(id)); },
    vn: (ctx, [id]) => ask(ctx, { kind: 'video_reject', id }, `✏️ Причина отклонения ролика №${id}:`),

    w: (ctx, [id]) => (id ? send(ctx, screenWithdrawal(id)) : send(ctx, screenWithdrawals())),
    wp: (ctx, [id]) => { S.reviewWithdrawal(Number(id), { approve: true }); audit(ctx.from.id, 'withdraw_pay', id); return send(ctx, screenWithdrawal(id)); },
    wr: (ctx, [id]) => { S.reviewWithdrawal(Number(id), { approve: false }); audit(ctx.from.id, 'withdraw_reject', id); return send(ctx, screenWithdrawal(id)); },
    wn: (ctx, [id]) => ask(ctx, { kind: 'wd_reject', id }, `✏️ Причина отклонения вывода №${id}:`),

    p: (ctx, [code]) => (code ? send(ctx, screenPromo(code)) : send(ctx, screenPromos())),
    pf: (ctx) => ask(ctx, { kind: 'promo_find' }, '🔍 Пришли код промокода.'),
    pd: (ctx, [code]) => send(ctx, [`🗑 Удалить промокод <b>${esc(code)}</b>? Код освободится, у владельца он пропадёт. Заказы и начисления сохранятся.`, kbd().text('Да, удалить', `a:pdy:${code}`).text('Отмена', `a:p:${code}`)]),
    pdy: (ctx, [code]) => {
      db.prepare('DELETE FROM promos WHERE code=?').run(code);
      db.prepare('UPDATE users SET promo_code=NULL WHERE promo_code=? COLLATE NOCASE').run(code);
      audit(ctx.from.id, 'promo_delete', code);
      return send(ctx, screenPromos());
    },

    b: (ctx) => send(ctx, screenBroadcast()),
    bn: (ctx) => send(ctx, screenBroadcastAudience()),
    ba: (ctx, [aud]) => { if (!AUDIENCES[aud]) return null; return ask(ctx, { kind: 'bc_msg', aud }, `📣 Аудитория: ${AUDIENCES[aud][0]} (${audCount(aud)}).\n\nПришли сообщение для рассылки — любое: текст, фото, видео, файл.`); },
    bb: (ctx) => { const d = drafts.get(ctx.from.id); if (!d) return toast(ctx, 'Черновик не найден'); d.withBtn = !d.withBtn; return send(ctx, screenBroadcastConfirm(d)); },
    bq: (ctx) => { drafts.delete(ctx.from.id); return send(ctx, screenBroadcast()); },
    bs: async (ctx) => {
      const d = drafts.get(ctx.from.id);
      if (!d) return toast(ctx, 'Черновик не найден');
      drafts.delete(ctx.from.id);
      const ids = all(`SELECT id FROM users WHERE ${audSql(d.aud)}`).map((r) => r.id);
      if (!ids.length) return toast(ctx, 'Некому отправлять');
      const info = db.prepare('INSERT INTO broadcasts(admin_id, audience, created_at, total) VALUES(?,?,?,?)').run(ctx.from.id, d.aud, Date.now(), ids.length);
      const id = Number(info.lastInsertRowid);
      const bc = { id, adminId: ctx.from.id, ids, chatId: d.chatId, msgId: d.msgId, markup: d.withBtn ? openMarkup() : undefined, cancel: false, progressMsgId: ctx.callbackQuery.message.message_id };
      running.set(id, bc);
      audit(ctx.from.id, 'broadcast_start', `#${id}`, `${d.aud} → ${ids.length}`);
      await ctx.answerCallbackQuery({ text: 'Рассылка запущена' }).catch(() => {});
      await ctx.editMessageText(`📣 <b>Рассылка №${id}</b> запущена: ${ids.length} получателей…`, { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('⏹ Остановить', `a:bx:${id}`) }).catch(() => {});
      runBroadcast(ctx.api, bc).catch((e) => console.error('broadcast', e));
      return null;
    },
    bx: (ctx, [id]) => { const bc = running.get(Number(id)); if (bc) bc.cancel = true; return toast(ctx, bc ? 'Останавливаю…' : 'Рассылка уже завершена'); },
    bh: (ctx) => send(ctx, screenBroadcastHistory()),

    s: (ctx) => send(ctx, screenSystem()),
    sm: (ctx, [mode, min]) => {
      const on = mode !== 'off';
      const minutes = on ? Number(mode) : 0;
      kvSet('maintenance', on ? '1' : '0');
      kvSet('maintenance_until', on && minutes ? Date.now() + minutes * 60000 : 0);
      audit(ctx.from.id, 'maintenance', on ? 'on' : 'off', minutes ? `${minutes} min` : '');
      return send(ctx, screenSystem());
    },
    sb: async (ctx) => {
      await ctx.answerCallbackQuery({ text: 'Готовлю копию…' }).catch(() => {});
      const f = path.join(os.tmpdir(), `hider-backup-${Date.now()}.db`);
      db.exec(`VACUUM INTO '${f}'`);
      try { await ctx.replyWithDocument(new InputFile(f, `hider-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.db`), { caption: '💾 Копия базы данных. Содержит данные пользователей — храни аккуратно.' }); } finally { fs.rmSync(f, { force: true }); }
      audit(ctx.from.id, 'db_backup');
    },
    sn: (ctx, [type]) => {
      if (type && NOTIFY_TYPES[type]) { const off = offTypes(); if (off.has(type)) off.delete(type); else off.add(type); kvSet('adm_off', JSON.stringify([...off])); }
      return send(ctx, screenNotify());
    },
    sl: (ctx, [page]) => send(ctx, screenLog(Number(page) || 0)),

    ad: (ctx) => send(ctx, screenAdmins(ctx.from.id)),
    ada: (ctx) => { if (!S.isSuperAdmin(ctx.from.id)) throw new S.ApiError(403, 'super_admin_only'); return ask(ctx, { kind: 'admin_add' }, '➕ Пришли Telegram ID нового администратора (число).'); },
    adr: (ctx, [id]) => { if (!S.isSuperAdmin(ctx.from.id)) throw new S.ApiError(403, 'super_admin_only'); S.removeAdmin(Number(id)); audit(ctx.from.id, 'admin_remove', id); return send(ctx, screenAdmins(ctx.from.id)); },
  };

  const errText = (e) => (e instanceof S.ApiError ? `Ошибка: ${e.code}` : `Ошибка: ${e.message}`);

  bot.command('admin', async (ctx) => {
    if (!isAdm(ctx)) return;
    pending.delete(ctx.from.id);
    await send(ctx, screenHome());
  });
  bot.command('cancel', async (ctx, next) => {
    if (!isAdm(ctx)) return next();
    pending.delete(ctx.from.id); drafts.delete(ctx.from.id);
    return send(ctx, ['Отменено.', homeBtn(kbd())]);
  });

  bot.callbackQuery(/^a:/, async (ctx) => {
    if (!isAdm(ctx)) return ctx.answerCallbackQuery({ text: 'Нет доступа' }).catch(() => {});
    const [, route, ...args] = ctx.callbackQuery.data.split(':');
    const h = R[route];
    if (!h) return ctx.answerCallbackQuery().catch(() => {});
    try {
      await h(ctx, args);
      await ctx.answerCallbackQuery().catch(() => {});
    } catch (e) {
      if (!(e instanceof S.ApiError)) console.error('admin', route, e);
      await toast(ctx, errText(e).slice(0, 190));
    }
    return null;
  });

  /* ----- ответы на запросы ввода ----- */
  const INPUT = {
    async find_user(ctx, st, text) {
      const q = text.trim().replace(/^@/, '');
      if (!q) return true;
      const byId = /^\d+$/.test(q) ? S.getUser(Number(q)) : null;
      if (byId) return send(ctx, screenUser(byId.id));
      const rows = all('SELECT * FROM users WHERE username=? COLLATE NOCASE OR username LIKE ? COLLATE NOCASE OR first_name LIKE ? COLLATE NOCASE LIMIT 10', q, `%${q}%`, `%${q}%`);
      if (!rows.length) { await ctx.reply('Никого не нашёл. Попробуй другой ID или @username, либо /cancel.'); return true; }
      if (rows.length === 1) return send(ctx, screenUser(rows[0].id));
      const kb = kbd();
      for (const u of rows) kb.text(`${u.username ? `@${u.username}` : u.first_name} · ${u.id}`, `a:u:${u.id}`).row();
      return send(ctx, [`Найдено: ${rows.length}`, homeBtn(kb)]);
    },
    async user_days(ctx, st, text) {
      const d = Number(text.trim().replace(',', '.'));
      if (!Number.isInteger(d) || Math.abs(d) > 3650) { await ctx.reply('Нужно целое число дней от −3650 до 3650.'); return true; }
      grant(needUser(st.id), d); audit(ctx.from.id, 'grant_days', st.id, d);
      return send(ctx, screenUser(st.id, `✅ Срок подписки изменён: ${d > 0 ? '+' : ''}${d} дн.`));
    },
    async write_user(ctx, st) {
      try { await ctx.api.copyMessage(Number(st.id), ctx.chat.id, ctx.message.message_id); } catch (e) { return send(ctx, [`⚠️ Не доставлено: ${esc(e.description || e.message)}`, homeBtn(kbd().text('‹ Пользователь', `a:u:${st.id}`))]); }
      audit(ctx.from.id, 'message_user', st.id);
      return send(ctx, screenUser(st.id, '✅ Сообщение отправлено.'));
    },
    async key_days(ctx, st, text) {
      const d = Number(text.trim());
      if (!Number.isInteger(d) || d < 1 || d > 3650) { await ctx.reply('Нужно целое число от 1 до 3650.'); return true; }
      return send(ctx, screenKeyCount(d));
    },
    async key_count(ctx, st, text) {
      const c = Number(text.trim());
      if (!Number.isInteger(c) || c < 1 || c > 100) { await ctx.reply('Нужно целое число от 1 до 100.'); return true; }
      audit(ctx.from.id, 'keys_create', `${st.days}d`, `x${c}`);
      return send(ctx, screenKeysCreated(st.days, c));
    },
    async key_delete(ctx, st, text) {
      const code = S.normalizeKey(text);
      const k = code && one('SELECT * FROM keys WHERE code=?', code);
      if (!k) { await ctx.reply('Такого ключа нет. Пришли ключ целиком или /cancel.'); return true; }
      if (k.used_by) { await ctx.reply('Этот ключ уже использован, удалить нельзя.'); return true; }
      db.prepare('DELETE FROM keys WHERE code=?').run(code); audit(ctx.from.id, 'key_delete', code);
      return send(ctx, [`🗑 Ключ <code>${code}</code> удалён.`, homeBtn(kbd().text('‹ Ключи', 'a:k'))]);
    },
    async video_views(ctx, st, text) {
      const n = Number(text.trim().replace(/\s/g, ''));
      if (!Number.isInteger(n) || n < 0) { await ctx.reply('Нужно целое число просмотров.'); return true; }
      const v = S.reviewVideo(Number(st.id), { views: n }); audit(ctx.from.id, 'video_accept', st.id, `views=${n}`);
      return send(ctx, screenVideo(v.id));
    },
    async video_reject(ctx, st, text) { S.reviewVideo(Number(st.id), { reject: true, note: text.trim().slice(0, 200) }); audit(ctx.from.id, 'video_reject', st.id, text.slice(0, 80)); return send(ctx, screenVideo(st.id)); },
    async wd_reject(ctx, st, text) { S.reviewWithdrawal(Number(st.id), { approve: false, note: text.trim().slice(0, 200) }); audit(ctx.from.id, 'withdraw_reject', st.id, text.slice(0, 80)); return send(ctx, screenWithdrawal(st.id)); },
    async promo_find(ctx, st, text) {
      if (!S.findPromo(text.trim())) { await ctx.reply('Такого промокода нет. Пришли код ещё раз или /cancel.'); return true; }
      return send(ctx, screenPromo(S.findPromo(text.trim()).code));
    },
    async admin_add(ctx, st, text) {
      if (!/^\d{5,15}$/.test(text.trim())) { await ctx.reply('Нужен числовой Telegram ID.'); return true; }
      S.addAdmin(Number(text.trim())); audit(ctx.from.id, 'admin_add', text.trim());
      return send(ctx, screenAdmins(ctx.from.id));
    },
    async bc_msg(ctx, st) {
      const d = { aud: st.aud, withBtn: false, chatId: ctx.chat.id, msgId: ctx.message.message_id };
      drafts.set(ctx.from.id, d);
      await ctx.api.copyMessage(ctx.chat.id, ctx.chat.id, d.msgId).catch(() => {});
      return send(ctx, screenBroadcastConfirm(d));
    },
  };

  bot.on('message', async (ctx, next) => {
    if (!isAdm(ctx) || ctx.chat.type !== 'private') return next();
    const st = pending.get(ctx.from.id);
    if (!st) return next();
    const text = ctx.message.text ?? ctx.message.caption ?? '';
    if (!['write_user', 'bc_msg'].includes(st.kind) && !ctx.message.text) { await ctx.reply('Пришли текстом или /cancel.'); return null; }
    pending.delete(ctx.from.id);
    try {
      const retry = await INPUT[st.kind](ctx, st, text);
      if (retry === true) pending.set(ctx.from.id, st);
    } catch (e) {
      if (!(e instanceof S.ApiError)) console.error('admin input', st.kind, e);
      await ctx.reply(errText(e));
    }
    return null;
  });
}
