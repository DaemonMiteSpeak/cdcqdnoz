// Переносит пользователей из базы старого бота (licenses.db) в базу нового.
// Старая база открывается только на чтение. Повторный запуск безопасен.
// Использование: node tools/migrate-old.mjs --old <licenses.db> [--db <hider.db>] [--dry-run]
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';

const { values: a } = parseArgs({
  options: { old: { type: 'string' }, db: { type: 'string' }, 'dry-run': { type: 'boolean' } },
});
if (!a.old) {
  console.error('usage: node tools/migrate-old.mjs --old <licenses.db> [--db <hider.db>] [--dry-run]');
  process.exit(1);
}
if (a.db) process.env.DB_FILE = a.db;


const { db } = await import('../src/db.js');
const old = new DatabaseSync(a.old, { readOnly: true });

const { START_HWID_RESETS } = await import('../src/config.js');
const toMs = (s) => {
  if (!s) return 0;
  const t = /Z|[+-]\d\d:?\d\d$/.test(s) ? Date.parse(s) : Date.parse(String(s).replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? t : 0;
};

const stats = { users: 0, viaKey: 0, inserted: 0, updated: 0, skippedId: 0, activeSubs: 0, promos: 0, promosSkipped: 0 };
const totalDays = new Map(
  old.prepare('SELECT telegram_id id, SUM(duration_days) d FROM keys WHERE is_used=1 AND telegram_id IS NOT NULL GROUP BY telegram_id').all().map((r) => [r.id, r.d]),
);

const insert = db.prepare(`INSERT INTO users(id, first_name, username, created_at, tags, sub_until, sub_total_days, hwid, hwid_resets)
  VALUES(?,?,?,?,?,?,?,?,?)`);
const update = db.prepare(`UPDATE users SET
  username = COALESCE(username, ?),
  sub_until = MAX(sub_until, ?),
  sub_total_days = MAX(sub_total_days, ?),
  hwid = COALESCE(hwid, ?),
  created_at = MIN(created_at, ?)
  WHERE id = ?`);
const exists = db.prepare('SELECT 1 FROM users WHERE id=?');
const keyOwner = old.prepare('SELECT telegram_id FROM keys WHERE key_code=?');

const run = () => {
  const now = Date.now();
  for (const o of old.prepare('SELECT * FROM users').all()) {
    stats.users++;
    let tgId = String(o.telegram_id);
    // Строки user_<имя> создаются при активации ключа в клиенте; реальный ID лежит в ключе.
    if (!/^\d+$/.test(tgId)) {
      const k = o.active_key ? keyOwner.get(o.active_key) : null;
      if (!k || !/^\d+$/.test(String(k.telegram_id))) { stats.skippedId++; continue; }
      tgId = String(k.telegram_id);
      stats.viaKey++;
    }
    const id = Number(tgId);
    const until = toMs(o.expires_at);
    const created = toMs(o.created_at) || now;
    const days = totalDays.get(tgId) || 0;
    // Та же нормализация, что в consumeLaunch: иначе сверка при запуске не совпадёт.
    const hwid = o.hwid ? String(o.hwid).toUpperCase().replace(/[^0-9A-F-]/g, '').slice(0, 32) || null : null;
    if (exists.get(id)) {
      update.run(o.username || null, until, days, hwid, created, id);
      stats.updated++;
    } else {
      insert.run(id, '', o.username || null, created, '[]', until, days, hwid, START_HWID_RESETS);
      stats.inserted++;
    }
  }

  stats.activeSubs = db.prepare('SELECT COUNT(*) n FROM users WHERE sub_until>?').get(now).n;

  const setPromo = db.prepare('UPDATE users SET promo_code=? WHERE id=? AND promo_code IS NULL');
  const addPromo = db.prepare('INSERT OR IGNORE INTO promos(code, owner_id, created_at) VALUES(?,?,?)');
  const owned = old.prepare("SELECT user_id uid, code, created_at c FROM user_promocodes WHERE status='approved'").all();
  const byCreator = old.prepare('SELECT creator_id uid, code, created_at c FROM promocodes WHERE creator_id IS NOT NULL').all();
  for (const p of [...owned, ...byCreator]) {
    const uid = Number(p.uid);
    if (!/^[A-Za-z0-9]{4,16}$/.test(p.code) || !exists.get(uid)) { stats.promosSkipped++; continue; }
    if (addPromo.run(p.code, uid, toMs(p.c) || Date.now()).changes) { setPromo.run(p.code, uid); stats.promos++; }
    else stats.promosSkipped++;
  }
};

if (a['dry-run']) {
  db.exec('BEGIN');
  try { run(); } finally { db.exec('ROLLBACK'); }
  console.log('DRY RUN (nothing written):', stats);
} else {
  db.exec('BEGIN IMMEDIATE');
  try { run(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
  console.log('migrated:', stats);
}
