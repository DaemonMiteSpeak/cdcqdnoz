// Imports legacy license keys (old bot licenses.db) and old auth-service accounts into the unified database.
// Safe to re-run. Usage: node tools/migrate-keys.mjs --old <licenses.db> [--auth <hider-auth data.db>] [--db <hider.db>] [--dry-run]
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';

const { values: a } = parseArgs({ options: { old: { type: 'string' }, auth: { type: 'string' }, db: { type: 'string' }, 'dry-run': { type: 'boolean' } } });
if (!a.old) { console.error('usage: node tools/migrate-keys.mjs --old <licenses.db> [--auth <data.db>] [--db <hider.db>] [--dry-run]'); process.exit(1); }
if (a.db) process.env.DB_FILE = a.db;
const { db } = await import('../src/db.js');
const old = new DatabaseSync(a.old, { readOnly: true });

const toMs = (s) => {
  if (!s) return 0;
  const t = /Z|[+-]\d\d:?\d\d$/.test(s) ? Date.parse(s) : Date.parse(String(s).replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? t : 0;
};
const st = { keys: 0, keysNew: 0, owned: 0, ownerByName: 0, usedNoOwner: 0, blocked: 0, authSubRaised: 0, authInserted: 0 };

const userById = db.prepare('SELECT id FROM users WHERE id=?');
const usersByName = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE');
const insKey = db.prepare(`INSERT OR IGNORE INTO keys(code, days, created_at, used_by, used_at, norm, blocked, block_reason, owner_username, legacy)
  VALUES(?,?,?,?,?,?,?,?,?,1)`);

const run = () => {
  for (const k of old.prepare('SELECT * FROM keys').all()) {
    st.keys++;
    const code = String(k.key_code).trim();
    const norm = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!norm) continue;
    let owner = null;
    const tid = /^\d+$/.test(String(k.telegram_id ?? '')) ? Number(k.telegram_id) : null;
    if (tid && userById.get(tid)) { owner = tid; st.owned++; }
    else if (k.is_used && k.username) {
      const m = usersByName.all(String(k.username).replace(/^@/, ''));
      if (m.length === 1) { owner = m[0].id; st.ownerByName++; }
    }
    const usedAt = k.is_used ? (toMs(k.activated_at) || toMs(k.created_at) || 1) : null;
    if (k.is_used && !owner) st.usedNoOwner++;
    if (k.is_blocked) st.blocked++;
    const r = insKey.run(code, Number(k.duration_days) || 0, toMs(k.created_at) || Date.now(), owner, usedAt, norm,
      k.is_blocked ? 1 : 0, k.block_reason || null, k.username || null);
    if (r.changes) st.keysNew++;
  }
  if (a.auth) {
    const au = new DatabaseSync(a.auth, { readOnly: true });
    const ins = db.prepare('INSERT INTO users(id, first_name, username, created_at, tags, sub_until, hwid_resets, banned) VALUES(?,?,?,?,?,?,2,?)');
    for (const u of au.prepare('SELECT * FROM users').all()) {
      const cur = userById.get(u.tg_id) && db.prepare('SELECT sub_until FROM users WHERE id=?').get(u.tg_id);
      const until = Number(u.sub_until) || 0;
      if (cur) {
        if (until > cur.sub_until) { db.prepare('UPDATE users SET sub_until=? WHERE id=?').run(until, u.tg_id); st.authSubRaised++; }
      } else {
        ins.run(u.tg_id, u.first_name || '', u.username || null, Number(u.created) || Date.now(), '[]', until, u.banned ? 1 : 0);
        st.authInserted++;
      }
    }
  }
};

db.exec('BEGIN IMMEDIATE');
try { run(); db.exec(a['dry-run'] ? 'ROLLBACK' : 'COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
console.log(a['dry-run'] ? 'DRY RUN (nothing written):' : 'migrated:', st);
