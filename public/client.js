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

const DEFAULT_EVIL = { 5:2, 6:2, 7:3, 8:3, 9:3, 10:4 };

// ── State ──
const socket = io();
let myName       = '';
let myRoomCode   = '';
let playerCount  = 0;
let evilCount    = 0;
let activeToggles = new Set();
let myRole       = null;

// ── Screen management ──
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
}

// ── Tooltip ──
document.querySelectorAll('.role-name-tip').forEach(el => {
  el.addEventListener('click', e => {
    e.stopPropagation();
    const role = el.dataset.role;
    document.getElementById('tooltip-role-name').textContent = role;
    document.getElementById('tooltip-role-desc').textContent = ROLE_DESCRIPTIONS[role] || '';
    document.getElementById('role-tooltip').style.display = 'flex';
  });
});

document.getElementById('tooltip-close-btn').addEventListener('click', () => {
  document.getElementById('role-tooltip').style.display = 'none';
});

document.getElementById('role-tooltip').addEventListener('click', e => {
  if (e.target === document.getElementById('role-tooltip'))
    document.getElementById('role-tooltip').style.display = 'none';
});

// ── Back buttons ──
document.querySelectorAll('.back-btn').forEach(btn => {
  btn.addEventListener('click', () => showScreen(btn.dataset.back));
});

// ── Home ──
document.getElementById('btn-create').addEventListener('click', () => showScreen('create'));
document.getElementById('btn-join-screen').addEventListener('click', () => {
  document.getElementById('join-error').textContent = '';
  showScreen('join');
});

// ── Create screen: pick count ──
document.querySelectorAll('.count-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.count-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    playerCount = parseInt(btn.dataset.count);
    evilCount   = DEFAULT_EVIL[playerCount];
    activeToggles.clear();
    document.getElementById('role-config').style.display = 'block';
    renderConfig();
  });
});

// ── Role config ──
function goodCount() { return playerCount - evilCount; }

function renderConfig() {
  document.getElementById('good-count').textContent = goodCount();
  document.getElementById('evil-count').textContent = evilCount;

  const goodSpecialSlots = goodCount() - 1;
  const evilSpecialSlots = evilCount - 1;
  const goodToggles = ['Percival'];
  const evilToggles = ['Morgana','Mordred','Oberon'];
  const activeGood  = goodToggles.filter(r => activeToggles.has(r)).length;
  const activeEvil  = evilToggles.filter(r => activeToggles.has(r)).length;

  document.getElementById('loyal-filler-count').textContent  = `× ${goodSpecialSlots - activeGood}`;
  document.getElementById('minion-filler-count').textContent = `× ${evilSpecialSlots - activeEvil}`;

  [...goodToggles, ...evilToggles].forEach(role => {
    const btn = document.querySelector(`#toggle-${role} .toggle-btn`);
    if (!btn) return;
    const on        = activeToggles.has(role);
    const isGoodRole = goodToggles.includes(role);
    const slots     = isGoodRole ? goodSpecialSlots : evilSpecialSlots;
    const active    = isGoodRole ? activeGood : activeEvil;
    const overflow  = !on && active >= slots;
    btn.textContent = on ? 'On' : 'Off';
    btn.className   = 'toggle-btn ' + (on ? (isGoodRole ? 'on-good' : 'on-evil') : 'off') + (overflow ? ' disabled' : '');
    btn.disabled    = overflow;
  });

  document.getElementById('evil-minus').disabled = evilCount <= 1;
  document.getElementById('evil-plus').disabled  = evilCount >= playerCount - 2;
}

document.getElementById('evil-minus').addEventListener('click', () => {
  if (evilCount <= 1) return;
  evilCount--;
  ['Morgana','Mordred','Oberon'].filter(r => activeToggles.has(r))
    .slice(evilCount - 1).forEach(r => activeToggles.delete(r));
  renderConfig();
});

document.getElementById('evil-plus').addEventListener('click', () => {
  if (evilCount >= playerCount - 2) return;
  evilCount++;
  ['Percival'].filter(r => activeToggles.has(r))
    .slice(goodCount() - 1).forEach(r => activeToggles.delete(r));
  renderConfig();
});

document.querySelectorAll('.toggle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    const role = btn.dataset.role;
    activeToggles.has(role) ? activeToggles.delete(role) : activeToggles.add(role);
    renderConfig();
  });
});

document.getElementById('create-submit-btn').addEventListener('click', () => {
  const name = document.getElementById('create-name-input').value.trim();
  if (!name)         { alert('Please enter your name.'); return; }
  if (!playerCount)  { alert('Please select a player count.'); return; }
  myName = name;
  const roleConfig = {
    evilCount,
    goodSpecials: ['Percival'].filter(r => activeToggles.has(r)),
    evilSpecials: ['Morgana','Mordred','Oberon'].filter(r => activeToggles.has(r)),
  };
  socket.emit('create-room', { playerCount, roleConfig, name });
});

// ── Join screen ──
document.getElementById('join-submit-btn').addEventListener('click', () => {
  const code = document.getElementById('join-code-input').value.trim().toUpperCase();
  const name = document.getElementById('join-name-input').value.trim();
  if (!code || code.length !== 5) { document.getElementById('join-error').textContent = 'Enter a 5-letter room code.'; return; }
  if (!name)                      { document.getElementById('join-error').textContent = 'Enter your name.'; return; }
  myName = name;
  socket.emit('join-room', { code, name });
});

// ── Socket: room events ──
socket.on('room-created', ({ code }) => {
  myRoomCode = code;
  document.getElementById('lobby-code').textContent = code;
  showScreen('lobby');
});

socket.on('room-joined', ({ code }) => {
  myRoomCode = code;
  document.getElementById('lobby-code').textContent = code;
  showScreen('lobby');
});

socket.on('join-error', msg => {
  document.getElementById('join-error').textContent = msg;
});

socket.on('lobby-update', state => {
  const { players, playerCount: needed, state: roomState } = state;
  const me = players.find(p => p.id === socket.id);
  const joined   = players.length;
  const full     = joined === needed;
  const readyCount = players.filter(p => p.ready).length;

  // Status line
  document.getElementById('lobby-status').textContent =
    full ? `All ${needed} players joined!` : `Waiting for players… (${joined}/${needed})`;

  // Player list
  const list = document.getElementById('lobby-players-list');
  list.innerHTML = players.map(p =>
    `<div class="lobby-player ${p.ready ? 'ready' : ''}">
       <span class="lobby-player-name">${escHtml(p.name)}</span>
       <span class="lobby-player-status">${p.ready ? '✓ Ready' : 'Waiting'}</span>
     </div>`
  ).join('');

  // Ready button
  const readyBtn = document.getElementById('ready-btn');
  if (full) {
    readyBtn.style.display = 'block';
    readyBtn.textContent = me?.ready ? 'Unready' : 'I\'m Ready';
    readyBtn.className = 'primary-btn' + (me?.ready ? ' btn-unready' : '');
  } else {
    readyBtn.style.display = 'none';
  }

  // Hint
  const majority = Math.floor(needed / 2) + 1;
  document.getElementById('lobby-hint').textContent =
    full ? `Game starts when ${majority} of ${needed} players are ready. (${readyCount} ready)` : '';
});

document.getElementById('ready-btn').addEventListener('click', () => {
  socket.emit('toggle-ready');
});

document.getElementById('lobby-leave-btn').addEventListener('click', () => {
  socket.disconnect();
  location.reload();
});

// ── Game start → placard ──
socket.on('game-start', () => {
  document.getElementById('placard-name-label').textContent = myName;
  showScreen('placard');
});

socket.on('your-role', ({ role, isEvil, known }) => {
  myRole = { role, isEvil, known };
});

// ── Placard tap ──
document.getElementById('my-placard').addEventListener('click', () => {
  if (!myRole) return;
  const { role, isEvil, known } = myRole;
  const card = document.getElementById('role-card');
  card.className = isEvil ? 'evil' : 'good';

  document.getElementById('overlay-allegiance').textContent = isEvil ? 'Evil — Minions of Mordred' : 'Good — Loyal to Arthur';
  document.getElementById('overlay-allegiance').className = 'role-card-allegiance ' + (isEvil ? 'evil' : 'good');
  document.getElementById('overlay-role').textContent = role;
  document.getElementById('overlay-desc').textContent = ROLE_DESCRIPTIONS[role] || '';

  const knownEl = document.getElementById('overlay-known');
  if (known.length > 0) {
    knownEl.className = 'role-card-known visible';
    knownEl.innerHTML = '<strong style="color:#c9a96e;font-size:0.8rem;text-transform:uppercase;letter-spacing:1px;">You can see:</strong><br><br>' +
      known.map(k => `<div class="known-entry ${k.css}">${escHtml(k.name)} — ${k.label}</div>`).join('');
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

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
