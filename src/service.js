import crypto from 'node:crypto';
import {
  config, PLANS, HWID_PACKS, TAG_PRICE, TAGS, FREE_TAGS, PROMO_BUYER_PCT, PROMO_AUTHOR_PCT,
  MIN_WITHDRAW, HWID_COOLDOWN_MS, START_HWID_RESETS, VIDEO_WINDOW_MS,
} from './config.js';
import { db, tx, kvGet } from './db.js';

const DAY = 86400000;

/** Короткий необратимый код HWID для показа пользователю: XXXX-XXXX-XXXX. В базе хранится полный HWID. */
export const hwidCode = (h) => (h
  ? crypto.createHash('sha256').update(String(h)).digest('hex').slice(0, 12).toUpperCase().replace(/(.{4})(?=.)/g, '$1-')
  : null);

export class ApiError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
export const notifier = { send: async () => {} };
const notify = (uid, text) => notifier.send(uid, text).catch(() => {});

const rub = (k) => Math.round(k) / 100;
const fmtRub = (n) => `${Number.isInteger(n) ? n : n.toFixed(2).replace('.', ',')} ₽`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export function upsertUser(tg) {
  const now = Date.now();
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(tg.id);
  if (!row) {
    db.prepare(`INSERT INTO users(id, first_name, username, photo_url, created_at, tags, hwid_resets)
                VALUES(?,?,?,?,?,?,?)`).run(tg.id, tg.first_name || '', tg.username || null, tg.photo_url || null, now, JSON.stringify([]), START_HWID_RESETS);
  } else {
    db.prepare('UPDATE users SET first_name=?, username=?, photo_url=COALESCE(?, photo_url) WHERE id=?')
      .run(tg.first_name || row.first_name, tg.username || null, tg.photo_url || null, tg.id);
  }
  return getUser(tg.id);
}

export const getUser = (id) => db.prepare('SELECT * FROM users WHERE id=?').get(id);

const ownedTags = (u) => [...new Set([...FREE_TAGS, ...JSON.parse(u.tags || '[]')])];
const displayName = (u) => u.username || u.first_name || `id${u.id}`;
const daysLeft = (u) => Math.max(0, Math.ceil((u.sub_until - Date.now()) / DAY));
const tagById = (id) => TAGS.find((t) => t.id === id);

function expireOrders(userId) {
  db.prepare("UPDATE orders SET status='expired' WHERE status='pending' AND expires_at<? AND user_id=?").run(Date.now(), userId);
}

export function stateFor(u) {
  const left = daysLeft(u);
  const owned = ownedTags(u);
  const promo = u.promo_code ? promoStats(u) : null;
  return {
    maintenance: kvGet('maintenance', '0') === '1',
    maintenanceUntil: Number(kvGet('maintenance_until', '0')) || 0,
    user: {
      id: u.id, name: displayName(u), photo: u.photo_url, createdAt: u.created_at,
      tag: u.tag, ownedTags: owned,
      gate: !!u.gate_ok,
    },
    sub: {
      active: left > 0, until: u.sub_until || 0, daysLeft: left,
      progress: u.sub_total_days > 0 ? Math.min(1, left / u.sub_total_days) : 0,
    },
    hwid: {
      value: hwidCode(u.hwid), resets: u.hwid_resets, lastResetAt: u.last_reset_at,
      nextResetAt: u.last_reset_at ? u.last_reset_at + HWID_COOLDOWN_MS : 0,
    },
    stats: { launches: u.launches, lastLaunchAt: u.last_launch_at },
    media: {
      status: !!u.media_status, balanceK: u.balance_k, earnedK: u.earned_k, withdrawnK: u.withdrawn_k,
      promo,
    },
    catalog: { plans: PLANS, hwidPacks: HWID_PACKS, tagPrice: TAG_PRICE, tags: TAGS, buyerPct: PROMO_BUYER_PCT, authorPct: PROMO_AUTHOR_PCT, minWithdraw: MIN_WITHDRAW },
    links: { channel: config.channelUrl, channelName: config.channel, channelTitle: config.channelTitle, support: config.supportUrl, offer: config.offerUrl, privacy: config.privacyUrl },
    methods: availableMethods(),
    payInfo: { sbpRequisites: config.sbpRequisites },
  };
}

export function availableMethods() {
  return {
    sbp: !!(config.sbpUrlTemplate || config.sbpRequisites),
    cryptobot: !!config.cryptoBotToken,
    funpay: !!config.funpayLotUrl,
    stars: !!config.botToken,
  };
}

/* ---------- promo ---------- */
export function findPromo(code) {
  if (!code) return null;
  return db.prepare('SELECT * FROM promos WHERE code=?').get(String(code).trim()) || null;
}

export function createPromo(u, code) {
  code = String(code || '').trim();
  if (!/^[A-Za-z0-9]{4,16}$/.test(code)) throw new ApiError(400, 'promo_invalid');
  if (u.promo_code) throw new ApiError(409, 'promo_exists');
  try {
    tx(() => {
      db.prepare('INSERT INTO promos(code, owner_id, created_at) VALUES(?,?,?)').run(code, u.id, Date.now());
      db.prepare('UPDATE users SET promo_code=? WHERE id=?').run(code, u.id);
    });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new ApiError(409, 'promo_taken', { suggest: promoSuggestions(code, u) });
    throw e;
  }
  return getUser(u.id);
}

function promoSuggestions(code, u) {
  const base = code.slice(0, 10);
  const cands = [displayName(u).replace(/[^A-Za-z0-9]/g, ''), base + '2026', base + 'Hider', base + '777', base + 'TV'].filter((c) => /^[A-Za-z0-9]{4,16}$/.test(c));
  return [...new Set(cands)].filter((c) => !findPromo(c)).slice(0, 2);
}

function promoStats(u) {
  const r = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(amount_rub),0) s FROM orders WHERE promo_code=? COLLATE NOCASE AND status='paid'`).get(u.promo_code);
  return { code: u.promo_code, activations: r.n, purchasesRub: r.s, incomeK: u.earned_k, withdrawnK: u.withdrawn_k };
}

/* ---------- quotes & orders ---------- */
function basePrice(kind, item) {
  if (kind === 'sub') {
    const p = PLANS.find((x) => x.days === Number(item));
    if (!p) throw new ApiError(400, 'bad_item');
    return p.price;
  }
  if (kind === 'hwid') {
    const p = HWID_PACKS.find((x) => x.count === Number(item));
    if (!p) throw new ApiError(400, 'bad_item');
    return p.price;
  }
  if (kind === 'tag') {
    const t = TAGS.find((x) => x.id === item);
    if (!t || t.free) throw new ApiError(400, 'bad_item');
    return TAG_PRICE;
  }
  throw new ApiError(400, 'bad_kind');
}

export function quote(u, { kind, item, promo }) {
  const base = basePrice(kind, item);
  if (kind === 'tag' && ownedTags(u).includes(item)) throw new ApiError(409, 'tag_owned');
  let promoRow = null;
  if (promo) {
    promoRow = findPromo(promo);
    if (!promoRow) throw new ApiError(404, 'promo_not_found');
  }
  const discount = promoRow ? Math.round((base * PROMO_BUYER_PCT) / 100) : 0;
  const total = base - discount;
  const q = { kind, item: String(item), base, discount, total, promo: promoRow ? promoRow.code : null, pct: promoRow ? PROMO_BUYER_PCT : 0 };
  if (kind === 'sub') {
    const start = Math.max(Date.now(), u.sub_until);
    q.activeUntil = start + Number(item) * DAY;
  }
  if (kind === 'hwid') q.resetsAfter = u.hwid_resets + Number(item);
  return q;
}

export function createOrder(u, { kind, item, promo, method }) {
  if (!['sbp', 'cryptobot', 'funpay', 'stars'].includes(method)) throw new ApiError(400, 'bad_method');
  if (!availableMethods()[method]) throw new ApiError(503, 'method_unavailable');
  const q = quote(u, { kind, item, promo });
  const now = Date.now();
  expireOrders(u.id);
  const info = db.prepare(`INSERT INTO orders(user_id, kind, item, base_rub, amount_rub, promo_code, method, created_at, expires_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(u.id, kind, q.item, q.base, q.total, q.promo, method, now, now + config.orderTtlMin * 60000);
  return Number(info.lastInsertRowid);
}

export const getOrder = (id) => db.prepare('SELECT * FROM orders WHERE id=?').get(id);

export function orderFor(u, id) {
  const o = getOrder(id);
  if (!o || o.user_id !== u.id) throw new ApiError(404, 'order_not_found');
  if (o.status === 'pending' && o.expires_at < Date.now()) {
    db.prepare("UPDATE orders SET status='expired' WHERE id=? AND status='pending'").run(id);
    o.status = 'expired';
  }
  return o;
}

export function orderView(o) {
  const t = o.kind === 'tag' ? tagById(o.item) : null;
  return {
    id: o.id, kind: o.kind, item: o.item, base: o.base_rub, total: o.amount_rub, promo: o.promo_code,
    method: o.method, status: o.status, expiresAt: o.expires_at, payUrl: o.pay_url, paidAt: o.paid_at,
    tagTitle: t ? t.title : null, tagColor: t ? t.color : null,
  };
}

export function lastOrders(u, limit = 20) {
  return db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT ?').all(u.id, limit);
}

/** Idempotently applies a paid order; safe to call from several confirmation paths. */
export function settleOrder(id, { by = 'auto' } = {}) {
  const res = tx(() => {
    const o = getOrder(id);
    if (!o) throw new ApiError(404, 'order_not_found');
    if (o.status === 'paid') return { o, already: true };
    if (o.status === 'cancelled') throw new ApiError(409, 'order_cancelled');
    const u = getUser(o.user_id);
    db.prepare("UPDATE orders SET status='paid', paid_at=?, note=COALESCE(note,'') || ? WHERE id=?").run(Date.now(), by === 'auto' ? '' : `confirmed:${by};`, id);
    if (o.kind === 'sub') {
      const days = Number(o.item);
      const start = Math.max(Date.now(), u.sub_until);
      const until = start + days * DAY;
      const total = Math.ceil((until - Date.now()) / DAY);
      db.prepare('UPDATE users SET sub_until=?, sub_total_days=? WHERE id=?').run(until, total, u.id);
    } else if (o.kind === 'hwid') {
      db.prepare('UPDATE users SET hwid_resets=hwid_resets+? WHERE id=?').run(Number(o.item), u.id);
    } else if (o.kind === 'tag') {
      const tags = JSON.parse(u.tags || '[]');
      if (!tags.includes(o.item)) tags.push(o.item);
      db.prepare('UPDATE users SET tags=? WHERE id=?').run(JSON.stringify(tags), u.id);
    }
    if (o.promo_code) {
      const p = findPromo(o.promo_code);
      if (p) {
        const k = Math.round(o.amount_rub * PROMO_AUTHOR_PCT); // 12% in kopecks
        db.prepare('UPDATE users SET balance_k=balance_k+?, earned_k=earned_k+? WHERE id=?').run(k, k, p.owner_id);
      }
    }
    return { o: getOrder(id), already: false };
  });
  if (!res.already) {
    const o = res.o;
    const what = o.kind === 'sub' ? `Подписка продлена на ${o.item} дн.` : o.kind === 'hwid' ? `Начислено сбросов HWID: ${o.item}` : `Тег «${tagById(o.item)?.title}» куплен`;
    notify(o.user_id, `Чек №${o.id}\n${what}\nОплачено: ${fmtRub(o.amount_rub)}`);
    if (o.promo_code) {
      const p = findPromo(o.promo_code);
      if (p) notify(p.owner_id, `По твоему коду ${p.code} оплатили заказ на ${fmtRub(o.amount_rub)} — тебе начислено ${fmtRub(rub(Math.round(o.amount_rub * PROMO_AUTHOR_PCT)))}`);
    }
  }
  return res.o;
}

export function cancelOrder(u, id) {
  const o = orderFor(u, id);
  if (o.status !== 'pending') return o;
  db.prepare("UPDATE orders SET status='cancelled' WHERE id=?").run(id);
  return getOrder(id);
}

/* ---------- profile actions ---------- */
export function resetHwid(u) {
  return tx(() => {
    const cur = getUser(u.id);
    const now = Date.now();
    if (cur.hwid_resets <= 0) throw new ApiError(409, 'no_resets');
    if (cur.last_reset_at && now - cur.last_reset_at < HWID_COOLDOWN_MS) {
      throw new ApiError(429, 'too_often', { retryAt: cur.last_reset_at + HWID_COOLDOWN_MS, lastResetAt: cur.last_reset_at });
    }
    db.prepare('UPDATE users SET hwid=NULL, hwid_resets=hwid_resets-1, last_reset_at=? WHERE id=?').run(now, u.id);
    return getUser(u.id);
  });
}

export function selectTag(u, tag) {
  if (!ownedTags(u).includes(tag)) throw new ApiError(403, 'tag_not_owned');
  db.prepare('UPDATE users SET tag=? WHERE id=?').run(tag, u.id);
  return getUser(u.id);
}

export function setGate(id, ok) {
  db.prepare('UPDATE users SET gate_ok=? WHERE id=?').run(ok ? 1 : 0, id);
}

/* ---------- launch command ---------- */
export function launchCommand(u) {
  const row = db.prepare('SELECT * FROM launch_cmds WHERE user_id=? ORDER BY created_at DESC LIMIT 1').get(u.id);
  if (!row) return null;
  return launchView(row);
}

function launchView(row) {
  const expired = row.expires_at < Date.now() || !!row.used_at;
  return { command: buildCommand(row.token), createdAt: row.created_at, expiresAt: row.expires_at, expired };
}

function buildCommand(token) {
  const base = config.launchBase || config.webappUrl;
  return `powershell -c "irm ${base}/r/${token} |iex"`;
}

export function createLaunch(u) {
  if (daysLeft(u) <= 0) throw new ApiError(403, 'sub_required');
  const token = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
  const now = Date.now();
  db.prepare('UPDATE launch_cmds SET expires_at=? WHERE user_id=? AND expires_at>?').run(now, u.id, now);
  db.prepare('INSERT INTO launch_cmds(token, user_id, created_at, expires_at) VALUES(?,?,?,?)').run(token, u.id, now, now + config.launchTtlMin * 60000);
  return launchCommand(u);
}

export function revokeLaunch(u) {
  db.prepare('UPDATE launch_cmds SET expires_at=? WHERE user_id=? AND expires_at>?').run(Date.now(), u.id, Date.now());
}

/** Called by the PowerShell one-liner on the user's PC. Returns the user's row or throws. */
export function consumeLaunch(token, hwid) {
  return tx(() => {
    const row = db.prepare('SELECT * FROM launch_cmds WHERE token=?').get(token);
    if (!row || row.used_at || row.expires_at < Date.now()) throw new ApiError(410, 'expired');
    const u = getUser(row.user_id);
    if (daysLeft(u) <= 0) throw new ApiError(403, 'sub_required');
    if (hwid) {
      const h = String(hwid).toUpperCase().replace(/[^0-9A-F-]/g, '').slice(0, 32);
      if (u.hwid && u.hwid !== h) throw new ApiError(409, 'hwid_mismatch');
      db.prepare('UPDATE users SET hwid=? WHERE id=?').run(h, u.id);
    }
    db.prepare('UPDATE launch_cmds SET used_at=? WHERE token=?').run(Date.now(), token);
    db.prepare('UPDATE users SET launches=launches+1, last_launch_at=? WHERE id=?').run(Date.now(), u.id);
    return getUser(u.id);
  });
}

/* ---------- media ---------- */
export function videoPayoutK(info, views = info.views) {
  if (info.platform === 'youtube' && info.long) return Math.round(views * 65);
  const tiers = [[10000, 300], [5000, 150], [1000, 25]];
  const t = tiers.find(([v]) => views >= v);
  return t ? t[1] * 100 : 0;
}

export function videoQuote(info) {
  const left = info.publishedAt + VIDEO_WINDOW_MS - Date.now();
  return { ...info, windowOpen: left > 0, daysLeft: Math.max(0, Math.ceil(left / DAY)), payoutK: left > 0 ? videoPayoutK(info) : 0 };
}

export function submitVideo(u, url, info) {
  if (!u.media_status) throw new ApiError(403, 'no_media_status');
  const q = videoQuote(info);
  if (!q.windowOpen) throw new ApiError(409, 'too_late');
  if (db.prepare("SELECT 1 FROM videos WHERE platform=? AND url=? AND status<>'rejected'").get(info.platform, url)) throw new ApiError(409, 'video_exists');
  const r = db.prepare('INSERT INTO videos(user_id, platform, url, title, is_long, published_at, created_at, views, payout_k) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(u.id, info.platform, url, info.title, info.long ? 1 : 0, info.publishedAt, Date.now(), info.views, q.payoutK);
  return { id: Number(r.lastInsertRowid), payoutK: q.payoutK };
}

export const listVideos = (u) => db.prepare('SELECT * FROM videos WHERE user_id=? ORDER BY id DESC LIMIT 50').all(u.id);

export function reviewVideo(id, { views, reject, note }) {
  return tx(() => {
    const v = db.prepare('SELECT * FROM videos WHERE id=?').get(id);
    if (!v) throw new ApiError(404, 'video_not_found');
    if (v.status !== 'pending') throw new ApiError(409, 'already_reviewed');
    if (reject) {
      db.prepare("UPDATE videos SET status='rejected', payout_k=0, note=? WHERE id=?").run(note || null, id);
      notify(v.user_id, `Ролик №${id} отклонён${note ? `: ${note}` : ''}`);
    } else {
      const n = views ?? v.views;
      const p = videoPayoutK({ platform: v.platform, long: !!v.is_long }, n);
      db.prepare("UPDATE videos SET status='paid', views=?, payout_k=? WHERE id=?").run(n, p, id);
      db.prepare('UPDATE users SET balance_k=balance_k+?, earned_k=earned_k+? WHERE id=?').run(p, p, v.user_id);
      notify(v.user_id, `Ролик №${id}: ${n} просмотров — начислено ${fmtRub(rub(p))}`);
    }
    return db.prepare('SELECT * FROM videos WHERE id=?').get(id);
  });
}

/* ---------- withdrawals ---------- */
const CARD_RE = /^\d{16,19}$/;
const TRC_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const TON_RE = /^(EQ|UQ)[A-Za-z0-9_-]{46}$/;

export function requestWithdrawal(u, { method, details, amount }) {
  if (!u.media_status) throw new ApiError(403, 'no_media_status');
  const amountK = Math.round(Number(amount) * 100);
  if (!Number.isFinite(amountK) || amountK <= 0) throw new ApiError(400, 'bad_amount');
  if (amountK < MIN_WITHDRAW * 100) throw new ApiError(400, 'below_min', { min: MIN_WITHDRAW });
  details = String(details || '').replace(/\s+/g, '');
  if (method === 'card' && !CARD_RE.test(details)) throw new ApiError(400, 'bad_details');
  if (method === 'crypto' && !(TRC_RE.test(details) || TON_RE.test(details))) throw new ApiError(400, 'bad_details');
  if (method === 'funpay' && !/^[\w.-]{2,40}$/.test(details)) throw new ApiError(400, 'bad_details');
  if (!['card', 'crypto', 'funpay'].includes(method)) throw new ApiError(400, 'bad_method');
  return tx(() => {
    const cur = getUser(u.id);
    if (amountK > cur.balance_k) throw new ApiError(400, 'over_balance', { balanceK: cur.balance_k });
    db.prepare('UPDATE users SET balance_k=balance_k-? WHERE id=?').run(amountK, u.id);
    const info = db.prepare('INSERT INTO withdrawals(user_id, method, details, amount_k, created_at) VALUES(?,?,?,?,?)').run(u.id, method, details, amountK, Date.now());
    return Number(info.lastInsertRowid);
  });
}

export const listWithdrawals = (u) => db.prepare('SELECT * FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 50').all(u.id);

export function reviewWithdrawal(id, { approve, note }) {
  return tx(() => {
    const w = db.prepare('SELECT * FROM withdrawals WHERE id=?').get(id);
    if (!w) throw new ApiError(404, 'withdrawal_not_found');
    if (w.status !== 'pending') throw new ApiError(409, 'already_reviewed');
    if (approve) {
      db.prepare("UPDATE withdrawals SET status='paid', note=? WHERE id=?").run(note || null, id);
      db.prepare('UPDATE users SET withdrawn_k=withdrawn_k+? WHERE id=?').run(w.amount_k, w.user_id);
      notify(w.user_id, `Вывод №${id} на ${fmtRub(rub(w.amount_k))} выплачен`);
    } else {
      db.prepare("UPDATE withdrawals SET status='rejected', note=? WHERE id=?").run(note || null, id);
      db.prepare('UPDATE users SET balance_k=balance_k+? WHERE id=?').run(w.amount_k, w.user_id);
      notify(w.user_id, `Вывод №${id} отклонён${note ? `: ${note}` : ''}. Сумма вернулась на баланс`);
    }
    return db.prepare('SELECT * FROM withdrawals WHERE id=?').get(id);
  });
}

export { fmtRub, rub, ownedTags, daysLeft };
