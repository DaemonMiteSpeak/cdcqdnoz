// Creates a download ticket exactly like POST /api/download/ticket (without Telegram auth) for a test user.
import { createTicket } from '../src/download.js';
import { getUser } from '../src/service.js';
const [, , id, filename, rand] = process.argv;
const t = createTicket(getUser(Number(id)), { filename, randomSize: rand === '1' });
console.log(JSON.stringify(t));
process.exit(0);
