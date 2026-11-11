import { esc, bar, icon, profileCard, tagOf, days, dmy, hm, plural, secHead, toast } from '../ui.js';
import { post, HttpError } from '../api.js';
import { setState, go } from '../app.js';

const sheet = (html) => `<div class="scrim" data-close></div><div class="sheet"><div class="sheet-in">${html}</div></div>`;
const resIco = (cls, ic) => `<span class="res-ico ${cls}">${icon(ic)}</span>`;
const kv = (k, v, cls = '') => `<div class="row"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;
const left = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
};

function render(S) {
  const t = tagOf(S, S.user.tag);
  const on = S.sub.active;
  const hwid = S.hwid.value || '—';
  const since = Math.max(1, Math.floor((Date.now() - S.user.createdAt) / 86400000));
  const resets = S.hwid.resets;
  const stats = S.stats;
  return `<main class="app prof">
    <header class="bar"><button class="back" data-go="/" data-back aria-label="На главную">${icon('chevronLeft')}</button><span class="bar-title">Профиль</span></header>
    ${profileCard(S, { top: 'Добрый день,', sub: `с нами с ${dmy(S.user.createdAt)}` }).replace('Добрый день,', greet())}
    <section class="sec">${secHead('Подписка', on ? `до ${dmy(S.sub.until)}` : 'срок истёк', on ? '<span class="s-r ok">активна</span>' : '<span class="s-r bad">не активна</span>')}
      <div class="field sub">
        <div class="days-row"><span class="days ${on ? '' : 'zero'}">${S.sub.daysLeft}<small>${plural(S.sub.daysLeft, 'день', 'дня', 'дней')}</small></span>
          ${on ? `<button class="btn-sm" id="revoke">${icon('power', 'red')}Отключить</button>` : `<button class="btn-sm red" data-go="/buy">${icon('star')}Купить</button>`}</div>
        <div class="track"><div class="fill" style="width:${Math.round(S.sub.progress * 100)}%"></div></div>
      </div>
    </section>
    ${on ? `<button class="btn" data-go="/launch">${icon('power')}<span>Запустить Hider</span></button>`
      : `<button class="btn off" data-go="/buy">${icon('lock')}<span>Запустить Hider</span><span class="need">· нужна подписка</span></button>`}
    <button class="field row-btn" data-go="/tags">${icon('tag', 'ic')}<span class="grow m-t">Тег профиля</span><span class="m-r" style="color:${t.color}">${esc(t.title)}</span>${icon('chevronRight', 'chev')}</button>
    <section class="sec">${secHead('Статистика', 'за всё время')}
      <div class="field rows">
        ${kv('Запуски', stats.launches)}
        ${kv('Последний запуск', stats.lastLaunchAt ? hm(stats.lastLaunchAt) : '—')}
        ${kv('С нами', `${since} ${plural(since, 'день', 'дня', 'дней')}`)}
      </div>
    </section>
    <div class="stack ${resets ? '' : 'nores'}">
      <div class="field hw"><span class="hw-k">HWID</span><span class="hw-v mono">${esc(hwid)}</span>
        <button class="btn-sm" id="reset" ${resets ? '' : 'data-none'}>${icon('reset')}Сбросить<span class="cnt">${resets}</span></button></div>
      ${resets ? '' : `<button class="hw-note" data-go="/buy?tab=hwid">Сбросы закончились — купить сброс</button>`}
    </div>
    <div id="layer"></div>
  </main>`;
}
const greet = () => { const h = new Date().getHours(); return h >= 5 && h < 12 ? 'Доброе утро,' : h >= 12 && h < 18 ? 'Добрый день,' : h >= 18 && h < 23 ? 'Добрый вечер,' : 'Доброй ночи,'; };

export default async function profile(ctx) {
  let S = ctx.S;
  return {
    html: render(S),
    mount(el) {
      const layer = el.querySelector('#layer');
      const close = () => { layer.innerHTML = ''; };
      layer.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
      el.querySelector('#revoke')?.addEventListener('click', async () => {
        try { await post('/launch/revoke'); toast('Запущенные команды отключены'); } catch { toast('Не удалось отключить'); }
      });
      el.querySelector('#reset').addEventListener('click', () => {
        const hw = S.hwid;
        if (hw.resets <= 0) {
          layer.innerHTML = sheet(`<div class="res center">${resIco('warn', 'ban')}<h2 class="res-t">Сбросы закончились</h2><p class="res-d">На аккаунте не осталось сбросов HWID. Докупи — начислим сразу после оплаты</p></div>
            <div class="btns one"><button class="btn" data-go="/buy?tab=hwid">${icon('reset')}<span>Купить сброс</span></button></div>`);
          return;
        }
        if (hw.nextResetAt && hw.nextResetAt > Date.now()) return tooOften(layer, hw, close);
        layer.innerHTML = sheet(`<div class="res center">${resIco('warn', 'reset')}<h2 class="res-t">Точно сбросить HWID?</h2>
          <p class="res-d">Привязка ${esc(hw.value || '—')} удалится. Новый HWID привяжется при следующем запуске Hider</p></div>
          <div class="field rows in">${kv('Останется сбросов', `${hw.resets - 1} из ${hw.resets}`)}${kv('Следующий сброс', 'через 24 часа')}</div>
          <div class="btns"><button class="btn ghost" data-close>Отмена</button><button class="btn" id="doreset">${icon('reset')}<span>Сбросить</span></button></div>`);
        layer.querySelector('#doreset').addEventListener('click', async (e) => {
          e.currentTarget.disabled = true;
          try {
            const ns = await post('/hwid/reset');
            setState(ns); S = ns;
            layer.innerHTML = sheet(`<div class="res center"><span class="res-pill warn">привяжется при запуске</span>${resIco('ok', 'check')}<h2 class="res-t">HWID сброшен</h2>
              <p class="res-d">Новый HWID привяжется при следующем запуске Hider — запусти программу на нужном ПК</p></div>
              <div class="field rows in">${kv('Осталось сбросов', ns.hwid.resets)}${kv('Статус', 'ждёт запуска', 'warn')}</div>
              <div class="btns one"><button class="btn" id="done">${icon('check')}<span>Готово</span></button></div>`);
            layer.querySelector('#done').addEventListener('click', () => { el.outerHTML = render(S); go('/profile', { replace: true }); location.reload(); });
          } catch (er) {
            if (er instanceof HttpError && er.code === 'too_often') { S.hwid.nextResetAt = er.body.retryAt; S.hwid.lastResetAt = er.body.lastResetAt; tooOften(layer, S.hwid, close); }
            else { close(); toast('Не удалось сбросить HWID'); }
          }
        });
      });
    },
  };
}

function tooOften(layer, hw, close) {
  layer.innerHTML = sheet(`<div class="res center">${resIco('warn', 'clock')}<h2 class="res-t">Сбросить пока нельзя</h2>
    <p class="res-d">HWID можно сбрасывать раз в 24 часа. Последний сброс — ${new Date(hw.lastResetAt).toDateString() === new Date().toDateString() ? 'сегодня' : dmy(hw.lastResetAt)} в ${hm(hw.lastResetAt)}</p></div>
    <div class="field cd"><span class="k">Следующий сброс</span><span class="v mono" id="cd">${left(hw.nextResetAt - Date.now())}</span></div>
    <div class="btns one"><button class="btn ghost" data-close>Понятно</button></div>`);
  const cd = layer.querySelector('#cd');
  const t = setInterval(() => { if (!cd.isConnected) return clearInterval(t); const ms = hw.nextResetAt - Date.now(); cd.textContent = left(ms); if (ms <= 0) { clearInterval(t); close(); } }, 1000);
}
