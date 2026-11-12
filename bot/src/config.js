import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const f = path.join(ROOT, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const env = process.env;
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export const config = {
  port: num(env.PORT, 3000),
  botToken: env.BOT_TOKEN || '',
  webappUrl: (env.WEBAPP_URL || '').replace(/\/$/, ''),
  channel: env.CHANNEL || '@hvhproduct',
  channelUrl: env.CHANNEL_URL || 'https://t.me/hvhproduct',
  channelTitle: env.CHANNEL_TITLE || 'HvH Product',
  supportUrl: env.SUPPORT_URL || 'https://t.me/shemember',
  admins: (env.ADMIN_IDS || '').split(',').map((s) => Number(s.trim())).filter(Boolean),
  dev: env.DEV === '1',
  dbFile: env.DB_FILE || path.join(ROOT, 'data', 'hider.db'),
  offerUrl: env.OFFER_URL || 'https://hider.su/offer',
  privacyUrl: env.PRIVACY_URL || 'https://hider.su/privacy',
  launchBase: (env.LAUNCH_BASE_URL || '').replace(/\/$/, ''),
  launchTtlMin: num(env.LAUNCH_TTL_MIN, 10),
  launchPayloadUrl: env.LAUNCH_PAYLOAD_URL || '',
  orderTtlMin: num(env.ORDER_TTL_MIN, 15),
  cryptoBotToken: env.CRYPTOBOT_TOKEN || '',
  cryptoBotApi: env.CRYPTOBOT_API || 'https://pay.crypt.bot/api',
  rubPerStar: num(env.RUB_PER_STAR, 1.5),
  sbpUrlTemplate: env.SBP_URL_TEMPLATE || '',
  sbpWebhookSecret: env.SBP_WEBHOOK_SECRET || '',
  sbpRequisites: env.SBP_REQUISITES || '',
  funpayLotUrl: env.FUNPAY_LOT_URL || '',
  relaySecret: env.RELAY_SECRET || '',
  internalPort: num(env.INTERNAL_PORT, 0),
  tlsKey: env.TLS_KEY || '',
  tlsCert: env.TLS_CERT || '',
};

export const PLANS = [
  { days: 7, price: 99 },
  { days: 14, price: 179 },
  { days: 30, price: 299 },
  { days: 90, price: 749 },
];
export const HWID_PACKS = [
  { count: 1, price: 49 },
  { count: 3, price: 129 },
  { count: 5, price: 199 },
];
export const TAG_PRICE = 29;
export const PROMO_BUYER_PCT = 10;
export const PROMO_AUTHOR_PCT = 12;
export const MIN_WITHDRAW = 500;
export const HWID_COOLDOWN_MS = 24 * 3600 * 1000;
export const START_HWID_RESETS = 2;
export const VIDEO_WINDOW_MS = 2 * 24 * 3600 * 1000;

export const TAGS = [
  { id: 'wtf', title: 'wtf', color: '#F2585B', free: true },
  { id: 'noshans', title: 'без шансов', color: '#AC89DD', free: true },
  { id: 'taburetka', title: 'табуретка', color: '#DDB689', free: true },
  { id: 'otpor', title: 'отпор?', color: '#89B4DD', free: true },
  { id: 'claude', title: 'claude', color: '#DD9A7A', free: true },
  { id: 'imba', title: 'имба', color: '#DD898A' },
  { id: 'baza', title: 'база', color: '#89DDB0' },
  { id: 'tilt', title: 'тильт', color: '#DD89B8' },
  { id: 'rofl', title: 'рофл', color: '#DDD389' },
  { id: 'cringe', title: 'кринж', color: '#B4DD89' },
  { id: 'izi', title: 'изи', color: '#89D2DD' },
  { id: 'chill', title: 'на чилле', color: '#9AA6DD' },
  { id: 'nutakoe', title: 'ну такое', color: '#C4C4C4' },
  { id: 'mimokrok', title: 'мимокрок', color: '#C9A0DD' },
  { id: 'samtakoi', title: 'сам такой', color: '#E6A15A' },
  { id: 'neya', title: 'не я', color: '#8FDDCB' },
  { id: 'pofanu', title: 'по фану', color: '#DDB0D4' },
  { id: 'afk', title: 'afk', color: '#8E9AA6' },
  { id: 'gg', title: 'gg', color: '#6FCF7F' },
  { id: 'e404', title: '404', color: '#FF7A6B' },
];
export const FREE_TAGS = TAGS.filter((t) => t.free).map((t) => t.id);
