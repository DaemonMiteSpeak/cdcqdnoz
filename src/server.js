import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import { config, ROOT } from './config.js';
import * as S from './service.js';
import { startPayment, checkPayment } from './payments.js';
import { checkChannel } from './bot.js';
import { db } from './db.js';
import { lookupVideo } from './video.js';

export function verifyInitData(raw) {
  const p = new URLSearchParams(raw);
  const hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const str = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(config.botToken).digest();
  const calc = crypto.createHmac('sha256', secret).update(str).digest('hex');
  if (calc.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  if (Date.now() / 1000 - Number(p.get('auth_date')) > 86400) return null;
  try {
    return JSON.parse(p.get('user'));
  } catch {
    return null;
  }
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => {
  if (e instanceof S.ApiError) return res.status(e.status).json({ error: e.code, ...e.extra });
  console.error(e);
  res.status(500).json({ error: 'internal' });
});

export function createServer(bot) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  /* public one-liner target: validates the token and hands over to the configured payload */
  app.get('/r/:token', wrap(async (req, res) => {
    const u = S.consumeLaunch(String(req.params.token).toUpperCase(), req.query.hwid);
    if (!config.launchPayloadUrl) return res.status(503).type('text/plain').send('# payload not configured');
    const sep = config.launchPayloadUrl.includes('?') ? '&' : '?';
    res.redirect(302, `${config.launchPayloadUrl}${sep}uid=${u.id}`);
  }));

  app.post('/webhooks/sbp', wrap(async (req, res) => {
    if (!config.sbpWebhookSecret || req.get('x-webhook-secret') !== config.sbpWebhookSecret) return res.sendStatus(403);
    const o = S.getOrder(Number(req.body.order_id));
    if (!o || o.method !== 'sbp' || Number(req.body.amount) < o.amount_rub) return res.sendStatus(400);
    S.settleOrder(o.id, { by: 'sbp' });
    res.json({ ok: true });
  }));

  const api = express.Router();
  api.use(wrap(async (req, res, next) => {
    let tg = null;
    const auth = req.get('authorization') || '';
    if (auth.startsWith('tma ') && config.botToken) tg = verifyInitData(auth.slice(4));
    if (!tg && config.dev && req.get('x-dev-user')) {
      tg = { id: Number(req.get('x-dev-user')), first_name: req.get('x-dev-name') || 'Dev', username: req.get('x-dev-username') || 'YukeeDesign' };
    }
    if (!tg) return res.status(401).json({ error: 'unauthorized' });
    req.user = S.upsertUser(tg);
    next();
  }));

  const needGate = (req, res, next) => {
    if (S.stateFor(req.user).maintenance && !config.admins.includes(req.user.id)) return res.status(503).json({ error: 'maintenance' });
    if (!req.user.gate_ok) return res.status(403).json({ error: 'gate' });
    next();
  };

  api.get('/state', wrap(async (req, res) => {
    res.json(S.stateFor(S.getUser(req.user.id)));
  }));

  api.post('/gate/check', wrap(async (req, res) => {
    let ok = false;
    if (bot) ok = await checkChannel(bot.api, req.user.id);
    else if (config.dev) ok = req.user.gate_ok === 1;
    else throw new S.ApiError(503, 'bot_unavailable');
    S.setGate(req.user.id, ok);
    if (!ok) throw new S.ApiError(409, 'not_subscribed');
    res.json(S.stateFor(S.getUser(req.user.id)));
  }));

  if (config.dev) {
    /* design-fixture seeding, only with DEV=1 */
    api.post('/dev/seed', wrap(async (req, res) => {
      const b = req.body || {};
      const set = (k, v) => db.prepare(`UPDATE users SET ${k}=? WHERE id=?`).run(v, req.user.id);
      if (b.promo) { db.prepare('INSERT OR IGNORE INTO promos(code, owner_id, created_at) VALUES(?,?,?)').run(b.promo, req.user.id, Date.now()); set('promo_code', b.promo); }
      for (const k of ['gate_ok', 'sub_until', 'sub_total_days', 'hwid', 'hwid_resets', 'last_reset_at', 'launches', 'last_launch_at', 'tag', 'tags', 'media_status', 'balance_k', 'earned_k', 'withdrawn_k', 'created_at', 'photo_url']) {
        if (k in b) set(k, b[k]);
      }
      res.json(S.stateFor(S.getUser(req.user.id)));
    }));
  }

  api.use(needGate);

  api.post('/hwid/reset', wrap(async (req, res) => {
    const u = S.resetHwid(req.user);
    res.json(S.stateFor(u));
  }));
  api.post('/tags/select', wrap(async (req, res) => res.json(S.stateFor(S.selectTag(req.user, req.body.tag)))));

  api.get('/launch', wrap(async (req, res) => res.json({ launch: S.launchCommand(req.user) })));
  api.post('/launch', wrap(async (req, res) => res.json({ launch: S.createLaunch(req.user) })));

  api.post('/launch/revoke', wrap(async (req, res) => { S.revokeLaunch(req.user); res.json({ ok: true }); }));

  api.post('/quote', wrap(async (req, res) => res.json(S.quote(req.user, req.body))));

  api.post('/orders', wrap(async (req, res) => {
    const id = S.createOrder(req.user, req.body);
    let o = S.getOrder(id);
    try {
      o = await startPayment(o);
    } catch (e) {
      db.prepare("UPDATE orders SET status='cancelled', note=? WHERE id=?").run(`start_failed:${e.message}`, id);
      console.error('startPayment', e.message);
      throw new S.ApiError(502, 'payment_start_failed');
    }
    res.json(S.orderView(o));
  }));
  api.get('/orders/:id', wrap(async (req, res) => res.json(S.orderView(S.orderFor(req.user, Number(req.params.id))))));
  api.post('/orders/:id/check', wrap(async (req, res) => {
    const o = await checkPayment(S.orderFor(req.user, Number(req.params.id)));
    res.json({ order: S.orderView(S.orderFor(req.user, o.id)), state: S.stateFor(S.getUser(req.user.id)) });
  }));
  api.post('/orders/:id/cancel', wrap(async (req, res) => res.json(S.orderView(S.cancelOrder(req.user, Number(req.params.id))))));

  api.post('/media/promo', wrap(async (req, res) => res.json(S.stateFor(S.createPromo(req.user, req.body.code)))));
  api.get('/media/videos', wrap(async (req, res) => res.json({ videos: S.listVideos(req.user) })));
  api.post('/media/lookup', wrap(async (req, res) => res.json(S.videoQuote(await lookupVideo(String(req.body.url || '').trim())))));
  api.post('/media/videos', wrap(async (req, res) => {
    const url = String(req.body.url || '').trim();
    res.json(S.submitVideo(req.user, url, await lookupVideo(url)));
  }));
  api.get('/withdrawals', wrap(async (req, res) => res.json({ items: S.listWithdrawals(req.user) })));
  api.post('/withdrawals', wrap(async (req, res) => {
    const id = S.requestWithdrawal(req.user, req.body);
    res.json({ id, state: S.stateFor(S.getUser(req.user.id)) });
  }));

  app.use('/api', api);
  app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'], maxAge: config.dev ? 0 : '1h' }));
  app.use((req, res) => res.status(404).type('text/plain').send('Not found'));
  return app;
}
