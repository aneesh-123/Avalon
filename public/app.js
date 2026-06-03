const ROLES_BY_COUNT = {
  5:  ['Merlin','Percival','Loyal Servant','Assassin','Morgana'],
  6:  ['Merlin','Percival','Loyal Servant','Loyal Servant','Assassin','Morgana'],
  7:  ['Merlin','Percival','Loyal Servant','Loyal Servant','Assassin','Morgana','Mordred'],
  8:  ['Merlin','Percival','Loyal Servant','Loyal Servant','Loyal Servant','Assassin','Morgana','Mordred'],
  9:  ['Merlin','Percival','Loyal Servant','Loyal Servant','Loyal Servant','Loyal Servant','Assassin','Morgana','Mordred'],
  10: ['Merlin','Percival','Loyal Servant','Loyal Servant','Loyal Servant','Loyal Servant','Assassin','Morgana','Mordred','Oberon']
};

const EVIL_ROLES = new Set(['Assassin','Morgana','Mordred','Oberon']);

const ROLE_DESCRIPTIONS = {
  'Merlin':        'You secretly know who the evil players are (except Mordred). Guide your team to victory without revealing yourself — if Good wins, the Assassin will try to identify you.',
  'Percival':      'You know two players are Merlin or Morgana, but not which is which. Protect the real Merlin.',
  'Loyal Servant': 'You have no special knowledge. Use your instincts to find the traitors and vote wisely.',
  'Assassin':      'You are evil. Sabotage quests when you can. If Good wins all quests, you get one final chance to identify and assassinate Merlin.',
  'Morgana':       'You are evil. You appear as Merlin to Percival — use this to sow confusion and protect your allies.',
  'Mordred':       'You are evil, but Merlin cannot see you. Use this hidden advantage to stay under the radar.',
  'Oberon':        'You are evil, but you do not know your allies and they do not know you. Act alone.',
};

const CREST = {
  good: '⚔️',
  evil: '💀',
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// assigned roles for this game: [{ role, isEvil, knownPlayers: [{index, label}] }]
let assignedRoles = [];
let playerCount = 0;

function dealRoles(n) {
  const roles = shuffle(ROLES_BY_COUNT[n]);

  // Build knowledge map
  const isEvil = roles.map(r => EVIL_ROLES.has(r));
  const isMordred = roles.map(r => r === 'Mordred');
  const isMorgan = roles.map(r => r === 'Morgana');
  const isMerlin = roles.map(r => r === 'Merlin');
  const isOberon = roles.map(r => r === 'Oberon');

  assignedRoles = roles.map((role, i) => {
    const known = [];

    if (role === 'Merlin') {
      // Sees all evil except Mordred
      roles.forEach((r, j) => {
        if (i !== j && isEvil[j] && !isMordred[j]) known.push({ index: j, label: 'evil', css: 'known-evil' });
      });
    } else if (role === 'Percival') {
      // Sees Merlin and Morgana but not which is which
      roles.forEach((r, j) => {
        if (i !== j && (isMerlin[j] || isMorgan[j])) known.push({ index: j, label: 'Merlin or Morgana?', css: 'known-merlin' });
      });
    } else if (isEvil[i] && !isOberon[i]) {
      // Evil sees other evil except Oberon
      roles.forEach((r, j) => {
        if (i !== j && isEvil[j] && !isOberon[j]) known.push({ index: j, label: 'evil ally', css: 'known-evil' });
      });
    }

    return { role, isEvil: isEvil[i], known };
  });
}

function startGame(n) {
  playerCount = n;
  dealRoles(n);

  document.getElementById('setup-screen').style.display = 'none';
  const screen = document.getElementById('placard-screen');
  screen.style.display = 'block';

  const grid = document.getElementById('placards-grid');
  grid.innerHTML = '';

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
      </div>
    `;
    card.addEventListener('click', () => showRole(i));
    grid.appendChild(card);
  }
}

function showRole(index) {
  const { role, isEvil, known } = assignedRoles[index];
  const overlay = document.getElementById('role-overlay');
  const card = document.getElementById('role-card');

  // Set card style
  card.className = isEvil ? 'evil' : 'good';

  document.getElementById('overlay-allegiance').textContent = isEvil ? 'Evil — Minions of Mordred' : 'Good — Loyal to Arthur';
  document.getElementById('overlay-allegiance').className = 'role-card-allegiance ' + (isEvil ? 'evil' : 'good');
  document.getElementById('overlay-role').textContent = role;
  document.getElementById('overlay-desc').textContent = ROLE_DESCRIPTIONS[role] || '';

  const knownEl = document.getElementById('overlay-known');
  if (known.length > 0) {
    knownEl.className = 'role-card-known visible';
    knownEl.innerHTML = '<strong style="color:#c9a96e; font-size:0.8rem; text-transform:uppercase; letter-spacing:1px;">You can see:</strong><br><br>' +
      known.map(k => `<div class="known-entry ${k.css}">Player ${k.index + 1} — ${k.label}</div>`).join('');
  } else {
    knownEl.className = 'role-card-known';
    knownEl.innerHTML = '';
  }

  overlay.style.display = 'flex';

  document.getElementById('close-overlay-btn').onclick = () => {
    overlay.style.display = 'none';
    // Mark placard as seen
    const placard = document.querySelector(`.placard[data-index="${index}"]`);
    if (placard) placard.classList.add('seen');
  };
}

// Setup buttons
document.querySelectorAll('.count-btn').forEach(btn => {
  btn.addEventListener('click', () => startGame(parseInt(btn.dataset.count)));
});

document.getElementById('restart-btn').addEventListener('click', () => {
  document.getElementById('placard-screen').style.display = 'none';
  document.getElementById('setup-screen').style.display = 'flex';
});
