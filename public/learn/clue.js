// clue.js — "Learn at the table": Clue taught by watching one example turn.
//
// You sit at the bottom of the screen with your hand of cards. The other three
// players sit across the table, the board lies between you, and each step
// animates what would happen at a real table while a big caption says it in a
// few words.
//
// This is a walkthrough, not a playable game: every card, roll and guess is
// scripted below. To keep Back/Next simple, each step's run() is written so it
// can be replayed instantly (FAST) — going to step N resets the table, replays
// steps 0..N-1 with no animation, then animates step N.
//
// All art is drawn here (SVG and CSS). Character names are plain colours; the
// rules are in our own words.
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const board = $('cl-board'), tray = $('cl-tray'), banner = $('cl-banner');
  const notesEl = $('cl-notes'), hand = $('cl-hand');
  const fly = $('cl-fly'), app = $('cl-app');

  // ── Cards ─────────────────────────────────────────────────────────────
  const PIPE_SVG = '<svg viewBox="0 0 24 24" class="cl-svgicon"><rect x="3" y="9.5" width="18" height="5" rx="2" fill="#9aa0a8"/><rect x="1.5" y="8" width="4" height="8" rx="1.2" fill="#6b7078"/><rect x="18.5" y="8" width="4" height="8" rx="1.2" fill="#6b7078"/></svg>';
  const CARDS = {
    red:    { kind: 'who', name: 'Red',    color: '#d6453d' },
    yellow: { kind: 'who', name: 'Yellow', color: '#e8b923' },
    white:  { kind: 'who', name: 'White',  color: '#eeeeee' },
    green:  { kind: 'who', name: 'Green',  color: '#3fa45b' },
    blue:   { kind: 'who', name: 'Blue',   color: '#3b7fd9' },
    purple: { kind: 'who', name: 'Purple', color: '#8e5bc9' },
    rope:   { kind: 'what', name: 'Rope',   icon: '🪢' },
    knife:  { kind: 'what', name: 'Knife',  icon: '🔪' },
    candle: { kind: 'what', name: 'Candlestick', icon: '🕯️' },
    wrench: { kind: 'what', name: 'Wrench', icon: '🔧' },
    pipe:   { kind: 'what', name: 'Pipe',   icon: PIPE_SVG },
    pistol: { kind: 'what', name: 'Pistol', icon: '🔫' },
    kitchen:  { kind: 'where', name: 'Kitchen',      icon: '🍳' },
    ballroom: { kind: 'where', name: 'Ballroom',     icon: '💃' },
    conserv:  { kind: 'where', name: 'Conservatory', icon: '🪴' },
    dining:   { kind: 'where', name: 'Dining',       icon: '🍽️' },
    billiard: { kind: 'where', name: 'Billiards',    icon: '🎱' },
    library:  { kind: 'where', name: 'Library',      icon: '📚' },
    lounge:   { kind: 'where', name: 'Lounge',       icon: '🛋️' },
    hall:     { kind: 'where', name: 'Hall',         icon: '🚪' },
    study:    { kind: 'where', name: 'Study',        icon: '🖋️' },
  };
  const KIND_LABEL = { who: 'WHO', what: 'WHAT', where: 'WHERE' };
  const ids = kind => Object.keys(CARDS).filter(k => CARDS[k].kind === kind);

  // The secret answer, and who holds what. 18 cards dealt: 4 + 5 + 5 + 4.
  const ANSWER = ['purple', 'rope', 'library'];
  const HANDS = {
    me:    ['green', 'knife', 'kitchen', 'study'],
    sam:   ['yellow', 'candle', 'ballroom', 'hall', 'lounge'],
    priya: ['wrench', 'white', 'dining', 'conserv', 'pistol'],
    leo:   ['red', 'blue', 'pipe', 'billiard'],
  };
  const PLAYERS = {
    sam:   { name: 'Sam',   token: 'red' },
    priya: { name: 'Priya', token: 'green' },
    leo:   { name: 'Leo',   token: 'yellow' },
  };
  const INITIAL = { me: 'me', sam: 'S', priya: 'P', leo: 'L' };

  function portrait(color) {
    // An original, faceless bust in the suspect's colour.
    return `<svg viewBox="0 0 40 40" class="cl-portrait"><circle cx="20" cy="20" r="19" fill="${color}"/>
      <circle cx="20" cy="15" r="7" fill="#00000033"/><path d="M7 35 Q20 18 33 35 Z" fill="#00000033"/></svg>`;
  }
  function faceHtml(id) {
    const c = CARDS[id];
    const art = c.kind === 'who' ? portrait(c.color) : `<span class="cl-face-icon">${c.icon}</span>`;
    const long = c.name.length > 8 ? ' long' : '';
    return `<div class="cl-face k-${c.kind}"><span class="cl-face-kind">${KIND_LABEL[c.kind]}</span>
      <span class="cl-face-art">${art}</span><span class="cl-face-name${long}">${c.name}</span></div>`;
  }
  const BACK_HTML = '<div class="cl-back"><span>?</span></div>';
  function cardEl(id, up) {
    const el = document.createElement('div');
    el.className = 'cl-card' + (up ? ' up' : '');
    el.dataset.card = id || '';
    el.innerHTML = `<div class="cl-card-in">${id ? faceHtml(id) : '<div class="cl-face"></div>'}${BACK_HTML}</div>`;
    return el;
  }

  // ── Board (300 × 300 units; overlays are placed in % of that) ─────────
  const ROOMS = [
    ['kitchen', 0, 0, 85, 75], ['ballroom', 105, 0, 90, 65], ['conserv', 215, 0, 85, 75],
    ['dining', 0, 95, 85, 85], ['billiard', 215, 95, 85, 60], ['library', 215, 175, 85, 55],
    ['lounge', 0, 200, 85, 100], ['hall', 105, 210, 90, 90], ['study', 215, 250, 85, 50],
  ];
  // Doors: [x, y, w, h] gaps drawn on a room wall.
  const DOORS = [[60, 73, 14, 4], [140, 63, 18, 4], [226, 73, 14, 4], [83, 130, 4, 16],
    [213, 115, 4, 16], [213, 195, 4, 14], [83, 230, 4, 16], [140, 208, 18, 4], [213, 262, 4, 14]];
  function buildBoard() {
    const rooms = ROOMS.map(([id, x, y, w, h]) => {
      const c = CARDS[id];
      const cx = x + w / 2, cy = y + h / 2;
      const fs = c.name.length > 9 ? 9.5 : 12;
      return `<g class="cl-room" data-room="${id}">
        <rect x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${h - 2}" rx="3"/>
        <text x="${cx}" y="${cy - 2}" class="cl-room-icon">${id === 'billiard' ? '🎱' : (c.icon.startsWith('<') ? '' : c.icon)}</text>
        <text x="${cx}" y="${cy + 15}" class="cl-room-name" style="font-size:${fs}px">${c.name.toUpperCase()}</text>
      </g>`;
    }).join('');
    const doors = DOORS.map(([x, y, w, h]) => `<rect class="cl-door" x="${x}" y="${y}" width="${w}" height="${h}"/>`).join('');
    board.innerHTML = `
      <svg viewBox="0 0 300 300" class="cl-board-svg" aria-hidden="true">
        <defs>
          <pattern id="clTiles" width="10" height="10" patternUnits="userSpaceOnUse">
            <rect width="10" height="10" fill="#d9c79a"/><path d="M10 0V10H0" fill="none" stroke="#bfa972" stroke-width=".8"/>
          </pattern>
        </defs>
        <rect width="300" height="300" rx="6" fill="url(#clTiles)"/>
        ${rooms}
        <rect x="110" y="90" width="80" height="100" rx="4" class="cl-center"/>
        <text x="150" y="182" class="cl-center-label">CASE FILE</text>
        <path class="cl-passage" id="cl-passage" d="M42 38 L258 275"/>
        <text x="74" y="22" class="cl-pass-mark">↘</text><text x="230" y="292" class="cl-pass-mark">↖</text>
        <text x="226" y="22" class="cl-pass-mark">↙</text><text x="72" y="292" class="cl-pass-mark">↗</text>
        ${doors}
      </svg>
      <div class="cl-envelope" id="cl-envelope" hidden><span>?</span></div>
      <div class="cl-piece" id="cl-wrench" hidden>🔧</div>
      <div class="cl-die" id="cl-die" hidden>•</div>`;
    for (const id of ids('who')) {
      const t = document.createElement('div');
      t.className = 'cl-token';
      t.id = 'tok-' + id;
      t.style.background = CARDS[id].color;
      board.appendChild(t);
    }
  }

  const START = {
    red: [95, 290], green: [95, 10], white: [205, 10], blue: [205, 290],
    yellow: [290, 85], purple: [10, 190],
  };
  function place(el, x, y) { el.style.left = (x / 3) + '%'; el.style.top = (y / 3) + '%'; }
  const tok = id => $('tok-' + id);

  // ── Seats ─────────────────────────────────────────────────────────────
  // The three players, drawn sitting on the far side of the table: chair,
  // shirt in their piece's colour, face and hair. Original, simple shapes.
  const LOOKS = {
    sam:   { skin: '#f1c9a0', hair: '#5b3a1e', style: 'short' },
    priya: { skin: '#a8714a', hair: '#1d1512', style: 'long' },
    leo:   { skin: '#e6b48a', hair: '#b5541f', style: 'curly' },
  };
  function person(p) {
    const L = LOOKS[p], shirt = CARDS[PLAYERS[p].token].color;
    const hairBack = L.style === 'long'
      ? `<path d="M29 40 Q28 18 50 17 Q72 18 71 40 L73 74 Q50 80 27 74 Z" fill="${L.hair}"/>` : '';
    const hairTop = {
      short: `<path d="M32 38 Q31 20 50 19 Q69 20 68 38 Q62 28 50 29 Q38 28 32 38 Z" fill="${L.hair}"/>`,
      long:  `<path d="M32 38 Q33 21 50 20 Q67 21 68 38 Q58 27 44 30 Q37 32 32 38 Z" fill="${L.hair}"/>`,
      curly: [[36, 28], [44, 22], [53, 21], [61, 25], [66, 32], [33, 35]]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="${L.hair}"/>`).join(''),
    }[L.style];
    return `<svg viewBox="0 0 100 112" class="cl-person-svg">
      <rect x="20" y="26" width="60" height="86" rx="10" fill="#3a2212"/>
      <rect x="25" y="31" width="50" height="81" rx="7" fill="#4b2c17"/>
      ${hairBack}
      <path d="M12 112 Q13 76 50 70 Q87 76 88 112 Z" fill="${shirt}"/>
      <path d="M38 71 L50 84 L62 71" fill="none" stroke="#0003" stroke-width="3"/>
      <rect x="44" y="55" width="12" height="16" rx="4" fill="${L.skin}"/>
      <ellipse cx="50" cy="41" rx="17" ry="19" fill="${L.skin}"/>
      ${hairTop}
      <circle cx="43" cy="43" r="2.2" fill="#1b1b1b"/><circle cx="57" cy="43" r="2.2" fill="#1b1b1b"/>
      <path d="M44 51 Q50 55 56 51" fill="none" stroke="#1b1b1b" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
  }
  function buildSeats() {
    for (const seat of document.querySelectorAll('.cl-seat')) {
      const p = PLAYERS[seat.dataset.p];
      seat.innerHTML = `
        <div class="cl-avatar cl-person">${person(seat.dataset.p)}</div>
        <div class="cl-seat-name">${p.name}</div>
        <div class="cl-backs"></div>
        <div class="cl-bubble" hidden></div>`;
    }
  }
  const seat = p => document.querySelector(`.cl-seat[data-p="${p}"]`);
  function setBacks(p, n) {
    seat(p).querySelector('.cl-backs').innerHTML = '<i></i>'.repeat(n);
  }

  // ── Notes (the detective notepad) ─────────────────────────────────────
  let marks = {};
  function renderNotes() {
    const col = kind => `<div class="cl-ncol"><div class="cl-nhead">${KIND_LABEL[kind]}</div>${ids(kind).map(id => {
      const m = marks[id];
      const cls = !m ? '' : m === 'win' ? ' win' : m === 'maybe' ? ' maybe' : ' out';
      const tag = !m ? '' : m === 'win' ? '✓' : m === 'maybe' ? '?' : '✗ ' + m;
      return `<div class="cl-nrow${cls}" data-n="${id}"><span>${CARDS[id].name}</span><b>${tag}</b></div>`;
    }).join('')}</div>`;
    notesEl.innerHTML = `<div class="cl-notes-head"><span>📝 Your notes</span>
      <button class="cl-notes-close" aria-label="Close notes">✕</button></div>
      <div class="cl-ncols">${col('who')}${col('what')}${col('where')}</div>`;
  }
  async function mark(id, val, pause = 380) {
    marks[id] = val;
    renderNotes();
    const row = notesEl.querySelector(`[data-n="${id}"]`);
    if (!FAST && row) row.classList.add('pop');
    await wait(pause);
  }
  function openNotes(on) { notesEl.hidden = !on; $('cl-notes-btn').classList.toggle('on', on); }
  notesEl.addEventListener('click', e => { if (e.target.closest('.cl-notes-close')) openNotes(false); });
  $('cl-notes-btn').addEventListener('click', () => openNotes(notesEl.hidden));

  // ── Timing: FAST replays are instant; a newer goTo cancels older runs ──
  let FAST = false, gen = 0;
  const CANCEL = Symbol('cancel');
  async function wait(ms) {
    if (FAST) return;
    const g = gen;
    await new Promise(r => setTimeout(r, ms));
    if (g !== gen) throw CANCEL;
  }
  async function walk(id, pts, ms = 260) {
    for (const [x, y] of pts) { place(tok(id), x, y); await wait(ms); }
  }

  function say(who, text) {
    const b = who === 'me' ? $('cl-bubble-me') : seat(who).querySelector('.cl-bubble');
    b.innerHTML = text;
    b.hidden = false;
  }
  function seatClass(p, cls, on = true) { (p === 'me' ? $('cl-me') : seat(p)).classList.toggle(cls, on); }

  // Animate a card from one element to another, in screen space above the
  // table. Returns once it lands. In FAST mode it does nothing.
  async function flyCard(fromEl, toEl, { id = null, up = false, ms = 520, scale = 1 } = {}) {
    if (FAST) return;
    const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
    const c = cardEl(id, up);
    c.classList.add('cl-flying');
    const w = 58 * scale, h = 82 * scale;
    Object.assign(c.style, { width: w + 'px', height: h + 'px', left: '0px', top: '0px' });
    const at = r => `translate(${r.left + r.width / 2 - w / 2}px, ${r.top + r.height / 2 - h / 2}px)`;
    c.style.transform = at(a) + ' scale(.6)';
    fly.appendChild(c);
    c.getBoundingClientRect();
    c.style.transition = `transform ${ms}ms cubic-bezier(.3,.7,.3,1)`;
    c.style.transform = at(b) + ' scale(1)';
    try { await wait(ms + 30); } finally { c.remove(); }
  }

  async function roll(n) {
    const die = $('cl-die');
    die.hidden = false;
    const pips = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
    if (!FAST) {
      die.classList.add('rolling');
      for (let i = 0; i < 9; i++) { die.textContent = pips[(i * 7 + 3) % 6]; await wait(80); }
      die.classList.remove('rolling');
    }
    die.textContent = pips[n - 1];
    die.dataset.n = n;
  }

  function showBanner(html, kind) {
    banner.className = 'cl-banner ' + (kind || '');
    banner.innerHTML = html;
    banner.hidden = false;
  }

  // Three piles (and later the answer) laid out flat in front of the board.
  function setTray(html) { tray.innerHTML = html; tray.hidden = !html; }
  function pilesHtml(left) {
    return `<div class="cl-piles">${['who', 'what', 'where'].map(k => `
      <div class="cl-pile" data-k="${k}"><div class="cl-pile-stack">${'<div class="cl-back"><span>?</span></div>'.repeat(Math.min(3, left[k]))}</div>
      <b>${KIND_LABEL[k]}</b><span>${left[k]} cards</span></div>`).join('')}</div>`;
  }

  // ── Reset to the very start of the scene ──────────────────────────────
  function reset() {
    for (const [id, [x, y]] of Object.entries(START)) { place(tok(id), x, y); tok(id).hidden = false; }
    for (const id of ['cl-envelope', 'cl-wrench', 'cl-die']) $(id).hidden = true;
    $('cl-envelope').className = 'cl-envelope';
    $('cl-passage').classList.remove('on');
    setTray('');
    banner.hidden = true;
    for (const p of Object.keys(PLAYERS)) { setBacks(p, 0); seat(p).className = 'cl-seat'; }
    seat('sam').className = 'cl-seat';
    $('cl-me').className = 'cl-me';
    hand.innerHTML = '';
    HANDS.me.forEach(id => { const c = cardEl(id, false); c.classList.add('undealt'); hand.appendChild(c); });
    marks = {};
    renderNotes();
    openNotes(false);
    clearTalk();
  }
  function clearTalk() {
    document.querySelectorAll('.cl-bubble').forEach(b => { b.hidden = true; });
    document.querySelectorAll('.cl-seat, #cl-me').forEach(s => s.classList.remove('turn', 'asked', 'pass', 'shows', 'think'));
    banner.hidden = true;
  }

  // ── The script ────────────────────────────────────────────────────────
  // title: big caption. sub: one short line. Words are kept few on purpose.
  const STEPS = [
    {
      title: 'Welcome to the table',
      sub: 'Someone did it. Find out <b>WHO</b>, with <b>WHAT</b>, and <b>WHERE</b>.',
      async run() {
        for (const p of ['sam', 'priya', 'leo']) { seatClass(p, 'here'); await wait(220); }
        say('sam', 'Hi! I play <b style="color:#ff8a80">Red</b>');
        await wait(500);
        say('priya', 'I’m <b style="color:#8be0a4">Green</b>');
        await wait(500);
        say('leo', 'I’m <b style="color:#ffe082">Yellow</b>');
        await wait(500);
        say('me', 'And you’re <b style="color:#90caf9">Blue</b>');
      },
    },
    {
      title: '21 cards, 3 piles',
      sub: '6 suspects. 6 weapons. 9 rooms.',
      async run() {
        setTray(pilesHtml({ who: 6, what: 6, where: 9 }));
        if (!FAST) {
          // Fan a few faces so people see what each pile is.
          const peek = ['red', 'rope', 'kitchen'];
          tray.querySelectorAll('.cl-pile').forEach((pile, i) => {
            const c = cardEl(peek[i], true);
            c.classList.add('cl-peek');
            pile.appendChild(c);
          });
          await wait(1600);
          tray.querySelectorAll('.cl-peek').forEach(c => c.remove());
        }
      },
    },
    {
      title: 'One of each, in secret',
      sub: 'It goes in the envelope. Nobody looks. That’s the answer.',
      async run() {
        setTray(pilesHtml({ who: 6, what: 6, where: 9 }));
        const env = $('cl-envelope');
        env.hidden = false;
        const piles = [...tray.querySelectorAll('.cl-pile')];
        for (let i = 0; i < 3; i++) {
          await flyCard(piles[i], env, { ms: 600 });
          env.dataset.n = i + 1;
        }
        setTray(pilesHtml({ who: 5, what: 5, where: 8 }));
        env.classList.add('sealed');
      },
    },
    {
      title: 'Deal out the rest',
      sub: 'All of them. Some people get one extra.',
      async run() {
        setTray('<div class="cl-deck"><div class="cl-back"><span>?</span></div><b>18 cards</b></div>');
        const deck = tray.querySelector('.cl-deck');
        const order = ['sam', 'priya', 'leo', 'me'];
        const got = { sam: 0, priya: 0, leo: 0, me: 0 };
        for (let i = 0; i < 18; i++) {
          const p = order[i % 4];
          const target = p === 'me' ? hand.children[got.me] : seat(p).querySelector('.cl-backs');
          await flyCard(deck, target, { ms: 240 });
          got[p]++;
          if (p === 'me') hand.children[got.me - 1].classList.remove('undealt');
          else setBacks(p, got[p]);
        }
        if (FAST) { for (const p of Object.keys(PLAYERS)) setBacks(p, HANDS[p].length); [...hand.children].forEach(c => c.classList.remove('undealt')); }
        setTray('');
      },
    },
    {
      title: 'These are yours',
      sub: 'So they’re <b>not</b> in the envelope. Cross them off.',
      async run() {
        for (const c of hand.children) { c.classList.add('up'); await wait(240); }
        await wait(400);
        openNotes(true);
        await wait(300);
        for (const id of HANDS.me) await mark(id, 'me');
      },
    },
    {
      title: 'Your turn: roll and move',
      sub: 'You rolled a 5. Walk to a room.',
      async run() {
        seatClass('me', 'turn');
        await roll(5);
        await wait(500);
        await walk('blue', [[205, 270], [205, 250], [205, 230], [205, 210], [205, 200]]);
        await walk('blue', [[254, 187]], 400);
        say('me', 'I’m in the <b>Library</b>');
      },
    },
    {
      title: 'In a room? Make a guess',
      sub: 'Name a suspect and a weapon. The room is the one you’re in.',
      async run() {
        seatClass('me', 'turn');
        $('cl-die').hidden = true;
        say('me', '“Was it <b>Red</b>, with the <b>Wrench</b>, in the <b>Library</b>?”');
        await wait(900);
        // The named suspect and weapon are pulled into the room.
        await walk('red', [[234, 187]], 700);
        $('cl-wrench').hidden = false;
        place($('cl-wrench'), 284, 186);
        await wait(300);
      },
    },
    {
      title: 'Ask to your left',
      sub: 'Sam checks his cards. He has none of those 3.',
      async run() {
        seatClass('me', 'turn');
        seatClass('sam', 'asked');
        await wait(700);
        say('sam', 'Can’t help 🤷');
        seatClass('sam', 'pass');
      },
    },
    {
      title: 'Priya shows you one',
      sub: 'Only to you, in secret. Then the asking stops.',
      async run() {
        seatClass('me', 'turn');
        seatClass('sam', 'pass');
        seatClass('priya', 'asked');
        await wait(500);
        say('priya', 'I have one 🤫');
        await wait(600);
        setTray('<div class="cl-answer cl-secret"><div class="cl-slot"></div><span>👀 Only you see it</span></div>');
        const slot = tray.querySelector('.cl-slot');
        await flyCard(seat('priya').querySelector('.cl-backs'), slot, { ms: 700, scale: 1.2 });
        const c = cardEl('wrench', false);
        slot.appendChild(c);
        await wait(250);
        c.classList.add('up');
        seatClass('priya', 'shows');
        await wait(500);
        say('leo', 'Not asked');
        seatClass('leo', 'pass');
      },
    },
    {
      title: 'Write it down',
      sub: 'Wrench is out. Priya has it.',
      async run() {
        // The card goes back to Priya, then you write it down.
        const slot = tray.querySelector('.cl-slot');
        if (slot && !FAST) {
          slot.firstElementChild?.classList.remove('up');
          await wait(450);
          slot.innerHTML = '';
          await flyCard(slot, seat('priya').querySelector('.cl-backs'), { ms: 500, scale: 1.2 });
        }
        setTray('');
        openNotes(true);
        await wait(300);
        await mark('wrench', 'P', 700);
      },
    },
    {
      title: 'Everyone else is watching',
      sub: 'Leo saw Priya show <i>something</i>. So she has Red, Wrench or Library.',
      async run() {
        seatClass('leo', 'think');
        say('leo', '🤔 Red, Wrench or Library…');
        await wait(400);
        say('sam', '🤔 Me too');
      },
    },
    {
      title: 'A few turns later…',
      sub: 'Keep guessing. Keep crossing off.',
      async run() {
        openNotes(true);
        await wait(400);
        const later = [['red', 'L'], ['yellow', 'S'], ['white', 'P'], ['blue', 'L'], ['candle', 'S'], ['pipe', 'L'],
          ['pistol', 'P'], ['ballroom', 'S'], ['conserv', 'P'], ['dining', 'P'], ['billiard', 'L'], ['lounge', 'S'], ['hall', 'S']];
        for (const [id, who] of later) await mark(id, who, 170);
        await wait(300);
        for (const id of ANSWER) await mark(id, 'maybe', 350);
      },
    },
    {
      title: 'Sure? Accuse!',
      sub: 'On your turn, name all 3. Then peek in the envelope.',
      async run() {
        for (const [id, who] of [['red', 'L'], ['yellow', 'S'], ['white', 'P'], ['blue', 'L'], ['candle', 'S'], ['pipe', 'L'],
          ['pistol', 'P'], ['ballroom', 'S'], ['conserv', 'P'], ['dining', 'P'], ['billiard', 'L'], ['lounge', 'S'], ['hall', 'S']]) marks[id] = who;
        for (const id of ANSWER) marks[id] = 'win';
        renderNotes();
        seatClass('me', 'turn');
        say('me', '“I accuse <b>Purple</b>, with the <b>Rope</b>, in the <b>Library</b>!”');
        await wait(1400);
        $('cl-bubble-me').hidden = true;
        const env = $('cl-envelope');
        env.classList.add('open');
        setTray(`<div class="cl-answer">${ANSWER.map(() => '<div class="cl-slot"></div>').join('')}</div>`);
        const slots = [...tray.querySelectorAll('.cl-slot')];
        for (let i = 0; i < 3; i++) {
          await flyCard(env, slots[i], { ms: 450, scale: 1.2 });
          const c = cardEl(ANSWER[i], false);
          slots[i].appendChild(c);
        }
        await wait(200);
        for (const s of slots) { s.firstElementChild.classList.add('up'); await wait(300); }
        await wait(300);
        showBanner('✓ All 3 right. <b>You win!</b>', 'good');
      },
    },
    {
      title: 'Wrong? You’re out',
      sub: 'Put the cards back unseen. You still show cards when asked.',
      async run() {
        $('cl-envelope').classList.add('open');
        setTray(`<div class="cl-answer">${ANSWER.map(id => `<div class="cl-slot"></div>`).join('')}</div>`);
        const slots = [...tray.querySelectorAll('.cl-slot')];
        slots.forEach((s, i) => { const c = cardEl(ANSWER[i], false); s.appendChild(c); });
        showBanner('✗ Wrong guess = out of the game', 'bad');
        seatClass('me', 'out');
        await wait(900);
        if (!FAST) { setTray(''); await wait(10); }
        $('cl-envelope').classList.remove('open');
        setTray('');
      },
    },
    {
      title: 'Shortcut: secret passages',
      sub: 'Corner rooms connect. Take one instead of rolling.',
      async run() {
        seatClass('me', 'out', false);
        $('cl-envelope').classList.remove('open');
        $('cl-passage').classList.add('on');
        place(tok('yellow'), 30, 30);
        seatClass('leo', 'turn');
        say('leo', 'Kitchen → Study!');
        await wait(900);
        await walk('yellow', [[150, 150], [262, 278]], 650);
      },
    },
    {
      title: 'That’s Clue!',
      sub: '',
      recap: true,
      async run() {
        $('cl-passage').classList.remove('on');
        showBanner(`<ol class="cl-recap">
          <li><b>Roll</b> and move</li>
          <li>In a room? <b>Guess</b></li>
          <li>To your left, <b>show one card</b></li>
          <li><b>Cross off</b> what you see</li>
          <li>Sure? <b>Accuse</b></li></ol>
          <div class="cl-recap-btns"><button class="cl-recap-btn" data-act="replay">↺ Watch again</button>
          <button class="cl-recap-btn" data-act="ask">💬 Ask a question</button></div>
          <p class="cl-legal">Rules in our own words, original art. Not affiliated with the makers of Clue.</p>`, 'recap');
      },
    },
  ];

  // ── Stepping ──────────────────────────────────────────────────────────
  let cur = 0;
  $('cl-steptotal').textContent = STEPS.length;

  async function goTo(i) {
    i = Math.max(0, Math.min(STEPS.length - 1, i));
    cur = i;
    const myGen = ++gen;
    app.classList.add('cl-instant');
    FAST = true;
    reset();
    try {
      for (let j = 0; j < i; j++) { clearTalk(); await STEPS[j].run(); }
    } catch (e) { if (e !== CANCEL) throw e; }
    if (myGen !== gen) return;
    clearTalk();
    if (!STEPS[i].keepNotes) openNotes(false);
    app.getBoundingClientRect();
    app.classList.remove('cl-instant');
    FAST = false;
    const s = STEPS[i];
    $('cl-cap-title').innerHTML = s.title;
    $('cl-cap-sub').innerHTML = s.sub;
    $('cl-cap-sub').hidden = !s.sub;
    $('cl-stepnum').textContent = i + 1;
    $('cl-back').disabled = i === 0;
    $('cl-next').textContent = i === STEPS.length - 1 ? '↺ Again' : 'Next →';
    $('cl-caption').classList.remove('fresh'); void $('cl-caption').offsetWidth; $('cl-caption').classList.add('fresh');
    speak(s);
    try {
      await wait(250);
      await s.run();
    } catch (e) { if (e !== CANCEL) throw e; }
  }

  $('cl-next').addEventListener('click', () => goTo(cur === STEPS.length - 1 ? 0 : cur + 1));
  $('cl-back').addEventListener('click', () => goTo(cur - 1));
  document.addEventListener('keydown', e => {
    if (document.body.classList.contains('ask-open')) return;
    if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); $('cl-next').click(); }
    if (e.key === 'ArrowLeft') goTo(cur - 1);
  });
  banner.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'replay') goTo(0);
    if (act === 'ask') ask?.open();
  });

  // ── Read aloud (the phone's own voice; nothing is sent anywhere) ──────
  let voiceOn = false;
  try { voiceOn = localStorage.getItem('cl-voice') === '1'; } catch { /* private mode */ }
  const canSpeak = 'speechSynthesis' in window;
  const vBtn = $('cl-voice');
  if (!canSpeak) vBtn.hidden = true;
  function paintVoice() { vBtn.setAttribute('aria-pressed', voiceOn); vBtn.textContent = voiceOn ? '🔊 Reading' : '🔈 Read aloud'; vBtn.classList.toggle('on', voiceOn); }
  paintVoice();
  function speak(s) {
    if (!canSpeak) return;
    speechSynthesis.cancel();
    if (!voiceOn) return;
    const plain = (s.title + '. ' + (s.sub || '')).replace(/<[^>]+>/g, '').replace(/[“”]/g, '');
    speechSynthesis.speak(new SpeechSynthesisUtterance(s.recap
      ? plain + ' Roll and move. In a room, guess. To your left, show one card. Cross off what you see. Sure? Accuse.' : plain));
  }
  vBtn.addEventListener('click', () => {
    voiceOn = !voiceOn;
    try { localStorage.setItem('cl-voice', voiceOn ? '1' : '0'); } catch { /* fine */ }
    paintVoice();
    speak(STEPS[cur]);
  });

  // ── Ask a question (offline, curated) ─────────────────────────────────
  const ENTRIES = [
    { id: 'goal', q: 'How do I win?', keys: ['win', 'goal', 'point', 'object', 'aim'],
      a: 'Be the first to name the **suspect**, **weapon** and **room** hidden in the envelope. You do it with an accusation on your turn, and you only get one.' },
    { id: 'players', q: 'How many players?', keys: ['how many players', 'players', 'people', 'two players'],
      a: 'Usually **3 to 6**. Deal out every card, even if some people end up with one more.' },
    { id: 'setup', q: 'How do I set up?', keys: ['setup', 'set up', 'start', 'begin', 'envelope'],
      a: 'Sort the cards into **suspects, weapons and rooms**. Shuffle each pile and put **one of each** in the envelope without looking. Shuffle the rest together and deal them all out. Everyone puts their piece on its start square.' },
    { id: 'move', q: 'How do I move?', keys: ['move', 'roll', 'dice', 'die', 'squares', 'diagonal'],
      a: 'Roll and move that many squares, **up, down or sideways** (not diagonally). You can’t land on the same square twice in one move or walk through other pieces. Entering a room ends your move, even with steps left over. Go in and out through **doors** only.' },
    { id: 'guess', q: 'How do I make a guess?', keys: ['guess', 'suggest', 'suggestion', 'ask'],
      a: 'When you **walk into a room**, name a suspect and a weapon. The room is the one you’re standing in. Move that suspect’s piece (and the weapon) into the room with you. Then the players to your left check their cards one at a time.' },
    { id: 'show', q: 'Who shows me a card?', keys: ['show', 'disprove', 'reveal', 'card', 'left'],
      a: 'Start with the player on your **left**. If they hold any of the 3 cards you named, they must show you **one**, secretly. If not, the next player checks. As soon as **one person shows you a card, it stops**.' },
    { id: 'two', q: 'I have two of the cards. Which do I show?', keys: ['two cards', 'both', 'more than one', 'which card', 'choose'],
      a: 'Your choice. Show just **one**. Picking the card you’ve already shown that player gives away less.' },
    { id: 'nobody', q: 'What if nobody can show a card?', keys: ['nobody', 'no one', 'nobody shows', 'no cards'],
      a: 'Then nobody else has any of them. Those cards are either **in the envelope** or **in your own hand**. That’s a big clue.' },
    { id: 'own', q: 'Can I name my own cards?', keys: ['own card', 'my card', 'bluff', 'trick', 'lie'],
      a: 'Yes. It’s a classic **bluff**: name a card you hold and everyone else learns the wrong thing.' },
    { id: 'accuse', q: 'How do I accuse?', keys: ['accuse', 'accusation', 'final', 'solve', 'answer'],
      a: 'On your turn, say “**I accuse**” and name a suspect, weapon and room. **Any** room, you don’t have to be in it. Then look in the envelope **alone**. All 3 right: show everyone, you win.' },
    { id: 'wrong', q: 'What if my accusation is wrong?', keys: ['wrong', 'mistake', 'out', 'lose', 'incorrect'],
      a: 'Put the cards back **without showing anyone**. You’re **out**: no more turns. But you **stay at the table** and still show cards when someone guesses.' },
    { id: 'passage', q: 'What are secret passages?', keys: ['secret passage', 'passage', 'tunnel', 'corner', 'shortcut'],
      a: 'The **corner rooms** connect to the opposite corner. On your turn, instead of rolling, you can take the passage straight there and then make a guess.' },
    { id: 'moved', q: 'Someone pulled my piece into a room. Now what?', keys: ['moved', 'pulled', 'dragged', 'my piece', 'teleport'],
      a: 'You stay there. On your next turn you can **guess in that room** without moving, or leave as normal.' },
    { id: 'stay', q: 'Can I stay in a room and guess again?', keys: ['stay', 'same room', 'again', 'twice'],
      a: 'Not on your own. To guess there again, **leave and come back** on a later turn (or get pulled back in by someone else’s guess).' },
    { id: 'notes', q: 'How should I take notes?', keys: ['notes', 'notepad', 'sheet', 'write', 'track'],
      a: 'Cross off **your own cards** first. When someone shows you a card, cross it off and write **who** has it. When someone shows a card to someone else, note that they hold **one of those 3**.' },
    { id: 'tips', q: 'Any strategy tips?', keys: ['strategy', 'tip', 'tips', 'better', 'good at', 'help'],
      a: 'Guess cards you **don’t** know about, mixed with one you **hold** to narrow things down. Watch who shows cards to whom. And **don’t accuse** until you’re sure: one wrong accusation and you’re out.' },
  ];
  const ask = window.AskSheet?.create({
    title: 'Ask about Clue', entries: ENTRIES, context: () => ({}),
    suggest: () => ['show', 'nobody', 'accuse', 'wrong', 'passage', 'tips'],
    intro: 'Ask anything about the rules. Try “what if nobody can show a card?”',
    placeholder: 'e.g. "can I name my own cards?"',
  });
  $('cl-ask').addEventListener('click', () => ask?.open());

  // ── Go ────────────────────────────────────────────────────────────────
  buildBoard();
  buildSeats();
  goTo(0);
})();
