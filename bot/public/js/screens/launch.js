import { esc, icon, bar, hm, toast } from '../ui.js';
import { get, post, HttpError } from '../api.js';
import { go } from '../app.js';

const step = (n, state, t, d, extra = '') => `<div class="step ${state}"><span class="step-n">${state === 'done' ? icon('check') : n}</span>
  <div class="step-body"><span class="step-t">${t}</span>${d ? `<span class="step-d">${d}</span>` : ''}${extra}</div></div>`;

function view(S, L, copied) {
  const live = L && !L.expired;
  const old = L && L.expired;
  const steps = `<section class="sec"><div class="sec-head"><div><span class="s-t">Как запустить</span><span class="s-d">выполни шаги по порядку</span></div><span class="s-r">4 шага</span></div>
    <div class="field steps">
      ${live ? step(1, 'done', 'Сгенерируй команду') : step(1, 'cur', 'Сгенерируй команду', 'Кнопка внизу экрана — команда создастся на сервере')}
      ${step(2, live ? 'cur' : '', 'Скопируй её', 'Одним нажатием на «Скопировать команду»')}
      ${step(3, '', 'Выполни в cmd от админа', '<b class="warn">Обязательно</b> от администратора — иначе часть функций Hider не заработает', '<div class="kbds"><kbd>Win</kbd><s>→</s><kbd>cmd</kbd><s>→</s><kbd>Ctrl+Shift+Enter</kbd></div>')}
      ${step(4, '', 'Дождись запуска и войди в аккаунт', 'Hider откроется сам — войди в свой аккаунт уже в программе')}
    </div></section>`;
  if (old) {
    return `<main class="app">${bar({ title: 'Запуск Hider', meta: 'Windows 10 / 11' })}
      <section class="sec"><div class="sec-head"><div><span class="s-t">Твоя команда</span><span class="s-d">создана в ${hm(L.createdAt)} · больше не сработает</span></div><span class="pill warn">устарела</span></div>
        <div class="field cmd old"><code>${esc(L.command)}</code></div></section>
      <div class="note warnbox">${icon('clock')}<span><b>Создай новую команду</b><br><small>Старая устарела — команда живёт 10 минут</small></span></div>
      <button class="btn" id="gen">${icon('reset')}<span>Создать новую команду</span></button></main>`;
  }
  if (!live) return `<main class="app">${bar({ title: 'Запуск Hider', meta: 'Windows 10 / 11' })}${steps}<button class="btn" id="gen">${icon('terminal')}<span>Сгенерировать команду</span></button></main>`;
  return `<main class="app">${bar({ title: 'Запуск Hider', meta: 'Windows 10 / 11' })}${steps}
    <section class="sec"><div class="sec-head"><div><span class="s-t">Твоя команда</span><span class="s-d">${copied ? 'скопирована в ' + hm(copied) : 'создана в ' + hm(L.createdAt)}</span></div>
      <button class="btn-sm" id="gen">${icon('reset')}Новая</button></div>
      <div class="field cmd"><code>${esc(L.command)}</code></div></section>
    <button class="btn ${copied ? 'okbtn' : ''}" id="copy">${icon(copied ? 'check' : 'copy')}<span>${copied ? 'Скопировано — вставь в cmd' : 'Скопировать команду'}</span></button></main>`;
}

export default async function launch({ S }) {
  if (!S.sub.active) { go('/buy', { replace: true }); return { html: '', mount() {} }; }
  let { launch: L } = await get('/launch');
  let copied = 0;
  const paint = (root) => {
    root.innerHTML = view(S, L, copied);
    root.querySelector('#gen')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try { ({ launch: L } = await post('/launch')); copied = 0; paint(root); } catch (er) { toast(er instanceof HttpError && er.code === 'sub_required' ? 'Нужна активная подписка' : 'Не удалось создать команду'); e.currentTarget.disabled = false; }
    });
    root.querySelector('#copy')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(L.command); } catch {
        const ta = document.createElement('textarea'); ta.value = L.command; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      copied = Date.now(); paint(root);
    });
  };
  return { html: view(S, L, copied), mount(el) { const root = el.parentElement; paint(root); if (L && !L.expired) setTimeout(() => { if (root.isConnected) get('/launch').then((r) => { L = r.launch; if (L?.expired) paint(root); }); }, Math.max(1000, L.expiresAt - Date.now() + 500)); } };
}
