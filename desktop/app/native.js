(() => {
  'use strict';

  const api = window.hider;
  if (!api) return;

  const login = document.getElementById('window');
  const appWin = document.getElementById('appWindow');
  let closing = false;

  /* real window controls: they replace the in-page demo behaviour */
  function intercept(id, action) {
    document.addEventListener('click', (event) => {
      if (!event.target.closest || !event.target.closest('#' + id)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      action();
    }, true);
  }

  intercept('minBtn', () => api.minimize());
  intercept('appMinBtn', () => api.minimize());

  function quit() {
    if (closing) return;
    closing = true;
    const active = appWin.hidden ? login : appWin;
    active.classList.add('is-closed');
    setTimeout(() => api.close(), 240);
  }

  intercept('closeBtn', quit);
  intercept('appCloseBtn', quit);

  /* the native window follows whichever screen is showing */
  let current = '';
  function syncScreen() {
    const next = appWin.hidden ? 'login' : 'app';
    if (next === current) return;
    current = next;
    api.screen(next);
  }

  new MutationObserver(syncScreen).observe(appWin, { attributes: true, attributeFilter: ['hidden'] });
  syncScreen();

  /* no browser shortcuts in a release build */
  document.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (event.key === 'F5' || event.key === 'F12' || ((event.ctrlKey || event.metaKey) && ['r', 'p', 's', 'u'].includes(key))) {
      event.preventDefault();
    }
  });

  document.addEventListener('contextmenu', (event) => {
    if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
  });
})();
