import { esc, bar, icon, logo, secHead, openLink } from '../ui.js';
import { post, HttpError } from '../api.js';
import { go, setState } from '../app.js';

const view = (S, st) => {
  const done = st === 'ok';
  const L = S.links;
  const chAva = `<img class="ch-ava" src="/img/channel.png" alt="">`;
  const head = done
    ? `<section class="field gate"><div class="res center"><span class="res-ico ok">${icon('check')}</span>
        <h1 class="res-t">Готово, доступ открыт</h1><p class="res-d">Спасибо за подписку на ${esc(L.channelTitle)} — открываем кабинет</p></div></section>`
    : `<section class="field gate glow"><span class="gate-ico">${icon('bell')}</span>
        <h1 class="gate-t">Подпишись на канал</h1>
        <p class="gate-d">Бот работает только для подписчиков канала проекта — там выходят обновления Hider и новости.</p></section>`;
  const right = done ? `<span class="s-r ok">1 из 1</span>` : `<span class="s-r">0 из 1</span>`;
  const act = done ? `<span class="pill ok">подписан</span>`
    : `<button class="btn-sm" data-ext="${esc(L.channel)}">Подписаться${icon('external')}</button>`;
  return `<main class="app gate-screen">
    ${bar({ title: 'Hider', back: false, meta: 'вход в бота' })}
    ${head}
    <section class="sec">${secHead('Обязательная подписка', 'открой канал и нажми «Подписаться»', right)}
      <div class="field ch-row">${chAva}<div class="ch-text"><span class="ch-t">${esc(L.channelTitle)}</span><span class="ch-h ${st === 'nf' ? 'bad' : ''}">${esc(L.channelName)}</span></div>${act}</div>
    </section>
    ${st === 'nf' ? `<div class="note bad">${icon('bell')}<span>Подписка не найдена. Открой канал, нажми «Подписаться» и проверь ещё раз</span></div>` : ''}
    <div class="foot grow-end">
      <button class="btn" id="chk">${icon(done ? 'check' : 'reset')}<span>${done ? 'Открыть кабинет' : st === 'nf' ? 'Проверить ещё раз' : 'Проверить подписку'}</span></button>
      <p class="foot-note">${done ? 'Откроем автоматически через пару секунд' : 'Подписался? Нажми — доступ откроется сразу'}</p>
    </div>
  </main>`;
};

export default async function gate(ctx) {
  let S = ctx.S;
  if (S.user.gate) { go('/', { replace: true }); return { html: '', mount() {} }; }
  const st = ctx.query.st || '';
  return {
    html: view(S, st),
    mount(el) {
      const btn = el.querySelector('#chk');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const ns = await post('/gate/check');
          setState(ns);
          el.outerHTML = view(ns, 'ok');
          const root = document.querySelector('#root');
          const open = () => go('/', { replace: true });
          root.querySelector('#chk').addEventListener('click', open);
          setTimeout(() => { if (location.hash.startsWith('#/gate')) open(); }, 2600);
        } catch (e) {
          if (e instanceof HttpError && e.code === 'not_subscribed') {
            el.outerHTML = view(S, 'nf');
            ctx.query.st = 'nf';
            gate({ ...ctx, query: { st: 'nf' } }).then((v) => v.mount(document.querySelector('#root > main')));
          } else {
            btn.disabled = false;
            (await import('../ui.js')).toast('Не удалось проверить, попробуй ещё раз');
          }
        }
      });
    },
  };
}
