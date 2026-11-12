// Cloudflare Worker (free plan): Telegram Bot API relay for hosts that cannot reach api.telegram.org (Jino).
// Deploy: Cloudflare dashboard -> Workers & Pages -> Create -> paste this file -> Variables: ALLOWED_BOT_ID = <numeric bot id>.
// Then on Jino set  TG_API_ROOT=https://<name>.<account>.workers.dev  in ~/hider/bot/.env and restart the bot.
// Only requests for YOUR bot id are relayed, so the worker cannot be used as an open proxy.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = /^\/(file\/)?bot(\d+):/.exec(url.pathname);
    if (!m || !env.ALLOWED_BOT_ID || m[2] !== String(env.ALLOWED_BOT_ID)) return new Response('forbidden', { status: 403 });
    const target = new URL(url.pathname + url.search, 'https://api.telegram.org');
    const init = { method: request.method, headers: request.headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body, redirect: 'manual' };
    return fetch(target, init);
  },
};
