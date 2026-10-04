// seats.js — more than one player on one phone. Loaded before every game.
//
// Two situations need this, in every game:
//   · someone at the table has no phone at all;
//   · someone's phone dies mid-game and they have nothing to rejoin from.
// Either way, a friend's phone takes on that player's seat as well as its own.
//
// Each extra seat is a full copy of the app in an <iframe> on the same page.
// That way every game works unchanged: each seat has its own socket, its own
// token and its own screens, and the server sees an ordinary player. All the
// seats stay connected at once (a hidden frame keeps running, a background
// browser tab would not), and the phone flips between them behind a "pass the
// phone to …" curtain so nobody sees a role or a vote that isn't theirs.
//
// The one thing seats must not share is storage — the session and the token
// that identify a player. So every game reads and writes `appStorage` instead
// of localStorage directly: the phone owner's page gets plain localStorage,
// seat N gets the same store with keys prefixed `seatN:`.
(function () {
  'use strict';

  const params  = new URLSearchParams(location.search);
  const inFrame = (() => { try { return window.parent !== window; } catch { return true; } })();
  const seatNo  = inFrame ? (parseInt(params.get('seat'), 10) || 0) : 0;
  let waitEl = null;   // this page's own "asking the table" card

  // ── Storage ────────────────────────────────────────────────────────────
  function memoryStore() {
    const m = new Map();
    return {
      getItem: k => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => { m.set(k, String(v)); },
      removeItem: k => { m.delete(k); },
    };
  }
  let base;
  try { base = window.localStorage; base.getItem('x'); } catch { base = memoryStore(); }

  function prefixed(prefix) {
    return {
      getItem: k => base.getItem(prefix + k),
      setItem: (k, v) => base.setItem(prefix + k, v),
      removeItem: k => base.removeItem(prefix + k),
    };
  }
  window.appStorage = seatNo ? prefixed(`seat${seatNo}:`) : base;

  // One id for every page on this phone, seats included. The server uses it
  // to tell "another player on the same phone" from "another phone", and to
  // give a phone holding several seats one vote, not several.
  window.deviceId = (() => {
    try {
      let d = base.getItem('device-id');
      if (!d) { d = 'dv-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); base.setItem('device-id', d); }
      return d;
    } catch { return null; }
  })();

  // Where each game keeps "which room am I in, under what name".
  const SESSION_KEYS = {
    avalon: 'avalon-session', imposter: 'imposter-session',
    trivia: 'trivia-session', secret: 'secret-session',
  };

  function sessionIn(store) {
    for (const [game, key] of Object.entries(SESSION_KEYS)) {
      try {
        const s = JSON.parse(store.getItem(key));
        if (s?.code) return { game, code: s.code, name: s.name || '' };
      } catch {}
    }
    return null;
  }

  // A seat's page address: the game's own invite link, so the seat lands on
  // that game's join screen with the code (and, to take over a seat, the
  // name) filled in. Each game already knows how to read these.
  function seatUrl(n, { game, code, name }) {
    const q = new URLSearchParams({ seat: String(n) });
    if (code) {
      if (game === 'imposter') q.set('imp', code);
      else { q.set('room', code); if (game !== 'avalon') q.set('game', game); }
      if (name) q.set('name', name);
    }
    return '/?' + q.toString();
  }

  // ── Inside a seat's frame ──────────────────────────────────────────────
  if (seatNo) {
    document.documentElement.classList.add('in-seat');
    // Every game reads its invite params while its script runs. Once they
    // have, drop them, so "Leave game" (which reloads the page) does not
    // follow the invite straight back into the room.
    document.addEventListener('DOMContentLoaded', () => {
      history.replaceState(null, '', '/?seat=' + seatNo);
    });
    // A hidden seat's alert() would pop up over someone else's screen with no
    // hint of whose it is. Hand it to the phone's page to show as a note.
    window.alert = msg => {
      try { window.parent.Seats.note(seatNo, String(msg)); } catch {}
    };
    window.Seats = {
      seatNo,
      add(opts) { try { window.parent.Seats.add(opts); } catch {} },
    };
    wireButtons();
    // Votes this seat is asked for show on the phone's own page, which is
    // where whoever holds the phone is looking.
    wireConsent(
      (ask, answer) => { try { window.parent.Seats.ask(ask, answer); } catch {} },
      id => { try { window.parent.Seats.closeAsk(id); } catch {} },
      () => { try { window.parent.Seats.remove(seatNo); } catch {} },
    );
    return;
  }

  // ── The phone's own page: holds the extra seats ───────────────────────
  const SEATS_KEY = 'shared-seats';
  let seats = [];            // [{ n }]
  let active = 0;            // 0 = the phone owner's own page
  const frames = new Map();  // n -> iframe

  function loadSeats() {
    try { seats = (JSON.parse(base.getItem(SEATS_KEY)) || []).filter(s => Number.isInteger(s?.n) && s.n > 0); }
    catch { seats = []; }
  }
  function saveSeats() {
    try { seats.length ? base.setItem(SEATS_KEY, JSON.stringify(seats)) : base.removeItem(SEATS_KEY); } catch {}
  }

  function seatName(n) {
    const s = sessionIn(n ? prefixed(`seat${n}:`) : base);
    if (s?.name) return s.name;
    const pending = seats.find(x => x.n === n)?.name;
    return pending || (n ? 'New player' : 'Me');
  }

  function makeFrame(n, src) {
    const f = document.createElement('iframe');
    f.className = 'seat-frame';
    f.title = 'Another player on this phone';
    f.src = src;
    document.body.appendChild(f);
    frames.set(n, f);
    return f;
  }

  function add(opts = {}) {
    const game = SESSION_KEYS[opts.game] ? opts.game : null;
    const code = /^[A-Z0-9]{5}$/.test(String(opts.code || '').toUpperCase())
      ? String(opts.code).toUpperCase()
      : (sessionIn(base)?.game === game ? sessionIn(base).code : '');
    const name = typeof opts.name === 'string' ? opts.name.slice(0, 20) : '';

    // Taking over a seat this phone already holds: just go to it.
    if (name) {
      const held = seats.find(s => seatName(s.n).toLowerCase() === name.toLowerCase());
      if (held) { switchTo(held.n); return; }
    }

    const n = seats.reduce((m, s) => Math.max(m, s.n), 1) + 1;
    // A fresh seat starts with nothing in storage.
    clearSeatStorage(n);
    seats.push({ n, name });
    saveSeats();
    makeFrame(n, seatUrl(n, { game, code, name }));
    render();
    // A seat being taken over shows that player's role the moment it joins,
    // so it opens behind the curtain. A brand-new player has nothing secret
    // yet — and the person holding the phone is helping them sign in.
    if (name) switchTo(n); else show(n);
  }

  function clearSeatStorage(n) {
    const prefix = `seat${n}:`;
    try {
      const doomed = [];
      for (let i = 0; i < base.length; i++) { const k = base.key(i); if (k?.startsWith(prefix)) doomed.push(k); }
      doomed.forEach(k => base.removeItem(k));
    } catch {}
  }

  function remove(n) {
    frames.get(n)?.remove();
    frames.delete(n);
    clearSeatStorage(n);
    seats = seats.filter(s => s.n !== n);
    saveSeats();
    show(0);
  }

  function show(n) {
    active = n;
    frames.forEach((f, k) => f.classList.toggle('active', k === n));
    hideCurtain();
    render();
  }

  // ── Pass-the-phone curtain ──
  let curtain = null;
  function switchTo(n) {
    if (n === active) return;
    hideCurtain();
    curtain = document.createElement('div');
    curtain.className = 'seat-curtain';
    const who = seatName(n);
    curtain.innerHTML = `
      <div class="seat-curtain-card">
        <div class="seat-curtain-icon">📱</div>
        <p class="seat-curtain-lead">Pass the phone to</p>
        <p class="seat-curtain-name"></p>
        <button class="primary-btn" data-go>I'm <span></span> — show my screen</button>
        <button class="pause-leave-link" data-back>Not now</button>
        ${n ? '<button class="pause-leave-link seat-remove" data-remove>Take this player off this phone</button>' : ''}
      </div>`;
    curtain.querySelector('.seat-curtain-name').textContent = who;
    curtain.querySelector('[data-go] span').textContent = who;
    curtain.querySelector('[data-go]').addEventListener('click', () => show(n));
    curtain.querySelector('[data-back]').addEventListener('click', hideCurtain);
    const rm = curtain.querySelector('[data-remove]');
    if (rm) {
      let armed = false;
      rm.addEventListener('click', () => {
        if (!armed) { armed = true; rm.textContent = 'Tap again — they can rejoin by name later'; return; }
        remove(n);
      });
    }
    document.body.appendChild(curtain);
    // Hide whatever is on screen now, too: the curtain is opaque, but this
    // also stops taps reaching it.
    frames.forEach(f => f.classList.remove('active'));
  }
  function hideCurtain() {
    if (!curtain) return;
    curtain.remove();
    curtain = null;
    frames.forEach((f, k) => f.classList.toggle('active', k === active));
  }

  // ── The bar along the bottom ──
  let bar = null;
  function render() {
    document.body.classList.toggle('has-seat-bar', seats.length > 0);
    if (!seats.length) { bar?.remove(); bar = null; return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'seat-bar';
      bar.addEventListener('click', e => {
        const chip = e.target.closest('[data-seat]');
        if (chip) switchTo(parseInt(chip.dataset.seat, 10));
      });
      document.body.appendChild(bar);
    }
    const chips = [0, ...seats.map(s => s.n)].map(n =>
      `<button class="seat-chip${n === active ? ' active' : ''}" data-seat="${n}"></button>`).join('');
    bar.innerHTML = `<span class="seat-bar-label">On this phone</span><div class="seat-chips">${chips}</div>`;
    bar.querySelectorAll('[data-seat]').forEach(b => { b.textContent = seatName(parseInt(b.dataset.seat, 10)); });
  }

  // Names arrive once a seat joins its room; a seat writing its session fires
  // a storage event here.
  window.addEventListener('storage', () => render());

  // ── Notes from hidden seats ──
  function note(n, msg) {
    const t = document.createElement('div');
    t.className = 'seat-note';
    t.textContent = `${seatName(n)}: ${msg}`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 5000);
  }

  // ── The table's vote (server/seatConsent.js) ──
  const asks = new Map();   // request id -> { el, answers: [fn] }
  function ask(req, answer) {
    const known = asks.get(req.id);
    if (known) { known.answers.push(answer); return; }
    const el = document.createElement('div');
    el.className = 'seat-consent';
    const who = req.name;
    const lead = req.kind === 'add'
      ? `${req.via ? `${req.via}’s phone` : 'A phone already in this game'} wants to add another player: ${who}.`
      : req.via
        ? `${who}’s seat would move onto ${req.via}’s phone.`
        : `Someone on a different phone wants to take over ${who}’s seat.`;
    const check = req.kind === 'add'
      ? `Only allow it if ${who} is really here and has no phone.`
      : `Only allow it if ${who} is the one holding that phone.`;
    el.innerHTML = `
      <div class="seat-consent-card">
        <p class="seat-consent-title">Everyone has to agree</p>
        <p class="seat-consent-lead"></p>
        <p class="seat-consent-check"></p>
        <div class="seat-consent-btns">
          <button class="secondary-btn" data-no>Don't allow</button>
          <button class="primary-btn" data-yes>Allow</button>
        </div>
      </div>`;
    el.querySelector('.seat-consent-lead').textContent = lead;
    el.querySelector('.seat-consent-check').textContent = check;
    const entry = { el, answers: [answer] };
    const reply = yes => { entry.answers.forEach(fn => fn(yes)); closeAsk(req.id); };
    el.querySelector('[data-yes]').addEventListener('click', () => reply(true));
    el.querySelector('[data-no]').addEventListener('click', () => reply(false));
    asks.set(req.id, entry);
    document.body.appendChild(el);
  }
  function closeAsk(id) {
    asks.get(id)?.el.remove();
    asks.delete(id);
  }

  window.Seats = { seatNo: 0, add, note, remove, show, ask, closeAsk };
  wireConsent(ask, closeAsk, null);

  document.addEventListener('DOMContentLoaded', () => {
    loadSeats();
    // Back after a reload: every seat rejoins from its own saved session.
    seats.forEach(s => makeFrame(s.n, seatUrl(s.n, {})));
    render();
  });
  wireButtons();

  // ── Buttons the games render ──
  //   data-seat-add="avalon"                      someone without a phone
  //   data-seat-takeover="avalon" data-name="Sam" Sam's phone died
  function wireButtons() {
    document.addEventListener('click', e => {
      const addBtn = e.target.closest('[data-seat-add]');
      if (addBtn) { window.Seats.add({ game: addBtn.dataset.seatAdd, code: codeFor(addBtn.dataset.seatAdd) }); return; }
      const take = e.target.closest('[data-seat-takeover]');
      if (take) {
        window.Seats.add({ game: take.dataset.seatTakeover, code: codeFor(take.dataset.seatTakeover), name: take.dataset.name });
      }
    });
  }

  // Listens on this page's own socket (client.js creates it after this file
  // runs). Asks go to `showAsk`; this page's own request — joining as a
  // second player, or taking a seat over — shows a waiting card here.
  function wireConsent(showAsk, hideAsk, dropSeat) {
    document.addEventListener('DOMContentLoaded', () => {
      if (typeof socket === 'undefined') return;
      socket.on('seat:consent-ask', req => {
        if (!req?.id) return;
        showAsk(req, yes => socket.emit('seat:consent-answer', { id: req.id, yes }));
      });
      socket.on('seat:consent-closed', ({ id } = {}) => { hideAsk(id); hideWait(); });
      socket.on('seat:consent-wait', w => showWait(w));
      socket.on('seat:consent-denied', d => showDenied(d, dropSeat));
    });
  }

  function waitCard() {
    if (!waitEl) {
      waitEl = document.createElement('div');
      waitEl.className = 'seat-consent';
      document.body.appendChild(waitEl);
    }
    return waitEl;
  }
  function hideWait() { waitEl?.remove(); waitEl = null; }
  function showWait({ name, kind, waitingOn = [] }) {
    const el = waitCard();
    el.innerHTML = `
      <div class="seat-consent-card">
        <p class="seat-consent-title">Asking the table</p>
        <p class="seat-consent-lead"></p>
        <p class="seat-consent-check"></p>
        <button class="pause-leave-link" data-cancel>Cancel</button>
      </div>`;
    el.querySelector('.seat-consent-lead').textContent = kind === 'add'
      ? `Everyone else has to agree before ${name} joins on this phone.`
      : `Everyone else has to agree before ${name}’s seat moves to this phone.`;
    el.querySelector('.seat-consent-check').textContent = waitingOn.length ? `Waiting on ${waitingOn.join(', ')}` : '';
    el.querySelector('[data-cancel]').addEventListener('click', () => { socket.emit('seat:consent-cancel'); hideWait(); });
  }
  function showDenied({ name, by, reason } = {}, dropSeat) {
    const el = waitCard();
    el.innerHTML = `
      <div class="seat-consent-card">
        <p class="seat-consent-title">Not allowed</p>
        <p class="seat-consent-lead"></p>
        <button class="primary-btn" data-ok>OK</button>
      </div>`;
    el.querySelector('.seat-consent-lead').textContent =
      reason === 'cancelled' ? `Cancelled.`
      : reason === 'timeout' ? `Not everyone answered in time, so ${name} wasn’t let in.`
      : `${by || 'Someone'} said no, so ${name} wasn’t let in.`;
    el.querySelector('[data-ok]').addEventListener('click', () => { hideWait(); dropSeat?.(); });
  }

  // The room this page (owner or seat) is in for that game.
  function codeFor(game) {
    try { return JSON.parse(window.appStorage.getItem(SESSION_KEYS[game]))?.code || ''; } catch { return ''; }
  }
})();
