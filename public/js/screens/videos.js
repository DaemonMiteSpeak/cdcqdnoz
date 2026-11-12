import { esc, icon, bar, rub, rubK, num, dmy, toast } from '../ui.js';
import { get, post, HttpError } from '../api.js';
import { go } from '../app.js';

const dm = (ts) => { const d = new Date(ts); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`; };
const ST = { pending: ['на проверке', 'warn'], paid: ['выплачено', 'ok'], rejected: ['отклонён', 'bad'] };

export default async function videos({ S, query }) {
  let tab = query.tab === 'list' ? 'list' : 'submit';
  let url = '';
  let info = null;
  let err = '';
  let sent = null;
  let list = null;

  const noStatus = () => `<main class="app">${bar({ title: 'Медиа' })}<section class="field gate"><div class="res center"><span class="res-ico warn">${icon('badge')}</span><h1 class="res-t">Нужен статус Медиа</h1>
    <p class="res-d">Просмотры без статуса не оплачиваются. Промокод и ${S.catalog.authorPct}% с покупок работают и без него</p></div></section>
    <div class="foot"><button class="btn" data-ext="${esc(S.links.support)}">${icon('badge')}<span>Стать медиа — ${esc(S.links.support.replace('https://t.me/', '@'))}</span></button><button class="btn ghost" data-go="/media">Назад</button></div></main>`;

  const submitView = () => {
    if (sent) {
      return `<main class="app">${bar({ title: 'Медиа' })}<section class="field gate"><div class="res center"><span class="res-ico ok">${icon('check')}</span><h1 class="res-t">Заявка отправлена</h1>
        <p class="res-d">Проверим в течение 24 часов — статус придёт в бот</p></div></section>
        <div class="field rows"><div class="row"><span class="k">Ролик</span><span class="v">${esc(sent.short)}</span></div><div class="row"><span class="k">Просмотров</span><span class="v">${num(sent.views)}</span></div>
          <div class="row"><span class="k">Ожидаемая выплата</span><span class="v ok">≈ ${rubK(sent.payoutK)}</span></div><div class="row"><span class="k">Статус</span><span class="pill warn">на проверке</span></div></div>
        <div class="foot"><button class="btn" data-go="/media/videos?tab=list">${icon('eye')}<span>Мои ролики</span></button><button class="btn ghost" data-go="/media">Готово</button></div></main>`;
    }
    let card = '';
    if (info) {
      card = `<div class="field vcard"><div class="v-t">${icon('film')}<b>${esc(info.title)}</b></div>
        <div class="row"><span class="k">Дата выхода</span><span class="v">${dmy(info.publishedAt)}</span></div>
        <div class="row"><span class="k">Просмотров</span><span class="v">${num(info.views)}</span></div>
        <div class="row"><span class="k">${info.windowOpen ? 'Можно подать ещё' : 'Окно подачи'}</span><span class="v ${info.windowOpen ? '' : 'bad'}">${info.windowOpen ? `${info.daysLeft} дн.` : 'закрыто'}</span></div>
        <div class="row"><span class="k">Выплата</span><span class="v ${info.payoutK ? 'ok' : ''}">${rubK(info.payoutK)}</span></div></div>
        ${info.windowOpen ? '' : '<p class="hint bad">Ролик вышел больше 2 дней назад — заявки принимаем не позднее чем через 2 дня после выхода</p>'}`;
    }
    return `<main class="app">${bar({ title: 'Отправить ролик', right: `<button class="btn-sm" data-go="/media/videos?tab=list">${icon('eye')}Мои</button>` })}
      <section class="sec"><div class="sec-head"><div><span class="s-t">Ссылка на ролик</span><span class="s-d">TikTok или YouTube · оплата один раз, без накрутки</span></div></div>
        <div class="stack"><div class="field promo dark ${err ? 'err' : ''}">${icon('play')}<input id="vurl" inputmode="url" placeholder="https://www.tiktok.com/@…/video/…" autocomplete="off" autocapitalize="off" value="${esc(url)}"><button class="btn-sm" id="vfind">Найти</button></div>
        ${err ? `<p class="hint bad">${err}</p>` : ''}</div></section>
      ${card}
      <button class="btn" id="vsend" ${info?.windowOpen ? '' : 'disabled'}>${icon('arrowRight')}<span>${info?.windowOpen ? 'Отправить на проверку' : 'Отправить на проверку'}</span></button></main>`;
  };

  const listView = () => {
    const rows = list || [];
    const pend = rows.filter((v) => v.status === 'pending').reduce((s, v) => s + v.payout_k, 0);
    const paid = rows.filter((v) => v.status === 'paid').reduce((s, v) => s + v.payout_k, 0);
    return `<main class="app">${bar({ title: 'Мои ролики', meta: `${rows.length} шт.` })}
      <div class="field sums"><div><i>На проверке</i><b>≈ ${rubK(pend)}</b></div><div><i>Выплачено</i><b class="ok">${rubK(paid)}</b></div></div>
      <section class="sec"><div class="field vlist">${rows.length ? rows.map((v) => `<div class="vrow"><div class="vt"><b>${esc(v.title || v.url)}</b><span>${dm(v.published_at)} · ${num(v.views || 0)} просмотров</span></div>
        <div class="vr"><b>${v.status === 'pending' ? '≈ ' : ''}${rubK(v.payout_k)}</b><span class="pill ${ST[v.status][1]}">${ST[v.status][0]}</span></div></div>`).join('') : '<p class="empty">Пока нет роликов</p>'}</div></section>
      <p class="foot-note">Статус обновляется в течение 24 часов. Вопросы по отказу — ${esc(S.links.support.replace('https://t.me/', '@'))}</p>
      <button class="btn" data-go="/media/videos">${icon('film')}<span>Отправить ролик</span></button></main>`;
  };

  if (tab === 'list') list = (await get('/media/videos')).videos;
  const view = () => (!S.media.status && tab === 'submit' ? noStatus() : tab === 'list' ? listView() : submitView());
  return {
    html: view(),
    mount(el) {
      const root = el.parentElement;
      const bind = () => {
        const inp = root.querySelector('#vurl');
        const find = async () => {
          url = inp.value.trim(); err = ''; info = null;
          const b = root.querySelector('#vfind'); b.disabled = true; b.textContent = '…';
          try { info = await post('/media/lookup', { url }); } catch (e) { err = ({ bad_url: 'Нужна ссылка на ролик TikTok или YouTube', video_not_found: 'Ролик не найден', lookup_unavailable: 'Проверка YouTube сейчас недоступна', lookup_failed: 'Не удалось получить данные ролика — попробуй позже' })[e.code] || 'Не удалось проверить ссылку'; }
          root.innerHTML = view(); bind();
        };
        root.querySelector('#vfind')?.addEventListener('click', find);
        inp?.addEventListener('keydown', (e) => { if (e.key === 'Enter') find(); });
        root.querySelector('#vsend')?.addEventListener('click', async (e) => {
          e.currentTarget.disabled = true;
          try { const r = await post('/media/videos', { url }); sent = { short: url.replace(/^https?:\/\/(www\.)?/, '').replace(/^(.{12}).*(.{8})$/, '$1…$2'), views: info.views, payoutK: r.payoutK }; root.innerHTML = view(); bind(); }
          catch (er) { err = ({ too_late: 'Окно подачи закрыто', video_exists: 'Этот ролик уже отправлен', no_media_status: 'Нужен статус Медиа' })[er.code] || 'Не удалось отправить'; root.innerHTML = view(); bind(); }
        });
      };
      bind();
    },
  };
}
