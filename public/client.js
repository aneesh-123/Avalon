// ── Constants ──
const ROLE_DESCRIPTIONS = {
  'Merlin':           'Knows all evil players except Mordred. Must stay hidden — if Good wins, the Assassin gets one shot to identify and kill Merlin.',
  'Percival':         'Sees two players marked as "Merlin or Morgana" but doesn\'t know which is which. Protect the real Merlin.',
  'Loyal Servant':    'No special knowledge. Use your judgment to root out the traitors.',
  'Assassin':         'Evil. If Good wins all quests, gets one final chance to assassinate Merlin and steal the win.',
  'Morgana':          'Evil. Appears as Merlin to Percival — use this to confuse and protect your allies.',
  'Mordred':          'Evil, but invisible to Merlin. Stay hidden and sabotage from the shadows.',
  'Oberon':           'Evil, but doesn\'t know the other evil players and isn\'t known by them. A lone wolf.',
  'Minion of Mordred':'Evil. Work with your allies to sabotage quests and defeat Good.',
};

const ROLE_ART = {
  'Merlin':           { emoji:'🔵', bg:'linear-gradient(135deg,#1a237e,#283593)', glow:'#5c6bc0' },
  'Percival':         { emoji:'🛡', bg:'linear-gradient(135deg,#1b5e20,#2e7d32)', glow:'#66bb6a' },
  'Loyal Servant':    { emoji:'⚔', bg:'linear-gradient(135deg,#0d47a1,#1565c0)', glow:'#42a5f5' },
  'Assassin':         { emoji:'🗡', bg:'linear-gradient(135deg,#7f0000,#b71c1c)', glow:'#ef5350' },
  'Morgana':          { emoji:'🔮', bg:'linear-gradient(135deg,#4a148c,#6a1b9a)', glow:'#ce93d8' },
  'Mordred':          { emoji:'💀', bg:'linear-gradient(135deg,#212121,#424242)', glow:'#ef5350' },
  'Oberon':           { emoji:'👁', bg:'linear-gradient(135deg,#1a1a2e,#16213e)', glow:'#b39ddb' },
  'Minion of Mordred':{ emoji:'🌑', bg:'linear-gradient(135deg,#3e2723,#4e342e)', glow:'#ff7043' },
};

const EVIL_ROLES_CLIENT = new Set(['Assassin','Morgana','Mordred','Oberon','Minion of Mordred']);
const DEFAULT_EVIL = { 5:2, 6:2, 7:3, 8:3, 9:3, 10:4 };
const DEFAULT_TEAM_SIZES = {
  5:[2,3,2,3,3], 6:[2,3,4,3,4], 7:[2,3,3,4,4],
  8:[3,4,4,5,5], 9:[3,4,4,5,5], 10:[3,4,4,5,5]
};

function roleArt(role, size='large') {
  const a = ROLE_ART[role] || { emoji:'⚜️', bg:'linear-gradient(135deg,#1a1a2e,#16213e)', glow:'#c9a96e' };
  const dim = size === 'large' ? '90px' : '44px';
  const fs  = size === 'large' ? '2.6rem' : '1.3rem';
  return `<div class="role-art-circle" style="width:${dim};height:${dim};background:${a.bg};box-shadow:0 0 20px ${a.glow}55;font-size:${fs}">${a.emoji}</div>`;
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── Narration ──
let narrateMuted = false;
let narrateLastPhase = null;
let narrateInteracted = false; // iOS requires user gesture before speech

function narrateVoice() {
  const voices = window.speechSynthesis.getVoices();
  return voices.find(v =>
    v.name === 'Daniel' ||           // iOS/macOS British Male
    v.name === 'Arthur' ||           // macOS
    v.name.includes('Google UK English Male') ||
    v.name.includes('Google UK English Female') ||
    v.name.includes('English (UK)') ||
    (v.lang === 'en-GB')
  ) || voices.find(v => v.lang.startsWith('en')) || null;
}

function narrateSpeak(text, rate = 0.82, pitch = 0.88) {
  return new Promise(resolve => {
    if (narrateMuted || !('speechSynthesis' in window)) { resolve(); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate; u.pitch = pitch; u.volume = 1;
    const v = narrateVoice(); if (v) u.voice = v;
    u.onend = resolve; u.onerror = resolve;
    window.speechSynthesis.speak(u);
  });
}

async function narrateLines(lines) {
  if (narrateMuted) return;
  window.speechSynthesis.cancel();
  for (const item of lines) {
    const [text, pauseBefore = 0] = Array.isArray(item) ? item : [item, 0];
    if (pauseBefore > 0) await new Promise(r => setTimeout(r, pauseBefore * 1000));
    await narrateSpeak(text);
  }
}

function narratePhase(state) {
  if (narrateMuted || !narrateInteracted) return;
  if (state.phase === narrateLastPhase) return;
  narrateLastPhase = state.phase;
  const leader = state.leaderName;

  if (state.phase === 'team-select') {
    narrateLines([[`${leader} is the leader. Choose your team for quest ${state.currentCampaign + 1}.`, 0.5]]);
  } else if (state.phase === 'team-vote') {
    narrateLines([['The team has been proposed. All players, vote to approve or reject.', 0.3]]);
  } else if (state.phase === 'quest-vote') {
    narrateLines([['The quest team has been approved. Cast your votes in secret. Will you succeed… or betray?', 0.5]]);
  } else if (state.phase === 'quest-vote-ready') {
    narrateLines([[`All votes are in. ${leader}, reveal the outcome when ready.`, 0.3]]);
  } else if (state.phase === 'assassination') {
    narrateLines([
      ['Good has won three quests!', 0.5],
      ['But the game is not yet over.', 1.2],
      ['Assassin… you have one final chance.', 1.0],
      ['Choose wisely. Who is Merlin?', 0.8],
    ]);
  } else if (state.phase === 'game-over') {
    if (state.winner === 'good') {
      narrateLines([
        ['The forces of good have prevailed!', 0.5],
        ['Camelot is safe… for now.', 1.0],
      ]);
    } else {
      narrateLines([
        ['Evil prevails.', 0.5],
        ['The darkness descends upon Camelot.', 1.0],
      ]);
    }
  }
}

function narrateNightPhase(specialRoles) {
  if (narrateMuted) return;
  const hasPercival = specialRoles.includes('Percival');
  const hasMorgana  = specialRoles.includes('Morgana');
  const hasMordred  = specialRoles.includes('Mordred');
  const hasOberon   = specialRoles.includes('Oberon');
  const lines = [
    ['Darkness falls over Camelot.', 0.5],
    ['All players, close your eyes.', 1.5],
    ['Minions of Mordred' + (hasOberon ? ', excluding Oberon,' : '') + ' open your eyes and look around. Know your allies.', 2.5],
    ['Minions of Mordred, close your eyes.', 4.0],
    ['Merlin, open your eyes. Look around. Know your enemies.', 2.0],
    ['Merlin, close your eyes.', 4.0],
  ];
  if (hasPercival) {
    lines.push(['Percival, open your eyes.', 1.5]);
    lines.push([hasMorgana
      ? 'Two players will raise their hands — one is Merlin, one is Morgana. Choose wisely who to protect.'
      : 'Merlin will raise their hand. Protect them well.', 1.0]);
    lines.push(['Percival, close your eyes.', 4.0]);
  }
  lines.push(['All players may open your eyes.', 1.5]);
  lines.push(['The quest for Camelot begins.', 1.0]);
  narrateLines(lines);
}

// ── Session ──
function saveSession(d) { sessionStorage.setItem('avalon', JSON.stringify(d)); }
function loadSession()  { try { return JSON.parse(sessionStorage.getItem('avalon')); } catch { return null; } }
function clearSession() { sessionStorage.removeItem('avalon'); }

// ── State ──
const socket = io();
let myName        = '';
let myRoomCode    = '';
let playerCount   = 0;
let evilCount     = 0;
let activeToggles = new Set();
let campaignsConfig = [];  // [{teamSize, failsNeeded}]
let myRole        = null;
let myId          = null;
let gameSpecialRoles = [];
let _connectedOnce = false;

socket.on('connect', () => {
  myId = socket.id;
  if (_connectedOnce) {
    // Socket reconnected (new ID) — re-register with the room automatically
    const s = loadSession();
    if (s?.name && s?.code) {
      myName = s.name; myRoomCode = s.code;
      if (s.role) myRole = s.role;
      socket.emit('rejoin-room', { code: s.code, name: s.name });
    }
  }
  _connectedOnce = true;
});

// ── Narration toggle button ──
window.speechSynthesis?.getVoices(); // pre-load voices
document.getElementById('narrate-toggle').addEventListener('click', () => {
  narrateMuted = !narrateMuted;
  const btn = document.getElementById('narrate-toggle');
  btn.textContent = narrateMuted ? '🔇' : '🔊';
  btn.classList.toggle('muted', narrateMuted);
  if (narrateMuted) window.speechSynthesis?.cancel();
});

// ── Screens ──
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
  window.scrollTo(0, 0);
}

// ── Rejoin banner ──
const saved = loadSession();
if (saved?.name && saved?.code) {
  document.getElementById('rejoin-banner').style.display = 'block';
  document.getElementById('rejoin-name').textContent = saved.name;
}
document.getElementById('btn-rejoin')?.addEventListener('click', () => {
  const s = loadSession();
  if (!s) return;
  myName = s.name; myRoomCode = s.code;
  if (s.role) myRole = s.role;
  document.getElementById('placard-name-label').textContent = myName;
  socket.emit('rejoin-room', { code: s.code, name: s.name });
});

// ── Tooltip ──
document.querySelectorAll('.role-name-tip').forEach(el => {
  el.addEventListener('click', e => {
    e.stopPropagation();
    const role = el.dataset.role;
    document.getElementById('tooltip-role-img').innerHTML = roleArt(role, 'small');
    document.getElementById('tooltip-role-name').textContent = role;
    document.getElementById('tooltip-role-desc').textContent = ROLE_DESCRIPTIONS[role] || '';
    document.getElementById('role-tooltip').style.display = 'flex';
  });
});
document.getElementById('tooltip-close-btn').addEventListener('click', () => { document.getElementById('role-tooltip').style.display = 'none'; });
document.getElementById('role-tooltip').addEventListener('click', e => { if (e.target.id === 'role-tooltip') document.getElementById('role-tooltip').style.display = 'none'; });

// ── Back buttons ──
document.querySelectorAll('.back-btn').forEach(btn => btn.addEventListener('click', () => showScreen(btn.dataset.back)));

// ── Home ──
document.getElementById('btn-create').addEventListener('click', () => showScreen('create'));
document.getElementById('btn-join-screen').addEventListener('click', () => { document.getElementById('join-error').textContent = ''; showScreen('join'); });

// ── Create: player count ──
document.querySelectorAll('.count-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.count-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    playerCount = parseInt(btn.dataset.count);
    evilCount   = DEFAULT_EVIL[playerCount];
    activeToggles.clear();
    initCampaigns();
    document.getElementById('role-config').style.display = 'block';
    renderConfig();
  });
});

// ── Role config ──
function goodCount() { return playerCount - evilCount; }

const GOOD_SPECIALS = ['Percival'];
const EVIL_SPECIALS = ['Morgana', 'Mordred', 'Oberon'];
const ROLE_EMOJI = { Merlin:'🔵', Percival:'🛡', 'Loyal Servant':'⚔', Assassin:'🗡', Morgana:'🔮', Mordred:'💀', Oberon:'👁', Minion:'🌑' };

function renderConfig() {
  document.getElementById('good-count').textContent = goodCount();
  document.getElementById('evil-count').textContent = evilCount;

  // Build slot arrays
  const activeGoodSpecials = GOOD_SPECIALS.filter(r => activeToggles.has(r));
  const activeEvilSpecials = EVIL_SPECIALS.filter(r => activeToggles.has(r));
  const unusedGoodSpecials = GOOD_SPECIALS.filter(r => !activeToggles.has(r));
  const unusedEvilSpecials = EVIL_SPECIALS.filter(r => !activeToggles.has(r));

  const goodSlots = ['Merlin', ...activeGoodSpecials, ...Array(goodCount() - 1 - activeGoodSpecials.length).fill('Loyal Servant')];
  const evilSlots = ['Assassin', ...activeEvilSpecials, ...Array(evilCount - 1 - activeEvilSpecials.length).fill('Minion')];

  function makeBubble(role, align) {
    const isLocked = role === 'Merlin' || role === 'Assassin';
    const canChange = !isLocked;
    return `<div class="team-bubble ${align}${isLocked ? ' locked' : ''} tappable" data-role="${role}" data-align="${align}">
      ${ROLE_EMOJI[role] || ''} ${role}${canChange ? '<span class="bubble-caret">▾</span>' : '<span class="bubble-info">ⓘ</span>'}
    </div>`;
  }

  document.getElementById('team-bubbles-grid').innerHTML = `
    <div class="bubbles-group">
      <div class="bubbles-group-label good">⚔ Good — ${goodCount()} players</div>
      <div class="bubbles-row">${goodSlots.map(r => makeBubble(r, 'good')).join('')}</div>
    </div>
    <div class="bubbles-group">
      <div class="bubbles-group-label evil">💀 Evil — ${evilCount} players</div>
      <div class="bubbles-row">${evilSlots.map(r => makeBubble(r, 'evil')).join('')}</div>
    </div>`;

  // Attach popup behavior to ALL bubbles
  document.querySelectorAll('#team-bubbles-grid .team-bubble.tappable').forEach(bubble => {
    bubble.addEventListener('click', e => {
      e.stopPropagation();
      document.querySelectorAll('.bubble-dropdown').forEach(d => d.remove());
      const role = bubble.dataset.role;
      const align = bubble.dataset.align;
      const isLocked = role === 'Merlin' || role === 'Assassin';
      const isFiller = role === 'Loyal Servant' || role === 'Minion';
      const unused = align === 'good' ? unusedGoodSpecials : unusedEvilSpecials;

      // Description header
      const desc = ROLE_DESCRIPTIONS[role] || '';
      const isAlwaysRole = isLocked || (isFiller);

      // Swap options (only for non-locked)
      let swapHTML = '';
      if (!isLocked) {
        let options;
        if (isFiller) {
          options = unused.map(r => ({ role: r, action: 'add' }));
        } else {
          options = [
            ...unused.map(r => ({ role: r, action: 'swap' })),
            { role: align === 'good' ? 'Loyal Servant' : 'Minion', action: 'remove' },
          ];
        }
        if (options.length > 0) {
          swapHTML = `<div class="bd-divider"></div>` + options.map(o =>
            `<div class="bubble-option" data-role="${o.role}" data-action="${o.action}">
              ${ROLE_EMOJI[o.role] || ''} ${o.role === 'Loyal Servant' || o.role === 'Minion' ? `Remove ${role}` : o.role}
            </div>`).join('');
        }
      }

      const dd = document.createElement('div');
      dd.className = 'bubble-dropdown';
      dd.innerHTML = `
        <div class="bd-role-name">${ROLE_EMOJI[role] || ''} ${role}${isLocked ? ' <span class="bd-always">Always</span>' : ''}</div>
        <div class="bd-desc">${desc}</div>
        ${swapHTML}`;
      bubble.appendChild(dd);

      dd.querySelectorAll('.bubble-option').forEach(opt => {
        opt.addEventListener('click', ev => {
          ev.stopPropagation();
          if (opt.dataset.action === 'add') activeToggles.add(opt.dataset.role);
          else if (opt.dataset.action === 'swap') { activeToggles.delete(role); activeToggles.add(opt.dataset.role); }
          else if (opt.dataset.action === 'remove') activeToggles.delete(role);
          dd.remove();
          renderConfig();
        });
      });
      setTimeout(() => document.addEventListener('click', () => dd.remove(), { once: true }), 0);
    });
  });
  document.getElementById('evil-minus').disabled = evilCount <= 1;
  document.getElementById('evil-plus').disabled  = evilCount >= playerCount - 2;
}

document.getElementById('evil-minus').addEventListener('click', () => {
  if (evilCount <= 1) return; evilCount--;
  ['Morgana','Mordred','Oberon'].filter(r => activeToggles.has(r)).slice(evilCount - 1).forEach(r => activeToggles.delete(r));
  renderConfig(); renderCampaignRows();
});
document.getElementById('evil-plus').addEventListener('click', () => {
  if (evilCount >= playerCount - 2) return; evilCount++;
  ['Percival'].filter(r => activeToggles.has(r)).slice(goodCount() - 1).forEach(r => activeToggles.delete(r));
  renderConfig(); renderCampaignRows();
});
// ── Campaign config ──
function initCampaigns() {
  const sizes = DEFAULT_TEAM_SIZES[playerCount] || [2,3,2,3,3];
  campaignsConfig = sizes.map((s, i) => ({
    teamSize: s,
    failsNeeded: (playerCount >= 7 && i === 3) ? 2 : 1
  }));
  renderCampaignRows();
}

function renderCampaignRows() {
  document.getElementById('campaign-count-label').textContent = campaignsConfig.length;
  const container = document.getElementById('campaign-rows');
  container.innerHTML = campaignsConfig.map((c, i) => `
    <div class="campaign-row">
      <span class="camp-num">${i + 1}</span>
      <div class="camp-stepper">
        <button class="step-btn" data-camp="${i}" data-field="teamSize" data-dir="-1">−</button>
        <span class="step-val">${c.teamSize}</span>
        <button class="step-btn" data-camp="${i}" data-field="teamSize" data-dir="1">+</button>
      </div>
      <div class="camp-stepper">
        <button class="step-btn" data-camp="${i}" data-field="failsNeeded" data-dir="-1">−</button>
        <span class="step-val">${c.failsNeeded}</span>
        <button class="step-btn" data-camp="${i}" data-field="failsNeeded" data-dir="1">+</button>
      </div>
    </div>`).join('');

  container.querySelectorAll('.step-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.camp), field = btn.dataset.field, dir = parseInt(btn.dataset.dir);
      const c = campaignsConfig[i];
      if (field === 'teamSize') {
        c.teamSize = Math.max(1, Math.min(playerCount, c.teamSize + dir));
        c.failsNeeded = Math.min(c.failsNeeded, c.teamSize); // can't need more fails than team size
      } else {
        c.failsNeeded = Math.max(1, Math.min(c.teamSize, c.failsNeeded + dir));
      }
      renderCampaignRows();
    });
  });
}

document.getElementById('advanced-toggle').addEventListener('click', () => {
  const sec = document.getElementById('advanced-section');
  const arrow = document.getElementById('advanced-arrow');
  const open = sec.style.display !== 'none';
  sec.style.display = open ? 'none' : 'block';
  arrow.textContent = open ? '▼' : '▲';
});

document.getElementById('campaign-minus').addEventListener('click', () => {
  if (campaignsConfig.length <= 1) return;
  campaignsConfig.pop();
  renderCampaignRows();
});
document.getElementById('campaign-plus').addEventListener('click', () => {
  if (campaignsConfig.length >= 10) return;
  campaignsConfig.push({ teamSize: 3, failsNeeded: 1 });
  renderCampaignRows();
});

// ── Create submit ──
document.getElementById('create-submit-btn').addEventListener('click', () => {
  const name = document.getElementById('create-name-input').value.trim();
  if (!name)        { alert('Please enter your name.'); return; }
  if (!playerCount) { alert('Please select a player count.'); return; }
  myName = name;
  socket.emit('create-room', {
    playerCount, campaignsConfig, name,
    roleConfig: {
      evilCount,
      goodSpecials: ['Percival'].filter(r => activeToggles.has(r)),
      evilSpecials: ['Morgana','Mordred','Oberon'].filter(r => activeToggles.has(r)),
    },
  });
});

// ── Join ──
document.getElementById('join-submit-btn').addEventListener('click', () => {
  const code = document.getElementById('join-code-input').value.trim().toUpperCase();
  const name = document.getElementById('join-name-input').value.trim();
  if (!code || code.length !== 5) { document.getElementById('join-error').textContent = 'Enter a 5-letter room code.'; return; }
  if (!name)                      { document.getElementById('join-error').textContent = 'Enter your name.'; return; }
  myName = name;
  socket.emit('join-room', { code, name });
});

// ── Socket: lobby ──
socket.on('room-created', ({ code }) => {
  myRoomCode = code;
  document.getElementById('lobby-code').textContent = code;
  saveSession({ name: myName, code });
  showScreen('lobby');
});
socket.on('room-joined', ({ code }) => {
  myRoomCode = code;
  document.getElementById('lobby-code').textContent = code;
  saveSession({ name: myName, code });
  showScreen('lobby');
});
socket.on('join-error', msg => { document.getElementById('join-error').textContent = msg; });
socket.on('rejoin-ok', ({ state }) => {
  document.getElementById('lobby-code').textContent = myRoomCode;
  if (state === 'playing') { document.getElementById('placard-name-label').textContent = myName; showScreen('placard'); }
  else showScreen('lobby');
});
socket.on('rejoin-error', msg => { clearSession(); alert(msg + '\nStarting fresh.'); showScreen('home'); });

socket.on('lobby-update', state => {
  const { players, playerCount: needed } = state;
  const me = players.find(p => p.id === socket.id);
  const joined = players.length, full = joined === needed;
  const readyCount = players.filter(p => p.ready && !p.disconnected).length;
  const anyDropped = players.some(p => p.disconnected);

  document.getElementById('lobby-status').textContent =
    anyDropped ? `Waiting for players to reconnect…` :
    full ? `All ${needed} players joined!` : `Waiting for players… (${joined}/${needed})`;

  document.getElementById('lobby-players-list').innerHTML = players.map(p =>
    `<div class="lobby-player ${p.ready && !p.disconnected ? 'ready' : ''} ${p.disconnected ? 'dropped' : ''}">
       <span class="lobby-player-name">${esc(p.name)}</span>
       <span class="lobby-player-status">${p.disconnected ? '↻ Reconnecting…' : p.ready ? '✓ Ready' : 'Waiting'}</span>
     </div>`).join('');

  const readyBtn = document.getElementById('ready-btn');
  if (full) {
    readyBtn.style.display = 'block';
    readyBtn.textContent = me?.ready ? 'Unready' : "I'm Ready";
    readyBtn.className = 'primary-btn' + (me?.ready ? ' btn-unready' : '');
  } else {
    readyBtn.style.display = 'none';
  }
  document.getElementById('lobby-hint').textContent =
    anyDropped ? `Game cannot start until all players reconnect.` :
    full ? `Game starts when all ${needed} players are ready. (${readyCount}/${needed} ready)` : '';
});

document.getElementById('ready-btn').addEventListener('click', () => socket.emit('toggle-ready'));
document.getElementById('lobby-leave-btn').addEventListener('click', () => { clearSession(); location.reload(); });

// ── Socket: game start → placard ──
socket.on('game-start', () => {
  document.getElementById('placard-name-label').textContent = myName;
  showScreen('placard');
  narrateInteracted = false; // wait for first tap before narrating
});

socket.on('your-role', ({ role, isEvil, known }) => {
  myRole = { role, isEvil, known };
  const s = loadSession();
  if (s) saveSession({ ...s, role: myRole });
});

// ── Placard ──
document.getElementById('my-placard').addEventListener('click', () => {
  if (!narrateInteracted) {
    narrateInteracted = true;
    // Slight delay so role overlay opens first, then narration begins
    setTimeout(() => narrateNightPhase(gameSpecialRoles), 800);
  }
  if (!myRole) return;
  const { role, isEvil, known } = myRole;
  const card = document.getElementById('role-card');
  card.className = isEvil ? 'evil' : 'good';
  document.getElementById('overlay-allegiance').textContent = isEvil ? 'Evil — Minions of Mordred' : 'Good — Loyal to Arthur';
  document.getElementById('overlay-allegiance').className = 'role-card-allegiance ' + (isEvil ? 'evil' : 'good');
  document.getElementById('overlay-img').innerHTML = roleArt(role, 'large');
  document.getElementById('overlay-role').textContent = role;
  document.getElementById('overlay-desc').textContent = ROLE_DESCRIPTIONS[role] || '';
  const knownEl = document.getElementById('overlay-known');
  if (known.length > 0) {
    knownEl.className = 'role-card-known visible';
    knownEl.innerHTML = '<strong style="color:#c9a96e;font-size:0.8rem;text-transform:uppercase;letter-spacing:1px;">You can see:</strong><br><br>' +
      known.map(k => `<div class="known-entry ${k.css}">${esc(k.name)} — ${k.label}</div>`).join('');
  } else {
    knownEl.className = 'role-card-known';
    knownEl.innerHTML = '';
  }
  document.getElementById('role-overlay').style.display = 'flex';
});
document.getElementById('close-overlay-btn').addEventListener('click', () => {
  document.getElementById('role-overlay').style.display = 'none';
  document.getElementById('my-placard').classList.add('seen');
});

// ══════════════════════════════════════════
// GAME PHASE RENDERING
// ══════════════════════════════════════════
let lastGameState = null;
let myQuestVote = null;
let myQuestCampaign = -1;
let showingMyVote = false;

socket.on('phase-update', state => {
  lastGameState = state;
  // First time entering game phase — switch screens
  const onGame = document.getElementById('screen-game').classList.contains('active');
  const onPlacard = document.getElementById('screen-placard').classList.contains('active');
  if (!onGame) {
    if (state.phase !== 'team-select' || onPlacard) {
      // Show note on placard if this is transition from placard
    }
    // Show starting player note on placard screen
    if (onPlacard) {
      const note = document.getElementById('placard-starting-note');
      const isLeader = state.leaderId === socket.id;
      note.style.display = 'block';
      note.innerHTML = isLeader
        ? `<strong style="color:#c9a96e">You go first!</strong> Tap "Begin Game" when everyone has seen their role.`
        : `<span style="color:#888"><strong style="color:#e0d9c8">${esc(state.leaderName)}</strong> goes first!</span>`;
      // Add begin game button for leader
      if (isLeader && !document.getElementById('begin-game-btn')) {
        const btn = document.createElement('button');
        btn.id = 'begin-game-btn';
        btn.className = 'primary-btn';
        btn.style.marginTop = '20px';
        btn.textContent = 'Begin Game →';
        btn.addEventListener('click', () => showScreen('game'));
        document.getElementById('screen-placard').appendChild(btn);
      }
      if (!isLeader && !document.getElementById('begin-game-btn')) {
        const btn = document.createElement('button');
        btn.id = 'begin-game-btn';
        btn.className = 'primary-btn';
        btn.style.marginTop = '20px';
        btn.textContent = 'Continue to Game →';
        btn.addEventListener('click', () => showScreen('game'));
        document.getElementById('screen-placard').appendChild(btn);
      }
    }
  }
  renderGame(state);
  if (onGame) renderGame(state);
});

socket.on('game-paused', ({ disconnected }) => {
  const names = disconnected.join(', ');
  document.getElementById('pause-body').innerHTML =
    `Waiting for <strong>${esc(names)}</strong> to reconnect…`;
  document.getElementById('pause-overlay').style.display = 'flex';
});

socket.on('game-resumed', () => {
  document.getElementById('pause-overlay').style.display = 'none';
});

function renderGame(state) {
  if (state.specialRoles) gameSpecialRoles = state.specialRoles;
  narrateInteracted = true; // on game screen, user has definitely interacted
  narratePhase(state);
  renderCampaignTrack(state);
  renderGameMeta(state);
  renderGameContent(state);
}

function renderCampaignTrack(state) {
  const track = document.getElementById('campaign-track');
  const total = state.campaignsConfig.length;
  const toWin = Math.ceil(total / 2);
  track.innerHTML = state.campaignsConfig.map((c, i) => {
    const r = state.campaignResults[i];
    const cls = r === 'pass' ? 'ct-dot pass' : r === 'fail' ? 'ct-dot fail' : i === state.currentCampaign ? 'ct-dot current' : 'ct-dot';
    return `<div class="${cls}" title="Campaign ${i+1}: ${c.teamSize} players, ${c.failsNeeded} fail(s) to lose">
      ${r === 'pass' ? '✔' : r === 'fail' ? '✘' : `<span>${c.teamSize}</span>`}
    </div>`;
  }).join('');
}

function renderGameMeta(state) {
  const rejections = state.consecutiveRejections;
  document.getElementById('game-meta').innerHTML =
    `<div class="meta-left">
       <span class="meta-myname">You: <strong>${esc(myName)}</strong></span>
       <span class="meta-leader">Leader: <strong>${esc(state.leaderName)}</strong></span>
       ${rejections > 0 ? `<span class="meta-reject">⚠ ${rejections}/5 rejections</span>` : ''}
     </div>
     <button class="meta-order-btn" id="show-order-btn" title="Leader rotation">👑 Order</button>`;
  document.getElementById('show-order-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    const existing = document.getElementById('leader-order-popup');
    if (existing) { existing.remove(); return; }
    const popup = document.createElement('div');
    popup.id = 'leader-order-popup';
    popup.className = 'leader-order-popup';
    popup.innerHTML = `
      <div class="lop-title">Leader Rotation</div>
      ${state.leaderQueue.map((name, i) => `
        <div class="lop-row${i === 0 ? ' current' : ''}">
          ${i === 0 ? '👑' : `${i + 1}.`} ${esc(name)}${i === 0 ? ' <span class="lop-now">(now)</span>' : ''}
        </div>`).join('')}
      <div class="lop-note">Repeats in this order</div>`;
    document.body.appendChild(popup);
    setTimeout(() => {
      document.addEventListener('click', function close() {
        popup.remove(); document.removeEventListener('click', close);
      }, { once: true });
    }, 0);
  });
}

function renderGameContent(state) {
  const el = document.getElementById('game-content');
  const me = socket.id;
  const isLeader = state.leaderId === me;
  const onTeam   = state.proposedTeam.includes(me);
  const config   = state.campaignsConfig[state.currentCampaign] || {};
  const players  = state.players;

  if (state.phase === 'game-over') {
    const rolesHtml = state.revealedRoles ? `
      <div class="roles-reveal">
        <div class="roles-reveal-title">All Roles</div>
        ${state.revealedRoles.map(p => `
          <div class="role-reveal-row ${EVIL_ROLES_CLIENT.has(p.role) ? 'evil' : 'good'}">
            <span class="rr-name">${esc(p.name)}</span>
            <span class="rr-role">${esc(p.role)}</span>
          </div>`).join('')}
      </div>` : '';
    el.innerHTML = `
      <div class="game-over-box ${state.winner}">
        <div class="go-icon">${state.winner === 'good' ? '⚔️' : '💀'}</div>
        <div class="go-title">${state.winner === 'good' ? 'Good Wins!' : 'Evil Wins!'}</div>
        ${state.winReason ? `<div class="go-reason">${esc(state.winReason)}</div>` : ''}
        ${rolesHtml}
        <button class="primary-btn" style="margin-top:24px;" onclick="clearSession();location.reload()">← New Game</button>
      </div>`;
    return;
  }

  if (state.phase === 'assassination') {
    const isAssassin = state.assassinId === me;
    if (isAssassin) {
      el.innerHTML = `
        <div class="phase-header assassination-header">
          <div class="phase-title" style="color:#66ff88">Good won the quests!</div>
          <div class="phase-sub assassination-sub">You are the Assassin. One chance — who is Merlin?</div>
        </div>
        <div id="player-pick-list">
          ${players.filter(p => p.id !== me).map(p => `
            <div class="pick-player" data-id="${p.id}">
              <span class="pick-name">${esc(p.name)}</span>
              <span class="pick-check"></span>
            </div>`).join('')}
        </div>
        <button id="submit-assassinate-btn" class="primary-btn evil-action-btn" disabled style="margin-top:20px;">
          Select a player
        </button>`;
      let target = null;
      el.querySelectorAll('.pick-player').forEach(row => {
        row.addEventListener('click', () => {
          el.querySelectorAll('.pick-player').forEach(r => r.classList.remove('selected'));
          row.classList.add('selected');
          target = row.dataset.id;
          const btn = document.getElementById('submit-assassinate-btn');
          btn.textContent = `🗡 Assassinate ${esc(players.find(p => p.id === target)?.name || '')}`;
          btn.disabled = false;
        });
      });
      document.getElementById('submit-assassinate-btn').addEventListener('click', () => {
        if (!target) return;
        socket.emit('assassinate', { targetId: target });
      });
    } else {
      el.innerHTML = `
        <div class="phase-header assassination-header">
          <div class="phase-title" style="color:#66ff88">Good won the quests!</div>
          <div class="phase-sub assassination-sub">The Assassin is choosing who to eliminate…</div>
        </div>
        <div class="assassination-hint">Evil is deciding who they think Merlin is.</div>
        <div class="waiting-pulse">🗡️</div>`;
    }
    return;
  }

  if (state.phase === 'team-select') {
    if (isLeader) {
      el.innerHTML = `
        <div class="phase-header">
          <div class="phase-title">You are the Leader</div>
          <div class="phase-sub">Select <strong>${config.teamSize}</strong> players for Campaign ${state.currentCampaign + 1}</div>
        </div>
        <div id="player-pick-list">
          ${players.map(p => `
            <div class="pick-player" data-id="${p.id}">
              <span class="pick-name">${esc(p.name)}</span>
              <span class="pick-check"></span>
            </div>`).join('')}
        </div>
        <button id="submit-team-btn" class="primary-btn" disabled style="margin-top:20px;">
          Select ${config.teamSize} players (0/${config.teamSize})
        </button>`;

      let selected = new Set();
      el.querySelectorAll('.pick-player').forEach(row => {
        row.addEventListener('click', () => {
          const id = row.dataset.id;
          if (selected.has(id)) { selected.delete(id); row.classList.remove('selected'); }
          else if (selected.size < config.teamSize) { selected.add(id); row.classList.add('selected'); }
          const btn = document.getElementById('submit-team-btn');
          const count = selected.size;
          btn.textContent = count === config.teamSize ? `Propose Team →` : `Select ${config.teamSize} players (${count}/${config.teamSize})`;
          btn.disabled = count !== config.teamSize;
        });
      });
      document.getElementById('submit-team-btn').addEventListener('click', () => {
        socket.emit('propose-team', { team: [...selected] });
      });
    } else {
      el.innerHTML = `
        <div class="phase-header">
          <div class="phase-title">Campaign ${state.currentCampaign + 1}</div>
          <div class="phase-sub"><strong>${esc(state.leaderName)}</strong> is choosing a team of ${config.teamSize}…</div>
        </div>
        <div class="waiting-pulse">⏳</div>`;
    }
    return;
  }

  if (state.phase === 'team-vote' || state.phase === 'team-vote-result') {
    const voted    = state.teamVotes[me];
    const proposed = state.proposedTeam.map(id => players.find(p => p.id === id)?.name || '?');
    const allVoted = Object.keys(state.teamVotes).length === players.length;

    el.innerHTML = `
      <div class="phase-header">
        <div class="phase-title">Vote on the Team</div>
        <div class="phase-sub">Proposed by <strong>${esc(state.leaderName)}</strong></div>
      </div>
      <div class="proposed-team">
        ${proposed.map(n => `<span class="team-chip">${esc(n)}</span>`).join('')}
      </div>
      ${state.phase === 'team-vote' && !voted ? `
        <div class="vote-btns">
          <button class="vote-btn approve-btn" id="btn-approve">✓ Approve</button>
          <button class="vote-btn reject-btn" id="btn-reject">✗ Reject</button>
        </div>` : ''}
      ${voted && state.phase === 'team-vote' ? `<div class="voted-msg">You voted <strong>${voted === 'approve' ? '✓ Approve' : '✗ Reject'}</strong> — waiting for others…</div>` : ''}
      <div class="vote-roster">
        ${players.map(p => {
          const v = state.teamVotes[p.id];
          return `<div class="vote-row ${v ? (v === 'approve' ? 'approve' : 'reject') : ''}">
            <span>${esc(p.name)}</span>
            <span class="vote-tag">${v === 'approve' ? '✓ Approve' : v === 'reject' ? '✗ Reject' : '…'}</span>
          </div>`;
        }).join('')}
      </div>
      ${isLeader && state.phase === 'team-vote' && !allVoted ? `
        <button class="secondary-btn" id="btn-cancel-proposal" style="margin-top:16px;">↩ Change proposal</button>` : ''}`;

    if (state.phase === 'team-vote' && !voted) {
      document.getElementById('btn-approve')?.addEventListener('click', () => socket.emit('team-vote', { vote: 'approve' }));
      document.getElementById('btn-reject')?.addEventListener('click',  () => socket.emit('team-vote', { vote: 'reject' }));
    }
    document.getElementById('btn-cancel-proposal')?.addEventListener('click', () => socket.emit('cancel-proposal'));

    if (state.phase === 'team-vote-result') showResultOverlay(state);
    return;
  }

  if (state.phase === 'quest-vote' || state.phase === 'quest-vote-ready') {
    // Reset vote tracking if new campaign started
    if (state.currentCampaign !== myQuestCampaign) {
      myQuestVote = null; myQuestCampaign = state.currentCampaign; showingMyVote = false;
    }
    const proposed = state.proposedTeam.map(id => players.find(p => p.id === id)?.name || '?');
    const allIn    = state.phase === 'quest-vote-ready';
    const canReveal = allIn && isLeader;

    if (onTeam) {
      el.innerHTML = `
        <div class="phase-header">
          <div class="phase-title">You're on the Quest</div>
          <div class="phase-sub">Your vote is anonymous</div>
        </div>
        <div id="quest-vote-area">
          ${!myQuestVote ? `
            <div class="quest-vote-btns">
              <button class="qvote-btn pass-btn" id="qbtn-pass">✔ Pass</button>
              <button class="qvote-btn fail-btn" id="qbtn-fail">✘ Fail</button>
            </div>` : `
            <div class="voted-hidden-box">
              <div class="voted-hidden-row">
                <span class="voted-hidden-label">Your vote is hidden</span>
                <button class="secondary-btn small" id="show-vote-btn">${showingMyVote ? 'Hide' : 'Reveal'}</button>
              </div>
              ${showingMyVote ? `<div class="voted-reveal ${myQuestVote}">${myQuestVote === 'pass' ? '✔ Pass' : '✘ Fail'}</div>` : ''}
              <button class="secondary-btn small" id="change-vote-btn" style="margin-top:8px;">Change vote</button>
            </div>`}
        </div>
        <div class="quest-count">${state.questVoteCount}/${state.proposedTeam.length} voted</div>
        ${canReveal ? `<button class="primary-btn" id="reveal-quest-btn" style="margin-top:20px;">Reveal Quest Outcome →</button>` : ''}
        ${allIn && !canReveal ? `<div class="all-voted-msg">All votes in — waiting for <strong>${esc(state.leaderName)}</strong> to reveal…</div>` : ''}`;

      if (!myQuestVote) {
        document.getElementById('qbtn-pass')?.addEventListener('click', () => {
          myQuestVote = 'pass'; socket.emit('quest-vote', { vote: 'pass' }); renderGameContent(state);
        });
        document.getElementById('qbtn-fail')?.addEventListener('click', () => {
          myQuestVote = 'fail'; socket.emit('quest-vote', { vote: 'fail' }); renderGameContent(state);
        });
      } else {
        document.getElementById('show-vote-btn')?.addEventListener('click', () => {
          showingMyVote = !showingMyVote; renderGameContent(state);
        });
        document.getElementById('change-vote-btn')?.addEventListener('click', () => {
          myQuestVote = null; showingMyVote = false; renderGameContent(state);
        });
      }
      document.getElementById('reveal-quest-btn')?.addEventListener('click', () => socket.emit('reveal-quest'));
    } else {
      el.innerHTML = `
        <div class="phase-header">
          <div class="phase-title">Quest in Progress</div>
          <div class="phase-sub">${allIn ? 'All votes are in!' : 'Waiting for the team to vote…'}</div>
        </div>
        <div class="proposed-team">${proposed.map(n => `<span class="team-chip">${esc(n)}</span>`).join('')}</div>
        <div class="quest-count">${state.questVoteCount}/${state.proposedTeam.length} voted</div>
        ${canReveal ? `<button class="primary-btn" id="reveal-quest-btn" style="margin-top:20px;">Reveal Quest Outcome →</button>` : ''}
        ${allIn && !canReveal ? `<div class="all-voted-msg">Waiting for <strong>${esc(state.leaderName)}</strong> to reveal…</div>` : `<div class="waiting-pulse">⏳</div>`}`;
      document.getElementById('reveal-quest-btn')?.addEventListener('click', () => socket.emit('reveal-quest'));
    }
    return;
  }

  if (state.phase === 'quest-result') {
    showQuestResultOverlay(state);
  }
}

// ── Result overlays ──
function showResultOverlay(state) {
  const res = state.lastTeamVoteResult;
  if (!res) return;
  const overlay  = document.getElementById('result-overlay');
  const approved = res.approved;

  document.getElementById('result-icon').textContent  = approved ? '✓' : '✗';
  document.getElementById('result-icon').className    = approved ? 'result-icon-good' : 'result-icon-evil';
  document.getElementById('result-title').textContent = approved ? 'Team Approved!' : 'Team Rejected';
  document.getElementById('result-title').className   = approved ? 'result-title good' : 'result-title evil';
  narrateLines([[approved ? 'The team has been approved. The quest begins.' : `The team has been rejected. ${state.consecutiveRejections >= 4 ? 'One more rejection and evil wins automatically!' : ''}`, 0.3]]);

  const approves = res.votes.filter(v => v.vote === 'approve');
  const rejects  = res.votes.filter(v => v.vote === 'reject');
  document.getElementById('result-body').innerHTML = `
    <div class="result-votes">
      <div class="rv-col">
        <div class="rv-label approve">✓ Approve (${approves.length})</div>
        ${approves.map(v => `<div class="rv-name">${esc(v.name)}</div>`).join('')}
      </div>
      <div class="rv-col">
        <div class="rv-label reject">✗ Reject (${rejects.length})</div>
        ${rejects.map(v => `<div class="rv-name">${esc(v.name)}</div>`).join('')}
      </div>
    </div>
    ${!approved && state.consecutiveRejections > 0 ? `<div class="reject-warning">⚠ ${state.consecutiveRejections}/5 consecutive rejections</div>` : ''}`;

  overlay.style.display = 'flex';
  document.getElementById('result-continue-btn').onclick = () => {
    overlay.style.display = 'none';
    socket.emit('continue-game');
    showScreen('game');
  };
}

function showQuestResultOverlay(state) {
  const res = state.lastQuestResult;
  if (!res) return;
  const overlay = document.getElementById('result-overlay');
  const passed  = res.passed;

  document.getElementById('result-icon').textContent = passed ? '⚔️' : '💀';
  document.getElementById('result-icon').className   = '';
  document.getElementById('result-title').textContent = passed ? 'Quest Succeeded!' : 'Quest Failed!';
  document.getElementById('result-title').className   = passed ? 'result-title good' : 'result-title evil';
  // Dramatic fail card reveal
  let bodyHTML = `<div class="fail-cards">`;
  for (let i = 0; i < state.proposedTeam.length; i++) {
    const isFail = i < res.fails;
    bodyHTML += `<div class="fail-card ${isFail ? 'fail' : 'pass'}" style="animation-delay:${i * 0.18}s">${isFail ? '✘' : '✔'}</div>`;
  }
  bodyHTML += `</div>`;
  bodyHTML += `<div class="fail-summary">${res.fails === 0 ? 'No fail cards — quest passes!' : res.fails === 1 ? '1 fail card played.' : `${res.fails} fail cards played.`}`;
  if (res.fails > 0 && res.failsNeeded > 1) bodyHTML += ` (needed ${res.failsNeeded} to fail)`;
  bodyHTML += `</div>`;

  // Campaign score
  const passes   = state.campaignResults.filter(r => r === 'pass').length;
  const failures = state.campaignResults.filter(r => r === 'fail').length;
  narrateLines(passed
    ? [['The quest has succeeded!', 0.5], [`Good leads ${passes} to ${failures}.`, 1.2]]
    : [['The quest has failed.', 0.5], [res.fails === 1 ? 'One traitor among them.' : `${res.fails} traitors among them.`, 1.0], [`Evil leads ${failures} to ${passes}.`, 1.0]]);
  bodyHTML += `<div class="camp-score"><span class="good">${passes} ✔</span> — <span class="evil">${failures} ✘</span></div>`;

  document.getElementById('result-body').innerHTML = bodyHTML;
  overlay.style.display = 'flex';

  document.getElementById('result-continue-btn').onclick = () => {
    overlay.style.display = 'none';
    socket.emit('continue-game');
    if (state.winner) {
      showScreen('game');
      renderGame({ ...state, phase: 'game-over' });
    }
  };
}

function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
