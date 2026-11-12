// Проверка бота против поддельного Telegram Bot API (без сети).  node tools/bot-smoke.mjs
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ADMIN = 7572384106;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hider-smoke-'));
const calls = [];
const mode = { rejectIcon: false, rejectEmoji: false, blocked: new Set() };
let mid = 100;

const srv = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    const method = req.url.split('/').pop();
    let p = {};
    try { p = body ? JSON.parse(body) : {}; } catch { p = { multipart: true, chat_id: Number((/name="chat_id"\r\n\r\n(\d+)/.exec(body) || [])[1]) }; }
    calls.push({ method, p });
    const fail = (code, description) => { res.writeHead(code === 429 ? 429 : 400); res.end(JSON.stringify({ ok: false, error_code: code, description })); };
    if (method === 'sendMessage' && mode.rejectEmoji && /tg-emoji/.test(p.text || '')) return fail(400, 'Bad Request: DOCUMENT_INVALID');
    if (method === 'sendMessage' && mode.rejectIcon && JSON.stringify(p.reply_markup || {}).includes('icon_custom_emoji_id')) return fail(400, 'Bad Request: BUTTON_ICON_FORBIDDEN');
    if (method === 'copyMessage' && mode.blocked.has(p.chat_id)) return fail(403, 'Forbidden: bot was blocked by the user');
    const results = {
      getMe: { id: 1, is_bot: true, first_name: 'T', username: 'tbot', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false },
      sendMessage: { message_id: ++mid, date: 0, chat: { id: p.chat_id, type: 'private' }, text: p.text },
      copyMessage: { message_id: ++mid },
      sendDocument: { message_id: ++mid, date: 0, chat: { id: p.chat_id, type: 'private' } },
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, result: results[method] ?? true }));
  });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));

Object.assign(process.env, {
  DB_FILE: path.join(tmp, 'smoke.db'), BOT_TOKEN: '1:SMOKE', ADMIN_IDS: String(ADMIN), WEBAPP_URL: 'https://app.example.test',
  TG_API_ROOT: `http://127.0.0.1:${srv.address().port}`, DEV: '0',
});
const { createBot, sendWelcome } = await import('../src/bot.js');
const S = await import('../src/service.js');
const { db } = await import('../src/db.js');

const bot = createBot();
await bot.init();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let uid = 0;
const upd = (x) => ({ update_id: ++uid, ...x });
const from = (id, name = 'U') => ({ id, is_bot: false, first_name: name, username: `user${id}` });
const say = (id, text, name) => bot.handleUpdate(upd({ message: { message_id: ++mid, date: 0, chat: { id, type: 'private' }, from: from(id, name), text, ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] } : {}) } }));
const tap = (id, data) => bot.handleUpdate(upd({ callback_query: { id: String(++mid), from: from(id), chat_instance: 'x', data, message: { message_id: 555, date: 0, chat: { id, type: 'private' }, text: 'panel' } } }));
const since = (n) => calls.slice(n);
const to = (list, id, method = 'sendMessage') => list.filter((c) => c.method === method && c.p.chat_id === id);

let failed = 0;
const ok = (cond, name, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  ← ${extra}`}`); if (!cond) failed++; };

/* 1. новый пользователь: одно приветствие с нужной кнопкой + уведомление админу */
let n = calls.length;
await say(1001, '/start', 'Аня');
await sleep(80);
let c = since(n);
const w = to(c, 1001);
ok(w.length === 1, 'новому пользователю уходит ровно одно сообщение', `${w.length}`);
const btn = w[0]?.p.reply_markup?.inline_keyboard?.[0]?.[0];
ok(/Привет, Аня!/.test(w[0]?.p.text) && /tg-emoji emoji-id="5339441129785929529"/.test(w[0]?.p.text), 'приветствие с премиум-эмодзи', w[0]?.p.text);
ok(/Нажми на кнопку ниже/.test(w[0]?.p.text), 'под приветствием подсказка про кнопку');
ok(btn?.style === 'success' && btn?.icon_custom_emoji_id === '5402406965252989103' && btn?.web_app?.url === 'https://app.example.test', 'кнопка зелёная, с эмодзи, открывает Mini App', JSON.stringify(btn));
ok(to(c, ADMIN).some((x) => /Новый пользователь/.test(x.p.text)), 'админ получил уведомление о новом пользователе');
ok(!JSON.stringify(w[0]?.p.reply_markup).includes('a:home'), 'обычный пользователь не видит кнопку админки');

/* 2. любое сообщение — то же приветствие, но не чаще раза в 10 секунд */
n = calls.length; await say(1001, 'привет'); await sleep(30);
ok(to(since(n), 1001).length === 0, 'повторное сообщение сразу не порождает спам');

/* 3. Telegram не принимает премиум-эмодзи: запасные варианты */
mode.rejectIcon = true;
n = calls.length; await say(1002, '/start', 'Боб'); await sleep(80);
let okMsg = to(since(n), 1002).at(-1);
ok(okMsg && /tg-emoji/.test(okMsg.p.text) && !JSON.stringify(okMsg.p.reply_markup).includes('icon_custom'), 'без иконки на кнопке отправка проходит (эмодзи в тексте остаётся)', JSON.stringify(okMsg));
ok(okMsg?.p.reply_markup.inline_keyboard[0][0].style === 'success', 'кнопка остаётся зелёной');
mode.rejectEmoji = true;
n = calls.length; await sendWelcome(bot.api, 1003, { id: 1003, first_name: 'Вика' });
okMsg = to(since(n), 1003).at(-1);
ok(okMsg && !/tg-emoji/.test(okMsg.p.text) && okMsg.p.reply_markup.inline_keyboard[0][0].style === 'success', 'если отклонено всё — уходит обычное приветствие с зелёной кнопкой', JSON.stringify(okMsg));
mode.rejectIcon = false; mode.rejectEmoji = false;

/* 4. админ: панель, доступ */
n = calls.length; await say(ADMIN, '/admin'); await sleep(50);
ok(to(since(n), ADMIN).some((x) => /Админ-панель Hider/.test(x.p.text)), '/admin открывает панель у админа');
n = calls.length; await say(1001, '/admin'); await sleep(50);
ok(!since(n).some((x) => /Админ-панель Hider/.test(x.p?.text || '')), 'обычному пользователю панель не открывается');
n = calls.length; await tap(1001, 'a:stats'); await sleep(50);
ok(since(n).some((x) => x.method === 'answerCallbackQuery' && /Нет доступа/.test(x.p.text || '')) && !since(n).some((x) => x.method === 'editMessageText'), 'чужие нажатия на кнопки панели отклоняются');

/* 5. разделы панели открываются без ошибок */
for (const r of ['home', 'stats', 'u', 'ul:r:0', 'ul:s:0', 'k', 'kn', 'kd:3', 'kl:u:0', 'kl:a:0', 'ol:p:0', 'ol:d:0', 'ol:a:0', 'v', 'w', 'p', 'b', 'bn', 'bh', 's', 'sn', 'sl:0', 'ad']) {
  n = calls.length; await tap(ADMIN, `a:${r}`); await sleep(15);
  const e = since(n).find((x) => x.method === 'editMessageText');
  ok(!!e && !/Ошибка/.test(e.p.text), `раздел a:${r}`, JSON.stringify(since(n).map((x) => x.method + ':' + (x.p.text || '').slice(0, 60))));
}

/* 6. ключи */
n = calls.length; await tap(ADMIN, 'a:kc:3:2'); await sleep(30);
const created = since(n).find((x) => x.method === 'editMessageText')?.p.text || '';
const codes = created.match(/HIDER-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/g) || [];
ok(codes.length === 2 && db.prepare('SELECT COUNT(*) n FROM keys WHERE days=3 AND used_by IS NULL').get().n === 2, 'создание ключей на 3 дня: HIDER-XXXX-XXXX-XXXX × 2', created);
n = calls.length; S.activateKey(S.getUser(1001), codes[0]); await sleep(60);
ok(to(since(n), ADMIN).some((x) => /Активация ключа/.test(x.p.text) && x.p.text.includes(codes[0])), 'админ получил уведомление об активации ключа');
ok(to(since(n), 1001).length === 0, 'пользователю про активацию ничего не отправлено');

/* 7. заказы и покупка */
db.prepare("INSERT INTO orders(user_id, kind, item, base_rub, amount_rub, method, created_at, expires_at) VALUES(1001,'sub','30',299,299,'sbp',?,?)").run(Date.now(), Date.now() + 600000);
const oid = db.prepare('SELECT MAX(id) m FROM orders').get().m;
n = calls.length; await tap(ADMIN, `a:oc:${oid}`); await sleep(60);
ok(db.prepare('SELECT status FROM orders WHERE id=?').get(oid).status === 'paid', 'подтверждение оплаты из панели закрывает заказ');
ok(to(since(n), ADMIN).some((x) => /Покупка/.test(x.p.text) && /299/.test(x.p.text)), 'админ получил уведомление о покупке');
ok(to(since(n), 1001).length === 0, 'пользователю чек не отправляется');

/* 8. управление пользователем */
const before = S.getUser(1001).sub_until;
await tap(ADMIN, 'a:ug:1001:7'); ok(S.getUser(1001).sub_until === before + 7 * 86400000, '+7 дней к подписке');
await tap(ADMIN, 'a:ug:1001:-7'); ok(S.getUser(1001).sub_until === before, '−7 дней');
await tap(ADMIN, 'a:ub:1001'); ok(S.getUser(1001).banned === 1, 'бан');
n = calls.length; await say(1001, '/start'); await sleep(40);
ok(to(since(n), 1001).length === 0, 'забаненному бот не отвечает');
await tap(ADMIN, 'a:ub:1001'); ok(S.getUser(1001).banned === 0, 'разбан');
await tap(ADMIN, `a:ub:${ADMIN}`); ok(!S.getUser(ADMIN) || S.getUser(ADMIN).banned !== 1, 'админа забанить нельзя');
n = calls.length; await say(ADMIN, '/admin'); await tap(ADMIN, 'a:uf'); await say(ADMIN, '@user1001'); await sleep(50);
ok(since(n).some((x) => x.method === 'sendMessage' && /user1001/.test(x.p.text || '') && /Подписка/.test(x.p.text || '')), 'поиск пользователя по @username');

/* 9. рассылка */
for (const id of [2001, 2002, 2003, 2004]) S.upsertUser(from(id, `B${id}`));
mode.blocked.add(2003);
n = calls.length; await tap(ADMIN, 'a:ba:all');
await bot.handleUpdate(upd({ message: { message_id: 900, date: 0, chat: { id: ADMIN, type: 'private' }, from: from(ADMIN), text: 'Всем привет, это рассылка' } })); await sleep(60);
ok(since(n).some((x) => x.method === 'copyMessage' && x.p.chat_id === ADMIN), 'админ видит предпросмотр рассылки');
const expected = db.prepare('SELECT COUNT(*) n FROM users WHERE banned=0 AND bot_blocked=0').get().n;
await tap(ADMIN, 'a:bb');
n = calls.length; await tap(ADMIN, 'a:bs');
for (let i = 0; i < 100 && db.prepare("SELECT status FROM broadcasts ORDER BY id DESC LIMIT 1").get()?.status === 'running'; i++) await sleep(100);
const bc = db.prepare('SELECT * FROM broadcasts ORDER BY id DESC LIMIT 1').get();
const copies = since(n).filter((x) => x.method === 'copyMessage' && x.p.chat_id !== ADMIN || (x.method === 'copyMessage' && x.p.chat_id === ADMIN && x.p.reply_markup));
ok(bc.status === 'done' && bc.total === expected && bc.blocked === 1 && bc.sent === expected - 1, `рассылка дошла: всего ${bc.total}, доставлено ${bc.sent}, недоступных ${bc.blocked}`, JSON.stringify(bc));
ok(S.getUser(2003).bot_blocked === 1, 'заблокировавший бота помечается и пропускается дальше');
ok(copies.every((x) => x.p.reply_markup?.inline_keyboard?.[0]?.[0]?.web_app && x.p.reply_markup.inline_keyboard[0][0].style === 'success'), 'в рассылку добавлена зелёная кнопка «Открыть Hider»');

/* 10. настройки уведомлений и админы */
await tap(ADMIN, 'a:sn:user_new');
n = calls.length; S.upsertUser(from(3001, 'Quiet')); await sleep(60);
ok(!to(since(n), ADMIN).some((x) => /Новый пользователь/.test(x.p.text)), 'выключенный тип уведомлений не приходит');
await tap(ADMIN, 'a:sn:user_new');
await tap(ADMIN, 'a:ada'); await say(ADMIN, '123456789'); ok(S.isAdmin(123456789) && !S.isSuperAdmin(123456789), 'добавление админа из панели');
await tap(ADMIN, 'a:adr:123456789'); ok(!S.isAdmin(123456789), 'удаление добавленного админа');
await tap(ADMIN, `a:adr:${ADMIN}`); ok(S.isAdmin(ADMIN), 'главного админа убрать нельзя');
await tap(ADMIN, 'a:sm:30'); ok(db.prepare("SELECT v FROM kv WHERE k='maintenance'").get().v === '1', 'тех. работы включаются');
await tap(ADMIN, 'a:sm:off');
n = calls.length; await tap(ADMIN, 'a:sb'); await sleep(100);
ok(since(n).some((x) => x.method === 'sendDocument'), 'бэкап базы отправляется документом');

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
srv.close();
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
