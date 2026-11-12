// Генерация ключей активации HIDER-XXXX-XXXX-XXXX.
// node tools/gen-keys.mjs --days 3 [--count 1] [--db <hider.db>]
import { parseArgs } from 'node:util';

const { values: a } = parseArgs({ options: { days: { type: 'string' }, count: { type: 'string' }, db: { type: 'string' } } });
const days = Number(a.days);
const count = Number(a.count || 1);
if (!Number.isInteger(days) || days < 1 || !Number.isInteger(count) || count < 1 || count > 1000) {
  console.error('usage: node tools/gen-keys.mjs --days <N> [--count <M>] [--db <hider.db>]');
  process.exit(1);
}
if (a.db) process.env.DB_FILE = a.db;
const { createKeys } = await import('../src/service.js');
for (const code of createKeys(days, count)) console.log(code);
