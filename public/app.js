const ROLES_BY_COUNT = {
  5:  ['Merlin','Percival','Loyal Servant','Assassin','Morgana'],
  6:  ['Merlin','Percival','Loyal Servant','Loyal Servant','Assassin','Morgana'],
  7:  ['Merlin','Percival','Loyal Servant','Loyal Servant','Assassin','Morgana','Mordred'],
  8:  ['Merlin','Percival','Loyal Servant','Loyal Servant','Loyal Servant','Assassin','Morgana','Mordred'],
  9:  ['Merlin','Percival','Loyal Servant','Loyal Servant','Loyal Servant','Loyal Servant','Assassin','Morgana','Mordred'],
  10: ['Merlin','Percival','Loyal Servant','Loyal Servant','Loyal Servant','Loyal Servant','Assassin','Morgana','Mordred','Oberon']
};

const QUEST_SIZES = {
  5:  [2,3,2,3,3],
  6:  [2,3,4,3,4],
  7:  [2,3,3,4,4],
  8:  [3,4,4,5,5],
  9:  [3,4,4,5,5],
  10: [3,4,4,5,5]
};

// Quest index 3 (4th quest) requires 2 fails for 7+ players
const DOUBLE_FAIL_QUEST = 3;

const EVIL_ROLES = new Set(['Assassin','Morgana','Mordred','Oberon']);

const ROLE_DESCRIPTIONS = {
  'Merlin':        'You secretly know who the evil players are (except Mordred). Guide your team without revealing yourself — if Good wins, the Assassin will try to identify you.',
  'Percival':      'You know two players are Merlin or Morgana, but not which is which. Protect the real Merlin.',
  'Loyal Servant': 'You have no special knowledge. Use your instincts to find the traitors and vote wisely.',
  'Assassin':      'You are evil. Sabotage quests when you can. If Good wins all quests, you get one final chance to identify and assassinate Merlin.',
  'Morgana':       'You are evil. You appear as Merlin to Percival — use this to sow confusion and protect your allies.',
  'Mordred':       'You are evil, but Merlin cannot see you. Use this hidden advantage to stay under the radar.',
  'Oberon':        'You are evil, but you do not know your allies and they do not know you. Act alone.',
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── State ──
let assignedRoles = [];
let playerCount = 0;
let questResults = []; // 'pass' | 'fail' per quest
let currentQuest = 0;
let currentVotes = [];  // 'pass' | 'fail' per slot submitted so far
let votesNeeded = 0;

// ── Role dealing ──
function dealRoles(n) {
  const roles = shuffle(ROLES_BY_COUNT[n]);
  const isEvil = roles.map(r => EVIL_ROLES.has(r));
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

// ── Screens ──
function show(id) {
  ['setup-screen','placard-screen','quest-screen','gameover-screen'].forEach(s => {
    document.getElementById(s).style.display = s === id ? (s === 'setup-screen' ? 'flex' : 'block') : 'none';
  });
}

function startGame(n) {
  playerCount = n;
  questResults = [];
  currentQuest = 0;
  dealRoles(n);
  show('placard-screen');

  const grid = document.getElementById('placards-grid');
  grid.innerHTML = '';
  document.getElementById('begin-quests-wrap').style.display = 'none';

  for (let i = 0; i < n; i++) {
    const card = document.createElement('div');
    card.className = 'placard';
    card.dataset.index = i;
    card.innerHTML = `
      <div class="placard-inner">
        <div class="placard-front">
          <div class="placard-crest">${i % 2 === 0 ? '⚜️' : '🏰'}</div>
          <div class="placard-label">Player ${i + 1}</div>
          <div class="placard-tap-hint">Tap to reveal</div>
          <div class="placard-seen-badge">✓ seen</div>
        </div>
      </div>`;
    card.addEventListener('click', () => showRole(i));
    grid.appendChild(card);
  }
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
      known.map(k => `<div class="known-entry ${k.css}">Player ${k.index + 1} — ${k.label}</div>`).join('');
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

// ── Quest screen ──
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

  // Build vote slots
  currentVotes = [];
  votesNeeded = size;
  const slots = document.getElementById('vote-slots');
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
    dot.className = 'quest-dot' +
      (result === 'pass' ? ' pass' : result === 'fail' ? ' fail' : i === currentQuest ? ' current' : '');
    const size = QUEST_SIZES[playerCount] ? QUEST_SIZES[playerCount][i] : '?';
    dot.innerHTML = result === 'pass' ? '✔' : result === 'fail' ? '✘' : `<span>${size}</span>`;
    dot.title = `Quest ${i+1} (${size} players)`;
    container.appendChild(dot);
  }
}

// ── Vote overlay ──
function openVoteOverlay(slotIndex) {
  const slot = document.querySelector(`.vote-slot[data-slot="${slotIndex}"]`);
  if (slot.classList.contains('voted')) return;

  document.getElementById('vote-overlay').style.display = 'flex';

  const close = (vote) => {
    document.getElementById('vote-overlay').style.display = 'none';
    currentVotes.push(vote);
    slot.classList.add('voted');
    slot.innerHTML = `<span class="slot-vote submitted">✓</span>`;

    if (currentVotes.length === votesNeeded) {
      setTimeout(() => resolveQuest(), 400);
    }
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

  // Show quest result
  const overlay = document.getElementById('result-overlay');
  document.getElementById('result-icon').textContent  = failed ? '💀' : '⚔️';
  document.getElementById('result-title').textContent = failed ? 'Quest Failed' : 'Quest Succeeded';
  document.getElementById('result-title').className   = 'result-title ' + result;
  document.getElementById('result-detail').textContent =
    fails === 0 ? 'No fails — the quest succeeds!' :
    fails === 1 ? '1 fail card was played.' :
    `${fails} fail cards were played.`;

  overlay.style.display = 'flex';
  document.getElementById('result-continue-btn').onclick = () => {
    overlay.style.display = 'none';
    if (passes >= 3 || failures >= 3) {
      showGameOver(passes >= 3 ? 'good' : 'evil');
    } else {
      currentQuest++;
      renderQuestScreen();
    }
  };
}

// ── Game over ──
function showGameOver(winner) {
  show('gameover-screen');
  document.getElementById('gameover-icon').textContent  = winner === 'good' ? '⚔️' : '💀';
  document.getElementById('gameover-title').textContent = winner === 'good' ? 'Good Wins!' : 'Evil Wins!';
  document.getElementById('gameover-title').className   = 'gameover-title ' + winner;
  document.getElementById('gameover-subtitle').textContent =
    winner === 'good'
      ? 'The loyal servants of Arthur have completed their quests.'
      : 'The Minions of Mordred have sabotaged the realm.';

  const track = document.getElementById('gameover-track');
  track.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const dot = document.createElement('div');
    const r = questResults[i];
    dot.className = 'quest-dot ' + (r === 'pass' ? 'pass' : r === 'fail' ? 'fail' : 'empty');
    dot.textContent = r === 'pass' ? '✔' : r === 'fail' ? '✘' : '·';
    track.appendChild(dot);
  }
}

// ── Wiring ──
document.querySelectorAll('.count-btn').forEach(btn =>
  btn.addEventListener('click', () => startGame(parseInt(btn.dataset.count)))
);
document.getElementById('restart-btn').addEventListener('click', () => show('setup-screen'));
document.getElementById('quest-restart-btn').addEventListener('click', () => show('setup-screen'));
document.getElementById('gameover-restart-btn').addEventListener('click', () => show('setup-screen'));
document.getElementById('begin-quests-btn').addEventListener('click', beginQuests);
