const QUEST_SIZES = {
  5:  [2,3,2,3,3],
  6:  [2,3,4,3,4],
  7:  [2,3,3,4,4],
  8:  [3,4,4,5,5],
  9:  [3,4,4,5,5],
  10: [3,4,4,5,5]
};

const DOUBLE_FAIL_QUEST = 3; // 4th quest needs 2 fails for 7+ players

const EVIL_ROLES = new Set(['Assassin','Morgana','Mordred','Oberon','Minion of Mordred']);

const ROLE_DESCRIPTIONS = {
  'Merlin':           'You secretly know who the evil players are (except Mordred). Guide your team without revealing yourself — if Good wins, the Assassin will try to identify you.',
  'Percival':         'You know two players are Merlin or Morgana, but not which is which. Protect the real Merlin.',
  'Loyal Servant':    'You have no special knowledge. Use your instincts to find the traitors and vote wisely.',
  'Assassin':         'You are evil. Sabotage quests when you can. If Good wins all quests, you get one final chance to identify and assassinate Merlin.',
  'Morgana':          'You are evil. You appear as Merlin to Percival — use this to sow confusion and protect your allies.',
  'Mordred':          'You are evil, but Merlin cannot see you. Use this hidden advantage to stay under the radar.',
  'Oberon':           'You are evil, but you do not know your allies and they do not know you. Act alone.',
  'Minion of Mordred':'You are evil. Work with your allies to sabotage the quests and defeat the forces of Good.',
};

// Default evil counts per player count
const DEFAULT_EVIL = { 5:2, 6:2, 7:3, 8:3, 9:3, 10:4 };

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Setup state ──
let playerCount  = 0;
let evilCount    = 0;
let activeToggles = new Set(); // e.g. {'Percival','Morgana','Mordred'}
let playerNames  = [];

// ── Game state ──
let assignedRoles = [];
let questResults  = [];
let currentQuest  = 0;
let currentVotes  = [];
let votesNeeded   = 0;

// ── Screen switcher ──
const ALL_SCREENS = ['setup-screen','config-screen','names-screen','placard-screen','quest-screen','gameover-screen'];
function show(id) {
  ALL_SCREENS.forEach(s => {
    const el = document.getElementById(s);
    el.style.display = s === id ? (s === 'setup-screen' ? 'flex' : 'block') : 'none';
  });
}

// ═══════════════════════════════
// STEP 1 — player count
// ═══════════════════════════════
document.querySelectorAll('.count-btn').forEach(btn =>
  btn.addEventListener('click', () => {
    playerCount = parseInt(btn.dataset.count);
    evilCount   = DEFAULT_EVIL[playerCount];
    activeToggles.clear();
    show('config-screen');
    renderConfig();
  })
);

// ═══════════════════════════════
// STEP 2 — role configuration
// ═══════════════════════════════
function goodCount() { return playerCount - evilCount; }

function renderConfig() {
  document.getElementById('good-count').textContent = goodCount();
  document.getElementById('evil-count').textContent = evilCount;

  // Good specials available: Percival (1 slot beyond Merlin)
  const goodSpecialSlots = goodCount() - 1;
  // Evil specials available beyond Assassin
  const evilSpecialSlots = evilCount - 1;

  const goodToggles  = ['Percival'];
  const evilToggles  = ['Morgana','Mordred','Oberon'];

  // Count active toggles per side
  const activeGoodSpecials = goodToggles.filter(r => activeToggles.has(r)).length;
  const activeEvilSpecials = evilToggles.filter(r => activeToggles.has(r)).length;

  // Loyal fillers
  document.getElementById('loyal-filler-count').textContent = `× ${goodSpecialSlots - activeGoodSpecials}`;
  document.getElementById('minion-filler-count').textContent = `× ${evilSpecialSlots - activeEvilSpecials}`;

  // Render toggle buttons
  [...goodToggles, ...evilToggles].forEach(role => {
    const btn = document.querySelector(`#toggle-${role} .toggle-btn`);
    if (!btn) return;
    const on = activeToggles.has(role);
    const isGood = goodToggles.includes(role);
    const sideSlots = isGood ? goodSpecialSlots : evilSpecialSlots;
    const activeSide = isGood ? activeGoodSpecials : activeEvilSpecials;
    // Disable if turning on would exceed slots
    const wouldOverflow = !on && activeSide >= sideSlots;
    btn.textContent  = on ? 'On' : 'Off';
    btn.className    = 'toggle-btn ' + (on ? (isGood ? 'on-good' : 'on-evil') : 'off') + (wouldOverflow ? ' disabled' : '');
    btn.disabled     = wouldOverflow;
  });

  // +/− evil buttons
  document.getElementById('evil-minus').disabled = evilCount <= 1;
  document.getElementById('evil-plus').disabled  = evilCount >= playerCount - 2;
}

document.getElementById('evil-minus').addEventListener('click', () => {
  if (evilCount <= 1) return;
  evilCount--;
  // Drop any evil toggles that no longer fit
  const evilToggles = ['Morgana','Mordred','Oberon'];
  const evilSpecialSlots = evilCount - 1;
  let active = evilToggles.filter(r => activeToggles.has(r));
  while (active.length > evilSpecialSlots) activeToggles.delete(active.pop());
  renderConfig();
});

document.getElementById('evil-plus').addEventListener('click', () => {
  if (evilCount >= playerCount - 2) return;
  evilCount++;
  // Drop any good toggles that no longer fit
  const goodSpecialSlots = goodCount() - 1;
  const goodToggles = ['Percival'];
  let active = goodToggles.filter(r => activeToggles.has(r));
  while (active.length > goodSpecialSlots) activeToggles.delete(active.pop());
  renderConfig();
});

document.querySelectorAll('.toggle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    const role = btn.dataset.role;
    if (activeToggles.has(role)) activeToggles.delete(role);
    else activeToggles.add(role);
    renderConfig();
  });
});

document.getElementById('config-back-btn').addEventListener('click', () => show('setup-screen'));

document.getElementById('config-next-btn').addEventListener('click', () => {
  show('names-screen');
  renderNamesForm();
});

// ═══════════════════════════════
// STEP 3 — player names
// ═══════════════════════════════
function renderNamesForm() {
  const form = document.getElementById('names-form');
  form.innerHTML = '';
  for (let i = 0; i < playerCount; i++) {
    const row = document.createElement('div');
    row.className = 'name-row';
    row.innerHTML = `
      <label class="name-label">Player ${i + 1}</label>
      <input class="name-input" type="text" placeholder="Enter name" maxlength="20"
             value="${playerNames[i] || ''}" data-index="${i}">`;
    form.appendChild(row);
  }
  // Focus first empty
  setTimeout(() => {
    const first = form.querySelector('input');
    if (first) first.focus();
  }, 100);
}

document.getElementById('names-back-btn').addEventListener('click', () => {
  // Save any entered names
  document.querySelectorAll('.name-input').forEach(inp => {
    playerNames[parseInt(inp.dataset.index)] = inp.value.trim();
  });
  show('config-screen');
});

document.getElementById('names-next-btn').addEventListener('click', () => {
  const inputs = document.querySelectorAll('.name-input');
  playerNames = [];
  inputs.forEach((inp, i) => {
    playerNames.push(inp.value.trim() || `Player ${i + 1}`);
  });
  startGame();
});

// ═══════════════════════════════
// GAME — role dealing & placards
// ═══════════════════════════════
function buildRoleList() {
  const goodToggles = ['Percival'];
  const evilToggles = ['Morgana','Mordred','Oberon'];

  const goodSpecials = goodToggles.filter(r => activeToggles.has(r));
  const evilSpecials = evilToggles.filter(r => activeToggles.has(r));

  const loyalCount  = goodCount() - 1 - goodSpecials.length;
  const minionCount = evilCount  - 1 - evilSpecials.length;

  return [
    'Merlin',
    ...goodSpecials,
    ...Array(loyalCount).fill('Loyal Servant'),
    'Assassin',
    ...evilSpecials,
    ...Array(minionCount).fill('Minion of Mordred'),
  ];
}

function dealRoles(roleList) {
  const roles   = shuffle(roleList);
  const isEvil  = roles.map(r => EVIL_ROLES.has(r));
  const isMordred = roles.map(r => r === 'Mordred');
  const isMorgana = roles.map(r => r === 'Morgana');
  const isMerlin  = roles.map(r => r === 'Merlin');
  const isOberon  = roles.map(r => r === 'Oberon');

  assignedRoles = roles.map((role, i) => {
    const known = [];
    if (role === 'Merlin') {
      roles.forEach((_, j) => { if (i !== j && isEvil[j] && !isMordred[j]) known.push({ index: j, label: 'evil', css: 'known-evil' }); });
    } else if (role === 'Percival') {
      roles.forEach((_, j) => { if (i !== j && (isMerlin[j] || isMorgana[j])) known.push({ index: j, label: 'Merlin or Morgana?', css: 'known-merlin' }); });
    } else if (isEvil[i] && !isOberon[i]) {
      roles.forEach((_, j) => { if (i !== j && isEvil[j] && !isOberon[j]) known.push({ index: j, label: 'evil ally', css: 'known-evil' }); });
    }
    return { role, isEvil: isEvil[i], known };
  });
}

function startGame() {
  questResults = [];
  currentQuest = 0;
  const roleList = buildRoleList();
  dealRoles(roleList);
  show('placard-screen');

  const grid = document.getElementById('placards-grid');
  grid.innerHTML = '';
  document.getElementById('begin-quests-wrap').style.display = 'none';

  for (let i = 0; i < playerCount; i++) {
    const card = document.createElement('div');
    card.className = 'placard';
    card.dataset.index = i;
    card.innerHTML = `
      <div class="placard-inner">
        <div class="placard-front">
          <div class="placard-crest">${i % 2 === 0 ? '⚜️' : '🏰'}</div>
          <div class="placard-label">${escHtml(playerNames[i])}</div>
          <div class="placard-tap-hint">Tap to reveal</div>
          <div class="placard-seen-badge">✓ seen</div>
        </div>
      </div>`;
    card.addEventListener('click', () => showRole(i));
    grid.appendChild(card);
  }
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function checkAllSeen() {
  const total = document.querySelectorAll('.placard').length;
  const seen  = document.querySelectorAll('.placard.seen').length;
  if (seen === total) document.getElementById('begin-quests-wrap').style.display = 'flex';
}

// ── Role overlay ──
function showRole(index) {
  const { role, isEvil, known } = assignedRoles[index];
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
      known.map(k => `<div class="known-entry ${k.css}">${escHtml(playerNames[k.index])} — ${k.label}</div>`).join('');
  } else {
    knownEl.className = 'role-card-known';
    knownEl.innerHTML = '';
  }

  document.getElementById('role-overlay').style.display = 'flex';
  document.getElementById('close-overlay-btn').onclick = () => {
    document.getElementById('role-overlay').style.display = 'none';
    const placard = document.querySelector(`.placard[data-index="${index}"]`);
    if (placard) { placard.classList.add('seen'); checkAllSeen(); }
  };
}

// ═══════════════════════════════
// QUEST PHASE
// ═══════════════════════════════
function beginQuests() {
  show('quest-screen');
  renderQuestScreen();
}

function renderQuestScreen() {
  renderQuestTrack(document.getElementById('quest-track'));

  const size = QUEST_SIZES[playerCount][currentQuest];
  const needsDouble = playerCount >= 7 && currentQuest === DOUBLE_FAIL_QUEST;

  document.getElementById('quest-label').textContent = `Quest ${currentQuest + 1} of 5`;
  document.getElementById('quest-team-size-label').innerHTML =
    `<span>${size} players go on this quest</span>` +
    (needsDouble ? `<span class="double-fail-note"> · requires 2 fails to fail</span>` : '');

  currentVotes = [];
  votesNeeded  = size;
  const slots  = document.getElementById('vote-slots');
  slots.innerHTML = '';
  for (let i = 0; i < size; i++) {
    const slot = document.createElement('div');
    slot.className = 'vote-slot';
    slot.dataset.slot = i;
    slot.innerHTML = `<span class="slot-num">${i + 1}</span><span class="slot-hint">Tap to vote</span>`;
    slot.addEventListener('click', () => openVoteOverlay(i));
    slots.appendChild(slot);
  }
}

function renderQuestTrack(container) {
  container.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const dot = document.createElement('div');
    const result = questResults[i];
    dot.className = 'quest-dot' + (result === 'pass' ? ' pass' : result === 'fail' ? ' fail' : i === currentQuest ? ' current' : '');
    const size = QUEST_SIZES[playerCount][i];
    dot.innerHTML = result === 'pass' ? '✔' : result === 'fail' ? '✘' : `<span>${size}</span>`;
    container.appendChild(dot);
  }
}

function openVoteOverlay(slotIndex) {
  const slot = document.querySelector(`.vote-slot[data-slot="${slotIndex}"]`);
  if (slot.classList.contains('voted')) return;

  document.getElementById('vote-overlay').style.display = 'flex';

  const close = (vote) => {
    document.getElementById('vote-overlay').style.display = 'none';
    currentVotes.push(vote);
    slot.classList.add('voted');
    slot.innerHTML = `<span class="slot-vote submitted">✓</span>`;
    if (currentVotes.length === votesNeeded) setTimeout(() => resolveQuest(), 400);
  };

  document.getElementById('vote-pass-btn').onclick = () => close('pass');
  document.getElementById('vote-fail-btn').onclick = () => close('fail');
}

function resolveQuest() {
  const fails = currentVotes.filter(v => v === 'fail').length;
  const needsDouble = playerCount >= 7 && currentQuest === DOUBLE_FAIL_QUEST;
  const failed = needsDouble ? fails >= 2 : fails >= 1;
  const result = failed ? 'fail' : 'pass';
  questResults.push(result);

  const passes   = questResults.filter(r => r === 'pass').length;
  const failures = questResults.filter(r => r === 'fail').length;

  document.getElementById('result-icon').textContent  = failed ? '💀' : '⚔️';
  document.getElementById('result-title').textContent = failed ? 'Quest Failed' : 'Quest Succeeded';
  document.getElementById('result-title').className   = 'result-title ' + result;
  document.getElementById('result-detail').textContent =
    fails === 0 ? 'No fails — the quest succeeds!' :
    fails === 1 ? '1 fail card was played.' : `${fails} fail cards were played.`;

  document.getElementById('result-overlay').style.display = 'flex';
  document.getElementById('result-continue-btn').onclick = () => {
    document.getElementById('result-overlay').style.display = 'none';
    if (passes >= 3 || failures >= 3) {
      showGameOver(passes >= 3 ? 'good' : 'evil');
    } else {
      currentQuest++;
      renderQuestScreen();
    }
  };
}

function showGameOver(winner) {
  show('gameover-screen');
  document.getElementById('gameover-icon').textContent  = winner === 'good' ? '⚔️' : '💀';
  document.getElementById('gameover-title').textContent = winner === 'good' ? 'Good Wins!' : 'Evil Wins!';
  document.getElementById('gameover-title').className   = 'gameover-title ' + winner;
  document.getElementById('gameover-subtitle').textContent =
    winner === 'good' ? 'The loyal servants of Arthur have completed their quests.'
                      : 'The Minions of Mordred have sabotaged the realm.';

  const track = document.getElementById('gameover-track');
  track.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const r = questResults[i];
    const dot = document.createElement('div');
    dot.className = 'quest-dot ' + (r === 'pass' ? 'pass' : r === 'fail' ? 'fail' : 'empty');
    dot.textContent = r === 'pass' ? '✔' : r === 'fail' ? '✘' : '·';
    track.appendChild(dot);
  }
}

// ── Nav ──
document.getElementById('restart-btn').addEventListener('click', () => show('setup-screen'));
document.getElementById('quest-restart-btn').addEventListener('click', () => show('setup-screen'));
document.getElementById('gameover-restart-btn').addEventListener('click', () => show('setup-screen'));
document.getElementById('begin-quests-btn').addEventListener('click', beginQuests);
