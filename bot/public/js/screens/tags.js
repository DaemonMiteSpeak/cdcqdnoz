import { esc, icon, bar, profileCard, tagOf, rub, toast } from '../ui.js';
import { post } from '../api.js';
import { go, setState } from '../app.js';

export default async function tags({ S }) {
  const T = S.catalog.tags;
  const owned = new Set(S.user.ownedTags);
  const mine = T.filter((t) => owned.has(t.id));
  const shop = T.filter((t) => !owned.has(t.id));
  let sel = S.user.tag;

  const chip = (t) => {
    const on = owned.has(t.id);
    const picked = sel === t.id;
    return `<button class="chip ${picked ? 'sel' : ''}" data-tag="${t.id}" style="--c:${t.color}"><span>${esc(t.title)}</span>${on ? (picked ? icon('check') : '') : icon('lock', 'lk')}</button>`;
  };
  const view = () => {
    const t = tagOf(S, sel);
    const isOwned = owned.has(sel);
    let btn;
    if (isOwned && S.user.tag === sel) btn = `<button class="btn muted" disabled>${icon('check')}<span>Установлен</span></button>`;
    else if (isOwned) btn = `<button class="btn" id="act">${icon('check')}<span>Установить «${esc(t.title)}»</span></button>`;
    else btn = `<button class="btn" id="act">${icon('bag')}<span>Купить «${esc(t.title)}» за ${rub(S.catalog.tagPrice)}</span></button>`;
    const pv = { ...S, user: { ...S.user, tag: sel } };
    return `<main class="app">
      ${bar({ title: 'Теги', meta: `открыто ${mine.length} из ${T.length}` })}
      ${profileCard(pv, { top: 'предпросмотр', sub: 'так тебя видят в Hider' })}
      <section class="sec">
        <div class="sec-head"><div><span class="s-t">Мои теги</span><span class="s-d">бесплатные и купленные</span></div><span class="s-r">${mine.length}</span></div>
        <div class="chips">${mine.map(chip).join('')}</div></section>
      <section class="sec">
        <div class="sec-head"><div><span class="s-t">Магазин</span><span class="s-d">${S.catalog.tagPrice} ₽ за тег · купленный переходит в «Мои»</span></div><span class="s-r">${shop.length}</span></div>
        <div class="chips">${shop.map(chip).join('')}</div></section>
      ${btn}
    </main>`;
  };
  return {
    html: view(),
    mount(el) {
      const root = el.parentElement;
      const bind = () => {
        root.querySelectorAll('[data-tag]').forEach((b) => b.addEventListener('click', () => { sel = b.dataset.tag; root.innerHTML = view(); bind(); }));
        root.querySelector('#act')?.addEventListener('click', async (e) => {
          if (!owned.has(sel)) return go(`/pay?kind=tag&item=${sel}`);
          e.currentTarget.disabled = true;
          try { const ns = await post('/tags/select', { tag: sel }); setState(ns); S.user.tag = sel; root.innerHTML = view(); bind(); } catch { toast('Не удалось установить тег'); }
        });
        root.querySelector('.back')?.addEventListener('click', () => {});
      };
      bind();
    },
  };
}
