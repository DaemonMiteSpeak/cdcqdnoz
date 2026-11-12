// Creates/refreshes a throwaway test account in a bot database and prints "username key".
// usage: node make-test-user.mjs <db> <id> <username> [days]
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
const [, , file, id, username, days = '3'] = process.argv;
const db = new DatabaseSync(file);
const key = 'HIDER-' + [0, 1, 2].map(() => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[crypto.randomInt(32)]).join('')).join('-');
const now = Date.now();
db.prepare('INSERT OR IGNORE INTO users(id, first_name, username, created_at, tags, hwid_resets, gate_ok) VALUES(?,?,?,?,?,2,1)').run(Number(id), 'E2E ' + username, username, now, '[]');
db.prepare('UPDATE users SET sub_until=?, sub_total_days=?, license_key=?, app_hwid=NULL, app_tv=0 WHERE id=?').run(now + Number(days) * 86400000, Number(days), key, Number(id));
console.log(username, key);
