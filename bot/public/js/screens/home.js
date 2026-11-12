import { esc, bar, icon, profileCard, tagOf, days, dmy, greeting, secHead } from '../ui.js';

const row = (ic, title, sub, right = '', go = '') =>
  `<button class="m-row" ${go ? `data-go="${go}"` : ''}>${icon(ic)}<span class="m-text"><span class="m-t">${title}</span><span class="m-s">${sub}</span></span>${right}${icon('chevronRight', 'chev')}</button>`;

export default async function home({ S }) {
  const t = tagOf(S, S.user.tag);
  const own = S.user.ownedTags.length;
  const sub = S.sub.active ? `подписка активна · до ${dmy(S.sub.until)}` : 'подписка не активна';
  const promoLine = `промокод ${S.catalog.authorPct}% и оплата за видео`;
  return {
    html: `<main class="app">
      ${bar({ title: 'Hider', back: false, meta: 'главное меню' })}
      ${profileCard(S, { top: greeting(), sub: esc(sub), big: true })}
      <nav class="field nav">
        ${row('user', 'Профиль', 'запуск, статистика, HWID', '', '/profile')}
        ${row('clock', 'Подписка', 'срок и сброс HWID', S.sub.active ? `<span class="m-r">${days(S.sub.daysLeft).replace('день', 'дней').replace('дня', 'дней')}</span>` : `<span class="m-r bad">не активна</span>`, '/buy')}
        ${row('tag', 'Теги', `открыто ${own} из ${S.catalog.tags.length}`, `<span class="m-r" style="color:${t.color}">${esc(t.title)}</span>`, '/tags')}
        ${row('film', 'Медиа и заработок', promoLine, '', '/media')}
      </nav>
      <section class="sec">${secHead('Документы', 'откроются в браузере')}
        <div class="field nav docs">
          <button class="m-row" data-ext="${esc(S.links.offer)}">${icon('file')}<span class="m-text"><span class="m-t">Публичная оферта</span></span>${icon('external', 'chev')}</button>
          <button class="m-row" data-ext="${esc(S.links.privacy)}">${icon('shield')}<span class="m-text"><span class="m-t">Политика конфиденциальности</span></span>${icon('external', 'chev')}</button>
        </div>
      </section>
    </main>`,
  };
}
