import { icon, logo } from '../ui.js';

const mini = (title, meta) => `<header class="bar">${logo()}<span class="bar-title">Hider</span><span class="bar-meta">${meta}</span></header>`;

export const loading = () => `<main class="app sys">${mini('Hider', 'загрузка…')}<div class="center-spin"><span class="spin"></span></div></main>`;

export const unavailable = () => `<main class="app sys">${mini('Hider', 'нет связи')}
  <section class="field gate"><div class="res center"><span class="res-ico bad">${icon('ban')}</span><h1 class="res-t">Бот недоступен</h1>
    <p class="res-d">Нет связи с сервером Hider. Проверь интернет — если с сетью всё в порядке, бот может быть перезапущен — подожди минуту</p></div></section>
  <div class="foot"><button class="btn" data-retry>${icon('reset')}<span>Повторить</span></button>
    <p class="foot-note">Подписка и данные аккаунта в безопасности</p></div></main>`;

export const maintenance = (m = {}) => `<main class="app sys">${mini('Hider', 'техработы')}
  <section class="field gate"><div class="res center"><span class="res-ico warn">${icon('clock')}</span><h1 class="res-t">Технические работы</h1>
    <p class="res-d">Обновляем Hider. Запуск, оплата и вывод временно недоступны</p></div></section>
  ${m.until ? `<div class="field rows in"><div class="row"><span class="k">Осталось примерно</span><span class="v big">≈ ${Math.max(1, Math.round((m.until - Date.now()) / 60000))} мин</span></div></div>` : ''}
  <div class="foot"><button class="btn" data-retry>${icon('reset')}<span>Проверить снова</span></button></div></main>`;
