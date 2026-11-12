import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
export const db = new DatabaseSync(config.dbFile);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL DEFAULT '',
  username TEXT,
  photo_url TEXT,
  created_at INTEGER NOT NULL,
  tag TEXT NOT NULL DEFAULT 'wtf',
  tags TEXT NOT NULL DEFAULT '[]',
  sub_until INTEGER NOT NULL DEFAULT 0,
  sub_total_days INTEGER NOT NULL DEFAULT 0,
  hwid TEXT,
  hwid_resets INTEGER NOT NULL DEFAULT 2,
  last_reset_at INTEGER NOT NULL DEFAULT 0,
  launches INTEGER NOT NULL DEFAULT 0,
  last_launch_at INTEGER NOT NULL DEFAULT 0,
  gate_ok INTEGER NOT NULL DEFAULT 0,
  media_status INTEGER NOT NULL DEFAULT 0,
  balance_k INTEGER NOT NULL DEFAULT 0,
  earned_k INTEGER NOT NULL DEFAULT 0,
  withdrawn_k INTEGER NOT NULL DEFAULT 0,
  promo_code TEXT
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  item TEXT NOT NULL,
  base_rub INTEGER NOT NULL,
  amount_rub INTEGER NOT NULL,
  promo_code TEXT,
  method TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  paid_at INTEGER,
  ext_id TEXT,
  pay_url TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id);
CREATE TABLE IF NOT EXISTS promos (
  code TEXT PRIMARY KEY COLLATE NOCASE,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS launch_cmds (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  platform TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  is_long INTEGER NOT NULL DEFAULT 0,
  published_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  views INTEGER,
  payout_k INTEGER NOT NULL DEFAULT 0,
  note TEXT
);
CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  method TEXT NOT NULL,
  details TEXT NOT NULL,
  amount_k INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  note TEXT
);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS keys (
  code TEXT PRIMARY KEY,
  days INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  used_by INTEGER REFERENCES users(id),
  used_at INTEGER
);
CREATE TABLE IF NOT EXISTS broadcasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL,
  audience TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  total INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running'
);
CREATE TABLE IF NOT EXISTS admin_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  admin_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  info TEXT
);
`);
{
  const have = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
  for (const [col, def] of [['banned', 'INTEGER NOT NULL DEFAULT 0'], ['bot_blocked', 'INTEGER NOT NULL DEFAULT 0']]) {
    if (!have.has(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
  }
}
const seq = db.prepare("SELECT seq FROM sqlite_sequence WHERE name='orders'").get();
if (!seq) db.exec("INSERT INTO sqlite_sequence(name, seq) VALUES ('orders', 48212)");

export const kvGet = (k, d = null) => {
  const r = db.prepare('SELECT v FROM kv WHERE k=?').get(k);
  return r ? r.v : d;
};
export const kvSet = (k, v) => db.prepare('INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v));

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
