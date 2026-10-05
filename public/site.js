// Shared by every page of the site (the app and the per-game landing pages):
//  • one anonymous visit beacon per page load, for the owner's /admin page
//  • /?play=avalon|imposter|trivia opens that game's home screen
//  • the feedback sheet — any element with [data-feedback] opens it
(() => {
  const GAMES = ['avalon', 'imposter', 'trivia'];

  // A random id kept on this device, so the admin page can count people
  // rather than page loads. Nothing about the person is stored.
  const visitor = (() => {
    const make = () => (crypto.randomUUID ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36));
    try {
      let v = localStorage.getItem('gn-visitor');
      if (!v) { v = make(); localStorage.setItem('gn-visitor', v); }
      return v;
    } catch { return make(); }
  })();

  const post = (url, body) => fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), keepalive: true,
  });

  post('/api/visit', { visitor, page: location.pathname, ref: document.referrer }).catch(() => {});

  // ── /?play=game ──
  const params = new URLSearchParams(location.search);
  const play = (params.get('play') || '').toLowerCase();
  if (GAMES.includes(play) && !params.get('room') && !params.get('imp')) {
    document.getElementById(`pick-${play}`)?.click();
    // /?play=avalon&tutorial=1 goes one step further, into the tutorial.
    if (play === 'avalon' && params.get('tutorial')) document.getElementById('btn-tutorial')?.click();
  }

  // ── Feedback sheet ──
  // Which game the player is in, from the screen on show.
  function currentGame() {
    const id = document.querySelector('.screen.active')?.id || '';
    if (id.startsWith('screen-imp-')) return 'imposter';
    if (id.startsWith('screen-triv-')) return 'trivia';
    if (id === 'screen-picker' || !id) return document.body.dataset.game || null;
    return 'avalon';
  }

  let sheet;
  function build() {
    sheet = document.createElement('div');
    sheet.className = 'fb-overlay';
    sheet.hidden = true;
    sheet.innerHTML = `
      <form class="fb-sheet" novalidate>
        <button type="button" class="fb-close" aria-label="Close">✕</button>
        <div class="fb-title">Feedback</div>
        <div class="fb-body">
          <div class="fb-rate" role="group" aria-label="How was it?">
            <button type="button" class="fb-thumb" data-rating="up" aria-label="Good">👍</button>
            <button type="button" class="fb-thumb" data-rating="down" aria-label="Bad">👎</button>
          </div>
          <textarea class="fb-text" maxlength="2000" rows="4" placeholder="What should we fix or add?"></textarea>
          <input class="fb-contact" type="text" maxlength="120" placeholder="Email (only if you want a reply)" autocomplete="email">
          <div class="fb-error" aria-live="polite"></div>
          <button type="submit" class="fb-send">Send</button>
        </div>
        <div class="fb-done" hidden>Thanks! 🙏</div>
      </form>`;
    document.body.appendChild(sheet);
    const form = sheet.querySelector('form');
    sheet.addEventListener('click', e => { if (e.target === sheet) close(); });
    sheet.querySelector('.fb-close').addEventListener('click', close);
    sheet.querySelectorAll('.fb-thumb').forEach(b => b.addEventListener('click', () => {
      const on = !b.classList.contains('on');
      sheet.querySelectorAll('.fb-thumb').forEach(x => x.classList.remove('on'));
      b.classList.toggle('on', on);
    }));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const err = sheet.querySelector('.fb-error');
      const message = sheet.querySelector('.fb-text').value.trim();
      const rating = sheet.querySelector('.fb-thumb.on')?.dataset.rating || null;
      if (message.length < 2) { err.textContent = 'Write a few words first.'; return; }
      const send = sheet.querySelector('.fb-send');
      send.disabled = true; err.textContent = '';
      try {
        const res = await post('/api/feedback', {
          message, rating, visitor, game: sheet.dataset.game || null,
          contact: sheet.querySelector('.fb-contact').value.trim(),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || 'Could not send. Try again.');
        sheet.querySelector('.fb-body').hidden = true;
        sheet.querySelector('.fb-done').hidden = false;
        setTimeout(close, 1400);
      } catch (ex) {
        err.textContent = ex.message || 'Could not send. Try again.';
      } finally {
        send.disabled = false;
      }
    });
  }

  function open(game) {
    if (!sheet) build();
    sheet.dataset.game = game || '';
    sheet.querySelector('.fb-body').hidden = false;
    sheet.querySelector('.fb-done').hidden = true;
    sheet.querySelector('.fb-error').textContent = '';
    sheet.querySelector('.fb-text').value = '';
    sheet.querySelectorAll('.fb-thumb').forEach(x => x.classList.remove('on'));
    sheet.hidden = false;
    setTimeout(() => sheet.querySelector('.fb-text').focus(), 50);
  }
  function close() { if (sheet) sheet.hidden = true; }

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-feedback]');
    if (t) { e.preventDefault(); open(t.dataset.feedback || currentGame()); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  window.openFeedback = open;
})();
