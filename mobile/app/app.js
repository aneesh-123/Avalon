// The iPhone app's own layer on top of the website's games. Only the app loads
// this file (mobile/scripts/build-web.js adds it); the website never sees it.
//
//  • an app-style home screen: one big card per game, plus "Coming soon"
//    cards for games still being built, which turn live on their own once
//    their button lands in the game picker
//  • native touches: share sheet for invites, a tap you can feel, the screen
//    stays awake during a game, status bar and splash screen
//  • a clear message while the game server wakes up or the internet drops
(() => {
  const Plugins = window.Capacitor?.Plugins || {};

  // ── Home screen ──────────────────────────────────────────────────────────
  // `button` is the game's own button in the website's picker. A game whose
  // button is missing or hidden shows as Coming soon.
  const GAMES = [
    { button: 'pick-avalon',   icon: '⚔️', name: 'Avalon',        line: 'Find the traitors before they sink the quests.', players: '5–10 players', tone: 'gold' },
    { button: 'pick-imposter', icon: '🕵️', name: 'Imposter',      line: 'Everyone knows the secret word. Except one.',    players: '4–15 players', tone: 'violet' },
    { button: 'pick-trivia',   icon: '🏆', name: 'Trivia Night',  line: 'Teams, buzzers and bragging rights.',            players: '2+ teams',     tone: 'blue' },
    { button: ['pick-quiz', 'pick-h2h', 'pick-headtohead', 'pick-duel'],
                               icon: '⚡', name: 'Head to Head',  line: 'Pick a category. Two phones. Fastest wins.',      players: '2 players',    tone: 'green' },
    { button: 'pick-council',  icon: '👑', name: 'The Council',   line: 'Save the kingdom. Unmask the traitors.',          players: '5–10 players', tone: 'red' },
  ];

  const picker = document.getElementById('screen-picker');
  const home = document.createElement('div');
  home.className = 'gn-home';
  home.innerHTML = `
    <header class="gn-head">
      <h1 class="gn-title">Game Night</h1>
      <p class="gn-sub">Pick a game. Everyone plays on their own phone.</p>
    </header>
    <div class="gn-cards" id="gn-cards"></div>
    <button class="gn-feedback" data-feedback>Send feedback</button>`;
  picker.appendChild(home);

  const findButton = ids => [].concat(ids).map(id => document.getElementById(id)).find(Boolean);
  const known = new Set(GAMES.flatMap(g => [].concat(g.button)));

  function renderCards() {
    const live = [], soon = [];
    for (const g of GAMES) {
      const btn = findButton(g.button);
      (btn && !btn.hidden ? live : soon).push({ ...g, btn });
    }
    // A game added to the picker that this list doesn't know yet still shows.
    picker.querySelectorAll('.picker-box').forEach(btn => {
      if (known.has(btn.id) || btn.hidden) return;
      live.push({
        btn, tone: 'gold',
        icon: btn.querySelector('.picker-icon')?.textContent || '🎲',
        name: btn.querySelector('.picker-name')?.textContent || 'New game',
        line: btn.querySelector('.picker-desc')?.textContent || '', players: '',
      });
    });
    const card = (g, isSoon) => `
      <button class="gn-card gn-${g.tone}${isSoon ? ' gn-soon' : ''}" ${isSoon ? 'disabled' : `data-pick="${g.btn.id}"`}>
        <span class="gn-icon" aria-hidden="true">${g.icon}</span>
        <span class="gn-text">
          <span class="gn-name">${g.name}</span>
          <span class="gn-line">${g.line}</span>
          ${isSoon ? '<span class="gn-badge">Coming soon</span>'
                   : g.players ? `<span class="gn-players">${g.players}</span>` : ''}
        </span>
        ${isSoon ? '' : '<span class="gn-go" aria-hidden="true">›</span>'}
      </button>`;
    document.getElementById('gn-cards').innerHTML =
      live.map(g => card(g, false)).join('') + soon.map(g => card(g, true)).join('');
  }
  renderCards();
  // Games unhide their picker button at runtime (e.g. The Council), so watch.
  new MutationObserver(renderCards).observe(picker.querySelector('.picker-boxes') || picker,
    { subtree: true, attributes: true, attributeFilter: ['hidden'], childList: true });

  home.addEventListener('click', e => {
    const id = e.target.closest('[data-pick]')?.dataset.pick;
    if (id) document.getElementById(id)?.click();
  });

  // ── Native touches ───────────────────────────────────────────────────────
  // Invites: open the iPhone share sheet (Messages, WhatsApp, AirDrop…)
  // instead of silently copying a link. Every game calls copyText() for this.
  if (Plugins.Share && typeof window.copyText === 'function') {
    const copyOnly = window.copyText;
    window.copyText = async text => {
      try {
        await Plugins.Share.share({ title: 'Join my game', text: 'Join my game on Game Night', url: text });
        return true;
      } catch {
        return copyOnly(text);   // share sheet closed or unavailable
      }
    };
  }

  // A light tap on every button press.
  document.addEventListener('click', e => {
    if (e.target.closest('button:not([disabled]), .btn')) {
      Plugins.Haptics?.impact?.({ style: 'LIGHT' }).catch?.(() => {});
    }
  }, true);

  // Phones lie on the table between turns; don't let them lock mid-game.
  Plugins.KeepAwake?.keepAwake?.().catch?.(() => {});
  Plugins.StatusBar?.setStyle?.({ style: 'DARK' }).catch?.(() => {});
  Plugins.SplashScreen?.hide?.().catch?.(() => {});

  // ── Server status ────────────────────────────────────────────────────────
  // The server may be asleep (free hosting naps when idle) or the phone may
  // be offline. Say so plainly instead of buttons that do nothing.
  const banner = document.createElement('div');
  banner.className = 'gn-net';
  banner.hidden = true;
  document.body.appendChild(banner);
  let slowTimer = null;
  const showBanner = text => { banner.textContent = text; banner.hidden = false; };
  function watch(sock) {
    const waiting = () => {
      clearTimeout(slowTimer);
      slowTimer = setTimeout(() => {
        if (!sock.connected) showBanner(navigator.onLine === false
          ? 'No internet. Games need a connection.'
          : 'Connecting to the game server…');
      }, 1500);
    };
    sock.on('connect', () => { clearTimeout(slowTimer); banner.hidden = true; });
    sock.on('disconnect', waiting);
    sock.io.on('reconnect_attempt', waiting);
    if (!sock.connected) waiting();
  }
  if (typeof socket !== 'undefined') watch(socket);  // client.js's shared socket

  // Coming back to the app after it was in the background.
  Plugins.App?.addListener?.('appStateChange', ({ isActive }) => {
    if (isActive) Plugins.KeepAwake?.keepAwake?.().catch?.(() => {});
  });
})();
