import { esc, icon, bar, toast, openExternal } from '../ui.js';
import { get, post, HttpError } from '../api.js';
import { go } from '../app.js';

const NAMES = ['Setup', 'Update', 'Installer', 'Driver', 'Service', 'Runtime', 'Helper', 'Launcher', 'Manager', 'Toolkit', 'Assistant', 'Utility', 'Package', 'Console', 'Monitor', 'Sync', 'Bridge', 'Agent', 'Center', 'Studio'];
const randomName = () => {
  const pick = (a) => a[crypto.getRandomValues(new Uint32Array(1))[0] % a.length];
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 900 + 100;
  return `${pick(NAMES)}${pick(NAMES)}${n}`;
};
const mb = (b) => `${(b / 1048576).toFixed(1).replace('.', ',')} МБ`;
const LS = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };

const ERR = {
  sub_required: 'Нужна активная подписка',
  bad_filename: 'Недопустимое имя файла',
  release_unavailable: 'Файл временно недоступен, попробуй позже',
};

function view(A, st) {
  const rel = A.release;
  return `<main class="app dl">${bar({ title: 'Запуск Hider', meta: 'Windows 10 / 11' })}
    <section class="sec"><div class="sec-head"><div><span class="s-t">Скачать программу</span><span class="s-d">портативный EXE — установка не нужна</span></div><span class="s-r">${rel ? mb(rel.size) : '—'}</span></div>
      <label class="field dl-name ${st.err ? 'err' : ''}">
        <span class="dl-k">Имя файла</span>
        <span class="dl-row"><input id="fname" type="text" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="60" value="${esc(st.name)}" placeholder="Hider"><em>.exe</em>
          <button type="button" class="dice" id="dice" aria-label="Случайное имя">${icon('dice')}</button></span>
      </label>
      <button type="button" class="field row-btn dl-tg" id="rs" role="switch" aria-checked="${st.rand}">
        ${icon('file', 'ic')}<span class="grow dl-tt"><b>Случайный размер</b><small>добавит к файлу от 0 до 15 МБ</small></span>
        <span class="sw ${st.rand ? 'on' : ''}"><i></i></span>
      </button>
    </section>
    <div class="note warnbox">${icon('shield')}<span><b>Запускай от имени администратора</b><br><small>ПКМ по файлу → «Запуск от имени администратора». Без этого часть функций, которым нужны повышенные права, не заработает</small></span></div>
    <section class="sec"><div class="sec-head"><div><span class="s-t">Данные для входа</span><span class="s-d">введи их в программе при первом запуске</span></div></div>
      <div class="field rows dl-cred">
        <div class="row"><span class="k">Username</span><span class="v mono">${A.username ? esc(A.username) : '<span class="warn">не задан в Telegram</span>'}</span></div>
        <div class="row"><span class="k">Ключ</span><span class="v mono" id="lk">${A.licenseKey ? esc(A.licenseKey) : '—'}</span><button class="btn-sm" id="cp" type="button">${icon('copy')}Копировать</button></div>
      </div>
      ${A.username ? '' : '<p class="dl-hint">Без username можно войти по своему Telegram ID — он указан в профиле</p>'}
    </section>
    <button class="btn ${st.busy ? 'busy' : ''}" id="get" ${rel && !st.busy ? '' : 'disabled'}>${icon('download')}<span>${st.busy ? 'Готовим файл…' : 'Скачать EXE'}</span></button>
    ${st.link ? `<section class="sec"><div class="sec-head"><div><span class="s-t">Прямая ссылка</span><span class="s-d">откройте в браузере — файл скачается · действует 6 часов</span></div></div>
      <div class="field dl-link"><code id="lnk">${esc(st.link)}</code></div>
      <div class="dl-actions"><button class="btn-sm" id="cplink" type="button">${icon('copy')}Копировать ссылку</button><button class="btn-sm" id="openlink" type="button">${icon('external')}Открыть в браузере</button></div>
      <p class="dl-hint">Лучше всего: нажмите «Копировать ссылку» и вставьте её в адресную строку браузера. Если Telegram предложит скачать файл сам — откажитесь и используйте браузер.</p></section>` : ''}
    ${st.done ? `<p class="dl-hint ok">${esc(st.done)}</p>` : ''}
  </main>`;
}

export default async function launch({ S }) {
  if (!S.sub.active) { go('/buy', { replace: true }); return { html: '', mount() {} }; }
  const A = await get('/app');
  const st = { name: LS.get('hider.dl.name', 'Hider'), rand: LS.get('hider.dl.rand', '0') === '1', busy: false, done: '', err: false, link: '' };
  const paint = (root, keepFocus) => {
    root.innerHTML = view(A, st);
    const input = root.querySelector('#fname');
    input.addEventListener('input', () => { st.name = input.value; st.err = false; LS.set('hider.dl.name', st.name); input.closest('.field').classList.remove('err'); });
    root.querySelector('#dice').addEventListener('click', () => { st.name = randomName(); LS.set('hider.dl.name', st.name); st.done = ''; paint(root); });
    root.querySelector('#rs').addEventListener('click', () => { st.rand = !st.rand; LS.set('hider.dl.rand', st.rand ? '1' : '0'); st.done = ''; paint(root); });
    root.querySelector('#cp').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(A.licenseKey || ''); } catch {
        const ta = document.createElement('textarea'); ta.value = A.licenseKey || ''; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      toast('Ключ скопирован');
    });
    const copyText = async (text) => {
      try { await navigator.clipboard.writeText(text); } catch {
        const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
    };
    root.querySelector('#cplink')?.addEventListener('click', async () => { await copyText(st.link); toast('Ссылка скопирована'); });
    root.querySelector('#openlink')?.addEventListener('click', () => openExternal(st.link));
    root.querySelector('#get').addEventListener('click', async () => {
      st.busy = true; st.done = ''; paint(root);
      try {
        const t = await post('/download/ticket', { filename: st.name.trim() || 'Hider', randomSize: st.rand });
        st.link = t.url;
        // No auto-open: Telegram opens links in its own browser and offers to download the file itself.
        // The user copies the link (or taps "open in browser") and downloads it outside Telegram.
        toast('Ссылка готова — скопируйте и откройте в браузере');
        st.done = `${t.filename} · ${mb(t.size)}${t.extraBytes ? ` (+${mb(t.extraBytes)})` : ''}`;
      } catch (e) {
        const code = e instanceof HttpError ? e.code : '';
        if (code === 'bad_filename') st.err = true;
        toast(ERR[code] || 'Не удалось начать загрузку');
      }
      st.busy = false; paint(root);
    });
    if (keepFocus) input.focus();
  };
  return { html: view(A, st), mount(el) { paint(el.parentElement); } };
}
