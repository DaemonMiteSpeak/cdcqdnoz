(() => {
  'use strict';
  // Page transitions: blur the whole window, show a spinner + status text, then blur away and
  // replay the entrance animation of the next page.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const VEIL = '<div class="fx-veil" aria-hidden="true"><div class="fx-block">' +
    '<svg class="fx-spin" viewBox="0 0 42 42"><circle class="tr" cx="21" cy="21" r="17"/><circle class="ar" cx="21" cy="21" r="17"/></svg>' +
    '<div class="fx-text"></div></div></div>';

  const wins = [document.getElementById('window'), document.getElementById('appWindow')].filter(Boolean);
  wins.forEach((w) => w.insertAdjacentHTML('beforeend', VEIL));
  const textOf = (w) => w.querySelector(':scope > .fx-veil .fx-text');

  let enterTimer = null;
  function replay(win) {
    if (win.id !== 'appWindow') return;
    win.classList.remove('is-in');
    void win.offsetWidth;
    win.classList.add('is-in');
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => win.classList.remove('is-in'), 1500);
  }

  window.hiderFx = {
    sleep,
    // blur the window; returns a token for min()
    on(win, text) {
      if (window.hiderPanels) window.hiderPanels.close(); else win.classList.remove('is-settings', 'is-cos');
      const t = textOf(win);
      if (t) t.textContent = text || '';
      win.classList.toggle('fx-quiet', !text);
      win.classList.add('fx-blur');
      return Date.now();
    },
    // keep the veil at least `ms` on screen so the animation never flashes
    async min(token, ms) { const rest = ms - (Date.now() - token); if (rest > 0) await sleep(rest); },
    // un-blur; `reveal` replays the page entrance (rise stagger)
    off(win, reveal) {
      win.classList.remove('fx-blur');
      if (reveal) replay(win);
    },
    // drop the veil instantly (window is not visible)
    clear(win) { win.classList.remove('fx-blur', 'fx-quiet'); },
    replay
  };
})();
