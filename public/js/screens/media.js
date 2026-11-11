import { esc, icon, bar, rub, rubK, num, toast, openLink } from '../ui.js';
import { post, HttpError } from '../api.js';
import { go, setState } from '../app.js';

const slide = (ic, t, d, n, body) => `<section class="field slide"><div class="s-head"><span class="s-ico">${icon(ic)}</span><div class="s-tx"><b>${t}</b><i>${d}</i></div><span class="s-n">${n} / 3</span></div>${body}</section>`;

function promoBody(S, st) {
  const p = S.media.promo;
  if (!p) {
    const sug = st?.suggest?.length ? `<p class="hint bad">Код «${esc(st.code)}» уже занят. Свободны: ${st.suggest.map((c) => `<button class="sug" data-sug="${esc(c)}">${esc(c)}</button>`).join(' ')}</p>`
      : st?.invalid ? '<p class="hint bad">4–16 символов: только латиница и цифры</p>' : '<p class="hint">4–16 символов: латиница и цифры. Создать может каждый</p>';
    return `<p class="lead">Придумай свой код и делись им в роликах. Покупатель получает скидку ${S.catalog.buyerPct}%, а ты — ${S.catalog.authorPct}% с каждой покупки.</p>
      <div class="stack"><div class="field promo dark ${st ? 'err' : ''}">${icon('ticket')}<input id="pcode" placeholder="Например, YukeeDesign" maxlength="16" autocomplete="off" autocapitalize="off" value="${esc(st?.code || '')}"><button class="btn-sm red" id="pmake">Создать</button></div>${sug}</div>
      <div class="steps3"><div><b>01</b><span>создай код</span></div><div><b>02</b><span>делись в роликах</span></div><div><b>03</b><span>выводи ${S.catalog.authorPct}%</span></div></div>`;
  }
  return `<div class="stack"><div class="field promo ok">${icon('ticket')}<span class="code mono">${esc(p.code)}</span><button class="btn-sm" id="pcopy">Копировать</button></div>
      <p class="hint">Покупатель получает −${S.catalog.buyerPct}%, ты — ${S.catalog.authorPct}% с суммы покупки</p></div>
    <div class="stats4"><div><i>Активаций</i><b>${num(p.activations)}</b></div><div><i>Покупок на</i><b>${rub(p.purchasesRub)}</b></div>
      <div><i>Твой доход</i><b class="ok">${rubK(p.incomeK)}</b></div><div><i>Уже выведено</i><b>${rubK(p.withdrawnK)}</b></div></div>`;
}

const payBody = (S) => `<div class="plat"><img src="/img/tiktok.png" class="pimg" alt=""><b>TikTok</b></div>
  <div class="tbl"><div><span>1 000 просмотров</span><b>25 ₽</b></div><div><span>5 000 просмотров</span><b>150 ₽</b></div><div><span>10 000 просмотров</span><b>300 ₽</b></div></div>
  <div class="plat"><img src="/img/youtube.png" class="pimg" alt=""><b>YouTube</b><em>длинные видео</em></div>
  <div class="tbl"><div><span>1 просмотр</span><b>0,65 ₽</b></div></div>
  <p class="lead s">Можем договориться об <b>индивидуальных условиях</b>. Платим только со статусом Медиа</p>
  <div class="two"><button class="btn ghost" data-go="/media/videos">${icon('film')}<span>Отправить ролик</span></button><button class="btn ghost" data-go="/media/videos?tab=list">${icon('eye')}<span>Мои ролики</span></button></div>`;

const rulesBody = (S) => `<div class="rules">
  <div class="rule">${icon('ban', 'r')}<div><b>Без накрутки</b><span>фейковые просмотры, лайки, комменты и скрытая статистика — сразу отказ</span></div></div>
  <div class="rule">${icon('check', 'r')}<div><b>Ролик оплачивается один раз</b><span>выплатили за 10к, на следующий день 20к — доплаты не будет</span></div></div>
  <div class="rule">${icon('clock', 'r')}<div><b>Заявка — до 2 дней после выхода</b><span>позже выплаты нет. Платим на карты РФ и криптой</span></div></div>
  <div class="rule">${icon('badge', 'r')}<div><b>Только со статусом Медиа</b><span>ролики, выложенные без статуса, не оплачиваем</span></div></div></div>
  <div class="two"><button class="btn ghost" data-ext="${esc(S.links.support)}">${icon('badge')}<span>Стать медиа</span></button><button class="btn ghost" data-ext="${esc(S.links.channel)}"><img src="/img/telegram.png" class="tg" alt=""><span>Мы в Telegram</span></button></div>`;

export default async function media({ S, query }) {
  let page = Math.min(2, Math.max(0, Number(query.slide || 1) - 1));
  let st = null;
  const view = () => {
    const m = S.media;
    return `<main class="app media">${bar({ title: 'Медиа и заработок', meta: 'для авторов' })}
      <div class="field bal"><div><i>Баланс</i><b class="${m.balanceK ? '' : 'zero'}">${rubK(m.balanceK)}</b><u>${m.earnedK ? `всего заработано ${rubK(m.earnedK)}` : `${S.catalog.authorPct}% с покупок по твоему коду`}</u></div>
        <button class="btn" data-go="/withdraw" ${m.balanceK ? "" : "disabled"}>${icon("arrowUpRight")}<span>Вывести</span></button></div>
      <div class="ctrack" id="track">
        ${slide('ticket', 'Промокод', `${S.catalog.authorPct}% с каждой покупки по коду`, 1, promoBody(S, st))}
        ${slide('eye', 'Оплата за просмотры', 'ролики про Майнкрафт', 2, payBody(S))}
        ${slide('shield', 'Правила', 'нарушение — выплаты не будет', 3, rulesBody(S))}
      </div>
      <div class="pager"><button class="pg" id="prev" aria-label="Назад">${icon('chevronLeft')}</button>
        <div class="pg-mid"><span class="dots"><i></i><i></i><i></i></span><span class="pg-h" id="hint"></span></div>
        <button class="pg" id="next" aria-label="Дальше">${icon('chevronRight')}</button></div>
    </main>`;
  };
  return {
    html: view(),
    mount(el) {
      const root = el.parentElement;
      const bind = () => {
        const tr = root.querySelector('#track');
        const slides = [...tr.children];
        const dots = [...root.querySelectorAll('.dots i')];
        const hint = root.querySelector('#hint');
        const sync = () => {
          const w = slides[0].offsetWidth + 8;
          page = Math.max(0, Math.min(2, Math.round(tr.scrollLeft / w)));
          dots.forEach((d, i) => d.classList.toggle('on', i === page));
          hint.textContent = page === 0 ? 'листай →' : page === 2 ? '← листай' : '← листай →';
          root.querySelector('#prev').classList.toggle('dim', page === 0);
          root.querySelector('#next').classList.toggle('dim', page === 2);
        };
        const to = (i) => tr.scrollTo({ left: i * (slides[0].offsetWidth + 8), behavior: 'smooth' });
        tr.addEventListener('scroll', () => requestAnimationFrame(sync), { passive: true });
        root.querySelector('#prev').addEventListener('click', () => to(Math.max(0, page - 1)));
        root.querySelector('#next').addEventListener('click', () => to(Math.min(2, page + 1)));
        tr.scrollLeft = page * (slides[0].offsetWidth + 8); sync();

        const make = async (code) => {
          try { S = await post('/media/promo', { code }); setState(S); st = null; page = 0; root.innerHTML = view(); bind(); toast('Промокод создан'); }
          catch (e) {
            st = e instanceof HttpError && e.code === 'promo_taken' ? { code, suggest: e.body.suggest || [] } : { code, invalid: true };
            if (e instanceof HttpError && e.code === 'promo_exists') return toast('У тебя уже есть промокод');
            root.innerHTML = view(); bind();
          }
        };
        root.querySelector('#pmake')?.addEventListener('click', () => make(root.querySelector('#pcode').value.trim()));
        root.querySelector('#pcode')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') make(e.target.value.trim()); });
        root.querySelectorAll('[data-sug]').forEach((b) => b.addEventListener('click', () => make(b.dataset.sug)));
        root.querySelector('#pcopy')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(S.media.promo.code); toast('Скопировано'); } catch { toast(S.media.promo.code); } });
      };
      bind();
    },
  };
}
