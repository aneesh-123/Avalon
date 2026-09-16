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
  'Cleric':           'Learns whether the very first quest leader is Good or Evil. One solid fact to build the whole game on.',
  'Untrustworthy Servant':'Good, and reads as Good — but the Assassin knows you, and may hand you the final shot at Merlin. Name him and you win with Evil.',
  'Lunatic':          'Evil, and compelled. You MUST fail every quest you go on — you cannot pass, even to stay hidden.',
  'Brute':            'Evil, but you may only sabotage the first three quests. After that you are forced to pass.',
  'Trickster':        'Evil. The Lady of the Lake always reads you as Good — invisible to the one tool that cannot normally be fooled.',
  'Revealer':         'Evil. Once three quests are done, you are publicly revealed to the whole table as Evil.',
};

// One-line versions for the "your setup" summary strip, where the full
// descriptions would be a wall of text.
const ROLE_ONELINE = {
  'Percival':         'sees Merlin & Morgana, can’t tell which',
  'Cleric':           'learns if the first leader is good or evil',
  'Untrustworthy Servant':'good, but may be handed the kill',
  'Morgana':          'looks like Merlin to Percival',
  'Mordred':          'invisible to Merlin',
  'Oberon':           'evil, but alone — no allies either way',
  'Lunatic':          'must fail every quest they’re on',
  'Brute':            'can only fail quests 1–3',
  'Trickster':        'the Lady always reads them as good',
  'Revealer':         'outed to everyone after quest 3',
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
  'Cleric':           { emoji:'⛪', bg:'linear-gradient(135deg,#004d40,#00695c)', glow:'#4db6ac' },
  'Untrustworthy Servant':{ emoji:'🪞', bg:'linear-gradient(135deg,#33691e,#558b2f)', glow:'#9ccc65' },
  'Lunatic':          { emoji:'🎭', bg:'linear-gradient(135deg,#4a148c,#880e4f)', glow:'#f06292' },
  'Brute':            { emoji:'🪓', bg:'linear-gradient(135deg,#3e2723,#5d4037)', glow:'#ff8a65' },
  'Trickster':        { emoji:'🃏', bg:'linear-gradient(135deg,#1a237e,#4a148c)', glow:'#9575cd' },
  'Revealer':         { emoji:'🔥', bg:'linear-gradient(135deg,#bf360c,#e65100)', glow:'#ffab40' },
};

const EVIL_ROLES_CLIENT = new Set(['Assassin','Morgana','Mordred','Oberon','Minion of Mordred']);
const DEFAULT_EVIL = { 5:2, 6:2, 7:3, 8:3, 9:3, 10:4 };
const DEFAULT_TEAM_SIZES = {
  5:[2,3,2,3,3], 6:[2,3,4,3,4], 7:[2,3,3,4,4],
  8:[3,4,4,5,5], 9:[3,4,4,5,5], 10:[3,4,4,5,5],
};

// For n > 10: evil = floor(n/3), team sizes scale proportionally across 5 quests
function defaultEvilCount(n) {
  return DEFAULT_EVIL[n] ?? Math.floor(n / 3);
}
function defaultTeamSizes(n) {
  if (DEFAULT_TEAM_SIZES[n]) return DEFAULT_TEAM_SIZES[n];
  // Scale: quests need roughly 30–60% of players; grow across 5 quests
  const base = Math.max(2, Math.round(n * 0.3));
  return [base, base+1, base+1, base+2, base+2];
}

function roleImagePath(role, ext) {
  return '/images/roles/' + role.toLowerCase().replace(/ /g, '-') + '.' + (ext || 'png');
}

function roleArt(role, size = 'large') {
  const a = ROLE_ART[role] || { emoji: '⚜️', bg: 'linear-gradient(135deg,#1a1a2e,#16213e)', glow: '#c9a96e' };
  const dim = size === 'large' ? '90px' : '44px';
  const fs  = size === 'large' ? '2.6rem' : '1.3rem';
  const pngPath = roleImagePath(role, 'png');
  const jpgPath = roleImagePath(role, 'jpg');
  return `<div class="role-art-circle" style="width:${dim};height:${dim};background:${a.bg};box-shadow:0 0 20px ${a.glow}55;">
    <img src="${pngPath}" alt="${role}" class="role-art-img"
      onerror="this.src='${jpgPath}';this.onerror=function(){this.style.display='none';this.nextElementSibling.style.display='flex'}"
      style="width:100%;height:100%;object-fit:cover;border-radius:50%;">
    <span class="role-art-emoji" style="display:none;font-size:${fs}">${a.emoji}</span>
  </div>`;
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── Session ──
function saveSession(d) { localStorage.setItem('avalon-session', JSON.stringify(d)); }
function loadSession()  { try { return JSON.parse(localStorage.getItem('avalon-session')); } catch { return null; } }
function clearSession() { localStorage.removeItem('avalon-session'); }

// Stable identity token — survives tab close, refresh, network changes
function getPlayerToken() {
  let t = localStorage.getItem('avalon-token');
  if (!t) {
    t = 'pt-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    localStorage.setItem('avalon-token', t);
  }
  return t;
}
const playerToken = getPlayerToken();

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

// ── Connection health ──
//
// Socket.IO reconnects under a NEW socket id. Until the server re-maps that id
// onto this player, every action lands on a socket it can't resolve and is
// dropped without a word — which is exactly why buttons "stop working" until
// someone refreshes. Three things fix it: re-register on every connect (not
// just the first), force a state resync afterwards, and make the gap visible
// instead of mysterious.

function setConnectionBanner(show) {
  let el = document.getElementById('conn-banner');
  if (!show) { el?.remove(); return; }
  if (el) return;
  el = document.createElement('div');
  el.id = 'conn-banner';
  el.textContent = 'Reconnecting…';
  document.body.appendChild(el);
}

function reregister() {
  const s = loadSession();
  if (s?.name && s?.code) {
    myName = s.name; myRoomCode = s.code;
    if (s.role) myRole = s.role;
    socket.emit('rejoin-room', { code: s.code, name: s.name, token: playerToken });
  }
  // Belt and braces: if the room didn't need a rejoin, this still pulls a fresh
  // state down so the UI can't sit on a stale render.
  socket.emit('request-sync');
}

socket.on('connect', () => {
  myId = socket.id;
  setConnectionBanner(false);
  reregister();
  _connectedOnce = true;
});

socket.on('disconnect', () => setConnectionBanner(true));

// The server saw an action from a socket it couldn't place. Re-register rather
// than leaving the player poking at dead buttons.
socket.on('desync', () => reregister());


// ── Screens ──
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
  window.scrollTo(0, 0);
}

// ── Invite deep link ──
// A shared link looks like <origin>/?room=ABC12 — land the guest straight on
// the join screen with the code already filled so all they type is a name.
// The optional `game` param lets Imposter reuse the scheme; absent means Avalon.
const inviteCode = (() => {
  const p = new URLSearchParams(location.search);
  if ((p.get('game') || 'avalon').toLowerCase() !== 'avalon') return '';
  const c = (p.get('room') || '').trim().toUpperCase();
  return /^[A-Z0-9]{5}$/.test(c) ? c : '';
})();

if (inviteCode) {
  // Following a fresh invite beats resuming an older room — without this the
  // auto-rejoin on connect would yank the guest back to where they last were.
  const prev = loadSession();
  if (prev?.code && prev.code !== inviteCode) clearSession();
  document.getElementById('join-code-input').value = inviteCode;
  showScreen('join');
  setTimeout(() => document.getElementById('join-name-input').focus(), 50);
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
  socket.emit('rejoin-room', { code: s.code, name: s.name, token: playerToken });
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
document.querySelectorAll('.back-btn').forEach(btn => btn.addEventListener('click', () => {
  const target = btn.dataset.back;
  if (btn.id === 'create-back-btn') closeSetupEditor();
  showScreen(target);
}));

function revealSection(n) {
  const el = document.getElementById(`create-section-${n}`);
  el.style.display = '';
  setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}

// ── Home ──
document.getElementById('btn-create').addEventListener('click', () => {
  activeToggles.clear();
  setPlayerCount(5);
  for (let i = 2; i <= 4; i++) document.getElementById(`create-section-${i}`).style.display = 'none';
  showScreen('create');
});
document.getElementById('btn-join-screen').addEventListener('click', () => { document.getElementById('join-error').textContent = ''; showScreen('join'); });

// ── Step 1: player count ──
function setPlayerCount(n) {
  playerCount = n;
  document.getElementById('pc-value').textContent = n;
  refreshQuickStartNote();
  document.getElementById('pc-minus').disabled = n <= 5;
  // Keep downstream sections in sync if already visible
  if (document.getElementById('create-section-2')?.style.display !== 'none') {
    evilCount = Math.min(evilCount, playerCount - 2);
    evilCount = Math.max(evilCount, 1);
    trimSpecialsToFit();
    renderSplitStep();
  }
  if (document.getElementById('create-section-3')?.style.display !== 'none') {
    renderRoleLists();
  }
}
document.getElementById('pc-minus').addEventListener('click', () => { if (playerCount > 5) setPlayerCount(playerCount - 1); });
document.getElementById('pc-plus').addEventListener('click',  () => setPlayerCount(playerCount + 1));
document.getElementById('pc-confirm-btn').addEventListener('click', () => {
  evilCount = defaultEvilCount(playerCount);
  renderSplitStep();
  revealSection(2);
});

// ── Quick start ──
// The evil count and quest table were always computed for you — the wizard just
// made you click "Continue" past four screens of correct defaults. This accepts
// them in one tap and drops you at the name field. Roles are the one thing with
// no sensible default, so pick the pairing most tables actually play.
function recommendedRoles(n) {
  const roles = ['Percival', 'Morgana'];        // the classic pairing
  if (n >= 7) roles.push('Mordred');            // evil needs more cover at 7+
  return roles;
}

function quickStartSummary(n) {
  const evil = defaultEvilCount(n);
  const sizes = defaultTeamSizes(n);
  const twoFail = n >= 7 ? ' · quest 4 needs 2 fails' : '';
  return `${n - evil} good vs ${evil} evil · ${recommendedRoles(n).join(', ')} · teams ${sizes.join('-')}${twoFail}`;
}

function refreshQuickStartNote() {
  const el = document.getElementById('quick-start-note');
  if (el) el.textContent = quickStartSummary(playerCount);
}

document.getElementById('quick-start-btn').addEventListener('click', () => {
  evilCount = defaultEvilCount(playerCount);
  activeToggles.clear();
  recommendedRoles(playerCount).forEach(r => activeToggles.add(r));
  trimSpecialsToFit();
  renderSplitStep();
  renderRoleLists();
  initCampaigns();
  // Show every section so the choices stay editable, then jump to the end.
  for (let i = 2; i <= 4; i++) document.getElementById(`create-section-${i}`).style.display = '';
  setTimeout(() => document.getElementById('create-section-4')
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
});

// ── Step 2: Good vs Evil split ──
function goodCount() { return playerCount - evilCount; }

function renderSplitStep() {
  document.getElementById('good-count').textContent = goodCount();
  document.getElementById('evil-count').textContent = evilCount;
  document.getElementById('evil-minus').disabled = evilCount <= 1;
  document.getElementById('evil-plus').disabled  = evilCount >= playerCount - 2;
}

document.getElementById('evil-minus').addEventListener('click', () => {
  if (evilCount <= 1) return; evilCount--;
  trimSpecialsToFit();
  renderSplitStep();
  if (document.getElementById('create-section-3')?.style.display !== 'none') renderRoleLists();
});
document.getElementById('evil-plus').addEventListener('click', () => {
  if (evilCount >= playerCount - 2) return; evilCount++;
  trimSpecialsToFit();
  renderSplitStep();
  if (document.getElementById('create-section-3')?.style.display !== 'none') renderRoleLists();
});
document.getElementById('split-confirm-btn').addEventListener('click', () => {
  renderRoleLists();
  revealSection(3);
});

// ── Step 3: Role picker ──
// The roles that ship with painted portraits; anything else uses its emoji
// tile instead of requesting an image that isn't there. Add a role here when
// you add its file — see public/images/roles/README.md.
const ROLES_WITH_ART = new Set([
  'Merlin', 'Percival', 'Loyal Servant', 'Assassin',
  'Morgana', 'Mordred', 'Oberon', 'Minion of Mordred',
  'Cleric', 'Untrustworthy Servant', 'Lunatic', 'Brute', 'Trickster', 'Revealer',
]);

const GOOD_SPECIALS = ['Percival', 'Cleric', 'Untrustworthy Servant'];
const EVIL_SPECIALS = ['Morgana', 'Mordred', 'Oberon', 'Lunatic', 'Brute', 'Trickster', 'Revealer'];
const ROLE_EMOJI = { Merlin:'🔵', Percival:'🛡', 'Loyal Servant':'⚔', Assassin:'🗡', Morgana:'🔮', Mordred:'💀', Oberon:'👁', 'Minion of Mordred':'🌑' };

function trimSpecialsToFit() {
  const activeEvil = EVIL_SPECIALS.filter(r => activeToggles.has(r));
  activeEvil.slice(evilCount - 1).forEach(r => activeToggles.delete(r));
  if (activeToggles.has('Percival') && goodCount() < 2) activeToggles.delete('Percival');
}

function renderRoleLists() {
  const activeGood = GOOD_SPECIALS.filter(r => activeToggles.has(r));
  const activeEvil = EVIL_SPECIALS.filter(r => activeToggles.has(r));
  const goodFillers = goodCount() - 1 - activeGood.length;
  const evilFillers = evilCount - 1 - activeEvil.length;

  // Build the full ordered slot list for each side
  const goodSlots = [
    { role: 'Merlin',        state: 'locked' },
    ...GOOD_SPECIALS.map(r => ({ role: r, state: activeToggles.has(r) ? 'active' : 'available',
        canAdd: goodCount() - 1 > activeGood.length })),
    ...Array(goodFillers).fill(null).map(() => ({ role: 'Loyal Servant', state: 'filler' })),
  ];
  const evilSlots = [
    { role: 'Assassin',      state: 'locked' },
    ...EVIL_SPECIALS.map(r => ({ role: r, state: activeToggles.has(r) ? 'active' : 'available',
        canAdd: evilCount - 1 > activeEvil.length })),
    ...Array(evilFillers).fill(null).map(() => ({ role: 'Minion of Mordred', state: 'filler' })),
  ];

  // Every circle carries its description, but nothing shows it until you ask.
  // On desktop that's hover; on touch it's the ⓘ, which is a separate target so
  // reading about a role never toggles it by accident.
  function makeCircle({ role, state, canAdd }) {
    const png = roleImagePath(role, 'png');
    const jpg = roleImagePath(role, 'jpg');
    const dimmed = state === 'available';
    const badge = state === 'available' ? `<span class="rc2-badge add" ${canAdd ? '' : 'style="opacity:0.3"'}>+</span>`
                :                        `<span class="rc2-badge active">✓</span>`;
    const desc = esc(ROLE_DESCRIPTIONS[role] || '');
    const art  = ROLE_ART[role] || {};
    // Only the original eight have painted portraits. Rather than request a
    // missing file and hide the broken image, roles without art get an emoji
    // tile — same shape, no 404s, and they don't look half-finished.
    const face = ROLES_WITH_ART.has(role)
      ? `<img src="${png}" alt="${role}"
           onerror="this.src='${jpg}';this.onerror=function(){this.style.display='none'}">`
      : `<span class="rc2-emoji" style="background:${art.bg || '#1a1a2e'}">${art.emoji || '?'}</span>`;
    return `<div class="rc2-circle ${state}" data-role="${role}" data-state="${state}" data-canadd="${canAdd}" data-desc="${desc}">
      <button class="rc2-info" data-info="${role}" aria-label="What does ${role} do?">i</button>
      <div class="rc2-face">
        <div class="rc2-portrait ${dimmed ? 'dimmed' : ''}">${face}</div>
        ${badge}
      </div>
      <div class="rc2-name">${role}</div>
      <div class="rc2-tip" role="tooltip"><strong>${role}</strong>${desc}</div>
    </div>`;
  }

  function makeCol(side, label, slots) {
    return `<div class="rc2-col">
      <div class="rc2-header ${side}">${label}</div>
      <div class="rc2-grid">${slots.map(makeCircle).join('')}</div>
    </div>`;
  }

  // A compact recap of only what you've actually chosen, so you can see the
  // shape of your game without hovering every circle in turn.
  const chosen = [...activeGood, ...activeEvil];
  const summary = chosen.length
    ? `<div class="rc2-summary">
         <div class="rc2-summary-label">In this game</div>
         ${chosen.map(r => `<div class="rc2-summary-row">
             <span class="rc2-summary-role ${EVIL_ROLES_CLIENT.has(r) ? 'evil' : 'good'}">${r}</span>
             <span class="rc2-summary-note">${esc(ROLE_ONELINE[r] || '')}</span>
           </div>`).join('')}
       </div>`
    : `<div class="rc2-summary rc2-summary-empty">Merlin and the Assassin are always in. Tap ⓘ on any role to see what it does.</div>`;

  document.getElementById('role-lists').innerHTML = `
    <div class="rc2-split">
      ${makeCol('good', `⚔ Good (${goodCount()})`, goodSlots)}
      ${makeCol('evil', `💀 Evil (${evilCount})`, evilSlots)}
    </div>
    ${summary}`;

  // ⓘ opens the description and never toggles the role.
  document.querySelectorAll('.rc2-info').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const circle = btn.closest('.rc2-circle');
      const open = circle.classList.contains('tip-open');
      document.querySelectorAll('.rc2-circle.tip-open').forEach(c => c.classList.remove('tip-open'));
      if (!open) circle.classList.add('tip-open');
    });
  });

  // Tapping the circle itself only ever toggles. Reading about a role is the
  // ⓘ's job, so the two can't be confused for one another.
  document.querySelectorAll('.rc2-circle').forEach(el => {
    el.addEventListener('click', () => {
      const { role, state, canadd } = el.dataset;
      if (state === 'available' && canadd !== 'false') { activeToggles.add(role); renderRoleLists(); return; }
      if (state === 'active')                          { activeToggles.delete(role); renderRoleLists(); }
    });
  });

  // Any tap elsewhere closes an open description.
  document.addEventListener('click', () => {
    document.querySelectorAll('.rc2-circle.tip-open').forEach(c => c.classList.remove('tip-open'));
  });
}

document.getElementById('roles-confirm-btn').addEventListener('click', () => {
  initCampaigns();
  revealSection(4);
});
// ── Campaign config ──
function initCampaigns() {
  const sizes = defaultTeamSizes(playerCount);
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
// The setup the create screen currently describes. Derived from GOOD_SPECIALS /
// EVIL_SPECIALS rather than a hardcoded list — those two are the picker's own
// source of truth, and hardcoding here silently dropped every role added to the
// picker afterwards.
function currentRoleConfig() {
  return {
    evilCount,
    goodSpecials: GOOD_SPECIALS.filter(r => activeToggles.has(r)),
    evilSpecials: EVIL_SPECIALS.filter(r => activeToggles.has(r)),
    ladyOfLake: document.getElementById('lotl-checkbox').checked,
    nightRound: document.getElementById('night-round-checkbox').checked,
    shotClockSeconds: 60,
  };
}

// The create screen doubles as the host's setup editor once a room exists, so
// there is exactly one role picker and one set of validation rules.
let editingSetup = false;

document.getElementById('create-submit-btn').addEventListener('click', () => {
  if (!playerCount) { alert('Please select a player count.'); return; }

  if (editingSetup) {
    socket.emit('update-settings', {
      playerCount, campaignsConfig, roleConfig: currentRoleConfig(),
    });
    return;
  }

  const name = document.getElementById('create-name-input').value.trim();
  if (!name) { alert('Please enter your name.'); return; }
  myName = name;
  const orderMode = document.querySelector('input[name="order-mode"]:checked')?.value || 'random';
  socket.emit('create-room', {
    playerCount, campaignsConfig, name, token: playerToken, orderMode,
    roleConfig: currentRoleConfig(),
  });
});

// Open the create screen as an editor, pre-filled from the room as it stands.
function openSetupEditor(state) {
  editingSetup = true;
  playerCount = state.playerCount;
  evilCount   = state.roleConfig?.evilCount ?? defaultEvilCount(playerCount);
  activeToggles.clear();
  [...(state.roleConfig?.goodSpecials || []), ...(state.roleConfig?.evilSpecials || [])]
    .forEach(r => activeToggles.add(r));
  campaignsConfig = (state.campaignsConfig || []).map(c => ({ ...c }));

  document.getElementById('lotl-checkbox').checked = !!state.roleConfig?.ladyOfLake;
  document.getElementById('night-round-checkbox').checked = !!state.roleConfig?.nightRound;

  setPlayerCount(playerCount);
  renderSplitStep();
  renderRoleLists();
  renderCampaignRows();
  for (let i = 2; i <= 4; i++) document.getElementById(`create-section-${i}`).style.display = '';

  // Name and turn order belong to creating a room, not editing one.
  document.getElementById('create-name-input').closest('#screen-create')
    ?.querySelectorAll('.editor-hide').forEach(el => { el.style.display = 'none'; });
  document.getElementById('quick-start-btn').style.display = 'none';
  document.getElementById('pc-confirm-btn').style.display = 'none';
  document.getElementById('create-submit-btn').textContent = 'Save settings';
  document.getElementById('create-back-btn').dataset.back = 'lobby';

  showScreen('create');
}

// Put the create screen back to creating rooms.
function closeSetupEditor() {
  if (!editingSetup) return;
  editingSetup = false;
  document.querySelectorAll('#screen-create .editor-hide').forEach(el => { el.style.display = ''; });
  document.getElementById('quick-start-btn').style.display = '';
  document.getElementById('pc-confirm-btn').style.display = '';
  document.getElementById('create-submit-btn').textContent = 'Create Room →';
  document.getElementById('create-back-btn').dataset.back = 'home';
}

// ── Join ──
document.getElementById('join-submit-btn').addEventListener('click', () => {
  const code = document.getElementById('join-code-input').value.trim().toUpperCase();
  const name = document.getElementById('join-name-input').value.trim();
  if (!code || code.length !== 5) { document.getElementById('join-error').textContent = 'Enter a 5-letter room code.'; return; }
  if (!name)                      { document.getElementById('join-error').textContent = 'Enter your name.'; return; }
  myName = name;
  socket.emit('join-room', { code, name, token: playerToken });
});

// ── Invite link ──
function inviteUrl(code) { return `${location.origin}/?room=${encodeURIComponent(code)}`; }

// A QR is only useful if the phone scanning it can actually reach this origin.
// On localhost it cannot — the code would resolve to the scanner's own machine.
function originIsReachableByOthers() {
  const h = location.hostname;
  return h !== 'localhost' && h !== '127.0.0.1' && h !== '::1' && h !== '';
}

function renderInviteQr(code) {
  const box = document.getElementById('qr-invite');
  const img = document.getElementById('qr-image');
  const warn = document.getElementById('qr-warning');
  if (!box || !img || !code || code === '—') return;

  img.src = `/qr?data=${encodeURIComponent(inviteUrl(code))}`;

  // Say so rather than handing someone a code that silently goes nowhere.
  const reachable = originIsReachableByOthers();
  warn.hidden = reachable;
  if (!reachable) {
    warn.textContent = 'You’re on localhost, so this code only works on this machine. '
                     + 'Open the app on your network address for others to scan it.';
  }
}

async function copyText(text) {
  // The async clipboard API needs a secure context, which a LAN IP served over
  // plain http isn't — and that's exactly how people reach this on game night.
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:-9999px;opacity:0;';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  ta.remove();
  return ok;
}

let inviteResetTimer = null;
document.getElementById('lobby-invite-btn')?.addEventListener('click', async () => {
  const btn   = document.getElementById('lobby-invite-btn');
  const label = document.getElementById('lobby-invite-label');
  const code  = myRoomCode || document.getElementById('lobby-code').textContent.trim();
  if (!code || code === '—') return;

  const url = inviteUrl(code);
  const ok  = await copyText(url);
  // Last resort: a prompt is at least selectable, so the link is never stranded.
  if (!ok) { window.prompt('Copy this invite link:', url); return; }

  label.textContent = 'Link copied!';
  btn.classList.add('copied');
  clearTimeout(inviteResetTimer);
  inviteResetTimer = setTimeout(() => {
    label.textContent = 'Copy invite link';
    btn.classList.remove('copied');
  }, 2000);
});

// ── Socket: lobby ──
socket.on('room-created', ({ code }) => {
  myRoomCode = code;
  document.getElementById('lobby-code').textContent = code;
  renderInviteQr(code);
  saveSession({ name: myName, code });
  showScreen('lobby');
});
socket.on('room-joined', ({ code }) => {
  myRoomCode = code;
  document.getElementById('lobby-code').textContent = code;
  renderInviteQr(code);
  saveSession({ name: myName, code });
  showScreen('lobby');
});
socket.on('join-error', msg => { document.getElementById('join-error').textContent = msg; });

socket.on('game-in-progress', ({ disconnectedSlots }) => {
  const errEl = document.getElementById('join-error');
  if (!disconnectedSlots.length) {
    errEl.textContent = 'A game is already in progress in that room.';
  } else {
    errEl.textContent = `A game is in progress. If you were playing, enter your name exactly as you joined and try again.`;
  }
});

socket.on('rejoin-ok', ({ state, claimedName }) => {
  if (claimedName) myName = claimedName;
  myRoomCode = myRoomCode || document.getElementById('lobby-code').textContent;
  document.getElementById('lobby-code').textContent = myRoomCode;
  renderInviteQr(myRoomCode);
  saveSession({ name: myName, code: myRoomCode });
  if (state === 'playing') {
    document.getElementById('placard-name-label').textContent = myName;
    document.getElementById('rcb-value-placard').textContent = myRoomCode;
    showScreen('placard');
  }
  else showScreen('lobby');
});
socket.on('rejoin-error', msg => { clearSession(); alert(msg + '\nStarting fresh.'); showScreen('home'); });

// ── Host settings, from inside the lobby ──
// Someone says they're in, then drops out. Rather than the host destroying the
// room and resharing a link (and a QR everyone already scanned), the target
// count comes down here and the roles rebalance to fit.
function renderHostSettings(state, iAmHost) {
  const box = document.getElementById('lobby-settings');
  if (!box) return;
  if (!iAmHost) { box.innerHTML = ''; return; }

  const cfg   = state.roleConfig || {};
  const count = state.playerCount;
  const evil  = cfg.evilCount ?? defaultEvilCount(count);
  const specials = [...(cfg.goodSpecials || []), ...(cfg.evilSpecials || [])];
  const atFloor = count <= Math.max(5, state.players.length);

  box.innerHTML = `
    <details class="host-settings" ${box.querySelector('details[open]') ? 'open' : ''}>
      <summary>Host settings</summary>
      <div class="hs-body">
        <div class="hs-row">
          <span class="hs-label">Players needed</span>
          <div class="hs-stepper">
            <button class="hs-btn" id="hs-minus" ${atFloor ? 'disabled' : ''}>−</button>
            <span class="hs-value">${count}</span>
            <button class="hs-btn" id="hs-plus">+</button>
          </div>
        </div>
        <div class="hs-row">
          <span class="hs-label">Evil players</span>
          <div class="hs-stepper">
            <button class="hs-btn" id="hs-evil-minus" ${evil <= 1 ? 'disabled' : ''}>−</button>
            <span class="hs-value">${evil}</span>
            <button class="hs-btn" id="hs-evil-plus" ${evil >= count - 1 ? 'disabled' : ''}>+</button>
          </div>
        </div>
        <div class="hs-note">
          ${specials.length ? `Roles: ${specials.map(esc).join(', ')}` : 'No special roles beyond Merlin and the Assassin.'}
        </div>
        ${atFloor && count === state.players.length
          ? `<div class="hs-hint">Remove a player with ✕ to go lower.</div>` : ''}
        <button class="secondary-btn small hs-edit" id="hs-edit-btn">Edit roles &amp; quests…</button>
        <p class="hs-error" id="hs-error"></p>
      </div>
    </details>`;

  // Sending the whole setup each time keeps the server the single validator —
  // it re-checks the split and the specials rather than trusting these buttons.
  const push = (nextCount, nextEvil) => {
    const sizes = defaultTeamSizes(nextCount);
    const capGood = nextCount - nextEvil - 1;
    const capEvil = nextEvil - 1;
    socket.emit('update-settings', {
      playerCount: nextCount,
      roleConfig: {
        ...cfg,
        evilCount: nextEvil,
        goodSpecials: (cfg.goodSpecials || []).slice(0, Math.max(0, capGood)),
        evilSpecials: (cfg.evilSpecials || []).slice(0, Math.max(0, capEvil)),
      },
      campaignsConfig: sizes.map((sz, i) => ({
        teamSize: sz,
        failsNeeded: (nextCount >= 7 && i === 3) ? 2 : 1,
      })),
    });
  };

  document.getElementById('hs-edit-btn')?.addEventListener('click', () => openSetupEditor(state));
  document.getElementById('hs-minus')?.addEventListener('click', () => push(count - 1, Math.min(evil, count - 2)));
  document.getElementById('hs-plus') ?.addEventListener('click', () => push(count + 1, evil));
  document.getElementById('hs-evil-minus')?.addEventListener('click', () => push(count, evil - 1));
  document.getElementById('hs-evil-plus') ?.addEventListener('click', () => push(count, evil + 1));
}

socket.on('action-error', msg => {
  const el = document.getElementById('hs-error');
  if (el) { el.textContent = msg; setTimeout(() => { el.textContent = ''; }, 4000); }
});

// The host started another game in the same room — everyone lands back in the
// lobby rather than being bounced to the home screen with a dead link.
socket.on('back-to-lobby', () => {
  myRole = null;
  ladyPrivateResult = null;
  showScreen('lobby');
});

socket.on('kicked', () => {
  clearSession();
  alert('The host removed you from the room.');
  location.reload();
});

socket.on('lobby-update', state => {
  // A save while the editor is open means the server accepted it — go back.
  if (editingSetup && document.querySelector('.screen.active')?.id === 'screen-create') {
    closeSetupEditor();
    showScreen('lobby');
  }
  const { players, playerCount: needed } = state;
  const me = players.find(p => p.id === socket.id);
  const joined = players.length, full = joined === needed;
  const readyCount = players.filter(p => p.ready).length;

  document.getElementById('lobby-status').textContent =
    full ? `All ${needed} players joined!` : `Waiting for players… (${joined}/${needed})`;

  const iAmHost = state.hostId === socket.id;

  document.getElementById('lobby-players-list').innerHTML = players.map(p => {
    const isMe = p.name === myName;
    return `<div class="lobby-player ${p.ready ? 'ready' : ''}${isMe ? ' lobby-me' : ''}">
       <span class="lobby-player-name">${esc(p.name)}${isMe ? ' <span class="lobby-you-tag">You</span>' : ''}</span>
       <span class="lobby-player-status">${p.ready ? '✓ Ready' : 'Waiting'}</span>
       ${iAmHost && !isMe ? `<button class="lobby-kick" data-kick="${p.id}" title="Remove ${esc(p.name)}">✕</button>` : ''}
     </div>`;
  }).join('');

  document.querySelectorAll('[data-kick]').forEach(btn => btn.addEventListener('click', () => {
    socket.emit('kick-player', { playerId: btn.dataset.kick });
  }));

  renderHostSettings(state, iAmHost);

  const readyBtn = document.getElementById('ready-btn');
  if (full) {
    readyBtn.style.display = 'block';
    readyBtn.textContent = me?.ready ? 'Unready' : "I'm Ready";
    readyBtn.className = 'primary-btn' + (me?.ready ? ' btn-unready' : '');
  } else {
    readyBtn.style.display = 'none';
  }
  document.getElementById('lobby-hint').textContent =
    full ? `Game starts when all ${needed} players are ready. (${readyCount}/${needed} ready)` : '';
});

document.getElementById('ready-btn').addEventListener('click', () => socket.emit('toggle-ready'));
document.getElementById('lobby-leave-btn').addEventListener('click', () => {
  socket.emit('leave-lobby');
  clearSession();
  location.reload();
});

// ── Order select (host-chosen turn order) ──
let orderIds = []; // current drag order, array of player IDs, top = goes first

socket.on('enter-order-select', ({ players, hostId }) => {
  document.getElementById('rcb-value-order').textContent = myRoomCode;
  const isHost = socket.id === hostId;
  document.getElementById('order-select-host-view').style.display = isHost ? 'block' : 'none';
  document.getElementById('order-select-waiting-view').style.display = isHost ? 'none' : 'block';

  if (isHost) {
    orderIds = players.map(p => p.id);
    const nameById = Object.fromEntries(players.map(p => [p.id, p.name]));
    renderOrderDragList(nameById);
  } else {
    const hostName = players.find(p => p.id === hostId)?.name || 'the host';
    document.getElementById('order-select-waiting-text').innerHTML =
      `Waiting for <strong>${esc(hostName)}</strong> to set the turn order…`;
  }
  showScreen('order-select');
});

function renderOrderDragList(nameById) {
  const list = document.getElementById('order-drag-list');
  list.innerHTML = orderIds.map((id, i) => `
    <div class="order-drag-row" data-id="${id}">
      <span class="order-drag-pos">${i + 1}</span>
      <span class="order-drag-name">${esc(nameById[id])}</span>
      <span class="order-drag-handle">⠿</span>
    </div>`).join('');
  wireOrderDragRows(nameById);
}

// Touch + mouse compatible drag-to-reorder using Pointer Events (HTML5 drag/drop
// doesn't work reliably on mobile, which this app targets). The dragged row's
// own DOM node/listeners are never replaced mid-drag — only translateY on all
// rows changes — so pointer capture stays valid throughout. A single clean
// re-render happens on drop to snap everything to its final resting position.
function wireOrderDragRows(nameById) {
  const list = document.getElementById('order-drag-list');
  const rows = [...list.querySelectorAll('.order-drag-row')]; // fixed reference to original render order

  rows.forEach((row, originalIndex) => {
    let dragging = false;
    let startY = 0, rowHeight = 0, startIndex = 0;

    row.addEventListener('pointerdown', e => {
      dragging = true;
      startY = e.clientY;
      rowHeight = row.offsetHeight;
      startIndex = orderIds.indexOf(row.dataset.id);
      row.setPointerCapture(e.pointerId);
      row.classList.add('dragging');
    });

    row.addEventListener('pointermove', e => {
      if (!dragging) return;
      const deltaY = e.clientY - startY;
      row.style.transform = `translateY(${deltaY}px)`;

      const rawIndex = startIndex + Math.round(deltaY / rowHeight);
      const targetIndex = Math.max(0, Math.min(orderIds.length - 1, rawIndex));
      const currentIndex = orderIds.indexOf(row.dataset.id);
      if (targetIndex !== currentIndex) {
        orderIds.splice(currentIndex, 1);
        orderIds.splice(targetIndex, 0, row.dataset.id);
      }

      // Shift every other row to reflect its current logical position relative
      // to where it was originally rendered — recomputed fully each move so
      // fast drags that cross multiple rows still land correctly.
      rows.forEach((r, idx) => {
        if (r === row) return;
        const newIdx = orderIds.indexOf(r.dataset.id);
        r.style.transition = 'transform 0.12s';
        r.style.transform = `translateY(${(newIdx - idx) * rowHeight}px)`;
      });
    });

    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      renderOrderDragList(nameById);
    };
    row.addEventListener('pointerup', endDrag);
    row.addEventListener('pointercancel', endDrag);
  });
}

document.getElementById('order-start-btn').addEventListener('click', () => {
  socket.emit('submit-order', {
    order: orderIds,
    randomizeStart: document.getElementById('order-randomize-checkbox').checked,
  });
});

// ── Socket: game start → placard ──
socket.on('game-start', () => {
  document.getElementById('placard-name-label').textContent = myName;
  document.getElementById('rcb-value-placard').textContent = myRoomCode;
  showScreen('placard');
});

socket.on('your-role', ({ role, isEvil, known }) => {
  myRole = { role, isEvil, known };
  const s = loadSession();
  if (s) saveSession({ ...s, role: myRole });
});

// ── Role overlay (shared between placard + in-game button) ──
function showRoleOverlay() {
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
}

// ── Placard ──
document.getElementById('my-placard').addEventListener('click', () => {
  showRoleOverlay();
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
let myTeamVote = null;
let myTeamVoteKey = null;

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

// Two-tap confirm so "Leave game" can't be triggered by an accidental tap.
// Lives in the status bar now that the pause overlay — its only previous home —
// is gone.
function wireLeaveButton(btn) {
  if (!btn || btn.dataset.wired) return;
  btn.dataset.wired = '1';
  let armed = false;
  let revertTimer = null;
  btn.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      btn.textContent = 'Tap again to confirm leaving';
      btn.classList.add('armed');
      revertTimer = setTimeout(() => {
        armed = false;
        btn.textContent = 'Leave game';
        btn.classList.remove('armed');
      }, 3000);
      return;
    }
    clearTimeout(revertTimer);
    socket.emit('leave-game');
    clearSession();
    location.reload();
  });
}

// Absence no longer takes over the screen. The old full-screen pause overlay
// interrupted everyone and pushed the table into nagging whoever dropped; the
// game already cannot advance without a missing player's input, so the modal
// was protecting nothing. Presence and the reason for any hold now render
// inline via renderStatus().

function renderGame(state) {
  if (state.specialRoles) gameSpecialRoles = state.specialRoles;
  document.getElementById('rcb-value').textContent = myRoomCode;
  document.getElementById('rcb-value-placard').textContent = myRoomCode;
  renderCampaignTrack(state);
  renderGameMeta(state);
  renderStatus(state);
  renderGameContent(state);
}

function renderCampaignTrack(state) {
  const track = document.getElementById('campaign-track');
  track.innerHTML = state.campaignsConfig.map((c, i) => {
    const r = state.campaignResults[i];
    const cls = r === 'pass' ? 'ct-dot pass' : r === 'fail' ? 'ct-dot fail' : i === state.currentCampaign ? 'ct-dot current' : 'ct-dot';
    const tappable = r ? ' ct-dot-tappable' : '';
    // Team size on upcoming quests, plus a marker on the ones that need two
    // fails — previously that was invisible until the quest was already over.
    const twoFail = c.failsNeeded > 1 ? `<span class="ct-twofail">${c.failsNeeded}✗</span>` : '';
    return `<div class="${cls}${tappable}" data-qi="${i}" title="Team of ${c.teamSize}, needs ${c.failsNeeded} fail${c.failsNeeded > 1 ? 's' : ''}">
      ${r === 'pass' ? '✔' : r === 'fail' ? '✘' : `<span>${c.teamSize}</span>${twoFail}`}
    </div>`;
  }).join('');

  track.querySelectorAll('.ct-dot-tappable').forEach(dot => {
    dot.addEventListener('click', e => {
      e.stopPropagation();
      const i = parseInt(dot.dataset.qi);
      const entry = (state.questHistory || []).find(h => h.campaign === i);
      showQuestHistoryPopup(dot, i, entry, state);
    });
  });
}

function showQuestHistoryPopup(anchor, i, entry, state) {
  document.getElementById('quest-history-popup')?.remove();
  if (!entry) return;

  const canDispute = state.phase !== 'game-over' && !state.pendingDispute;
  const tvHtml = entry.teamVotes?.length
    ? `<div class="qhp-label">Team vote</div><div class="qhp-team">${entry.teamVotes.map(v =>
        `<span class="qhp-chip ${v.vote === 'approve' ? 'approve' : 'reject'}">${esc(v.name)} ${v.vote === 'approve' ? '✓' : '✗'}</span>`
      ).join('')}</div>` : '';

  const popup = document.createElement('div');
  popup.id = 'quest-history-popup';
  popup.className = 'quest-history-popup';
  popup.innerHTML =
    `<div class="qhp-title ${entry.passed ? 'good' : 'evil'}">Quest ${i + 1} — ${entry.passed ? 'Passed ✔' : 'Failed ✘'}</div>
     <div class="qhp-leader">Led by <strong>${esc(entry.leaderName)}</strong></div>
     <div class="qhp-label">Quest team</div>
     <div class="qhp-team">${entry.team.map(n => `<span class="qhp-chip">${esc(n)}</span>`).join('')}</div>
     ${tvHtml}
     <div class="qhp-result">${entry.fails} fail vote${entry.fails !== 1 ? 's' : ''} (needed ${entry.failsNeeded} to fail)</div>
     ${canDispute ? `<button class="qhp-dispute-btn" data-campaign="${i}">⚠ Dispute this result</button>` : ''}`;

  document.getElementById('game-header').appendChild(popup);

  popup.querySelector('.qhp-dispute-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    popup.remove();
    socket.emit('propose-dispute', { campaign: i });
  });

  // Dismiss on outside click
  setTimeout(() => document.addEventListener('click', function dismiss() {
    popup.remove();
    document.removeEventListener('click', dismiss);
  }), 0);
}

// Reusable popups — called from both the in-game meta bar and the pause overlay,
// so paused/disconnected players' teammates can still check roles/order.
function showRolesRefPopup(state) {
  const existing = document.getElementById('roles-ref-popup');
  if (existing) { existing.remove(); return; }
  const popup = document.createElement('div');
  popup.id = 'roles-ref-popup';
  popup.className = 'roles-ref-popup';
  const roleCounts = {};
  (state.rolesInGame || []).forEach(r => { roleCounts[r] = (roleCounts[r] || 0) + 1; });
  const allRoles = [
    ...['Merlin', 'Percival', 'Loyal Servant'].filter(r => roleCounts[r]),
    ...['Assassin', 'Morgana', 'Mordred', 'Oberon', 'Minion of Mordred'].filter(r => roleCounts[r]),
  ];
  popup.innerHTML = `
    <div class="rrp-title">Roles in this game</div>
    ${allRoles.map(r => {
      const count = roleCounts[r];
      const countBadge = count > 1 ? `<span class="rrp-count">×${count}</span>` : '';
      return `
      <div class="rrp-row ${EVIL_ROLES_CLIENT.has(r) ? 'evil' : 'good'}">
        <div class="rrp-role-name">${ROLE_EMOJI[r] || ''} ${r}${countBadge}</div>
        <div class="rrp-desc">${ROLE_DESCRIPTIONS[r] || ''}</div>
      </div>`;
    }).join('')}`;
  document.body.appendChild(popup);
  setTimeout(() => {
    document.addEventListener('click', function close() {
      popup.remove(); document.removeEventListener('click', close);
    }, { once: true });
  }, 0);
}

function showLeaderOrderPopup(state) {
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
}

function renderGameMeta(state) {
  const rejections = state.consecutiveRejections;
  document.getElementById('game-meta').innerHTML =
    `<div class="meta-left">
       <span class="meta-myname">You: <strong>${esc(myName)}</strong></span>
       <span class="meta-leader">Leader: <strong>${esc(state.leaderName)}</strong></span>
       ${state.ladyHolder ? `<span class="meta-lady">🌊 Lady of the Lake: <strong>${esc(state.ladyHolder === socket.id ? 'You' : (state.ladyHolderName || '?'))}</strong></span>` : ''}
       ${rejections > 0 ? `<span class="meta-reject">⚠ ${rejections}/5 rejections</span>` : ''}
     </div>
     <div class="meta-right-btns">
       <button class="meta-order-btn" id="show-role-btn" title="My role">Role</button>
       <button class="meta-order-btn" id="show-roles-ref-btn" title="Roles in game">📜 Roles</button>
       <button class="meta-order-btn" id="show-order-btn" title="Leader rotation">👑 Order</button>
     </div>`;
  document.getElementById('show-role-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    showRoleOverlay();
  });
  document.getElementById('show-roles-ref-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    showRolesRefPopup(state);
  });
  document.getElementById('show-order-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    showLeaderOrderPopup(state);
  });
}

// ── Status bar: presence, why the game is held up, and the shot clock ──
// This replaces the old full-screen pause overlay. It never hides the board.
const WAIT_VERB = {
  'team-select':      'to pick a team',
  'team-vote':        'to vote on the team',
  'quest-vote':       'to play a quest card',
  'quest-vote-ready': 'to reveal the result',
  'assassination':    'to choose a target',
  'lady-of-lake':     'to use the Lady of the Lake',
};

let clockTicker = null;

function renderStatus(state) {
  const el = document.getElementById('game-status');
  if (!el) return;

  const away    = state.disconnected || [];
  const waiting = state.waitingOn || [];
  const sc      = state.shotClock || {};
  const verb    = WAIT_VERB[state.phase] || '';
  const parts   = [];

  // The Revealer outs itself after three quests — public knowledge, so it sits
  // with the other things everyone can see.
  const revealed = state.revealedEvil || [];
  if (revealed.length) {
    parts.push(`<div class="revealed-evil">🔥 <strong>${revealed.map(p => esc(p.name)).join(', ')}</strong> ${revealed.length === 1 ? 'is' : 'are'} revealed as <strong>Evil</strong></div>`);
  }

  // Say something only when the game genuinely cannot move. The rest of the
  // time an absent player is a footnote, not an interruption.
  if (waiting.length) {
    const stalled = waiting.filter(n => away.includes(n));
    parts.push(`
      <div class="gs-waiting${stalled.length ? ' is-away' : ''}">
        <span class="gs-hourglass">⏳</span>
        <span class="gs-waiting-text">Waiting on <strong>${esc(waiting.join(', '))}</strong> ${esc(verb)}</span>
        ${stalled.length ? `<span class="gs-away-tag">${esc(stalled.join(', '))} ${stalled.length === 1 ? 'is' : 'are'} disconnected</span>` : ''}
      </div>`);
  } else if (away.length) {
    parts.push(`<div class="gs-away-quiet">${esc(away.join(', '))} ${away.length === 1 ? 'is' : 'are'} away</div>`);
  }

  // The clock is always available; only the phase decides whether it applies,
  // because team-select and team-vote are the only two with an honest default.
  const clockable = state.phase === 'team-select' || state.phase === 'team-vote';
  if (clockable) {
    if (sc.deadline) {
      const left = Math.max(0, Math.ceil((sc.deadline - Date.now()) / 1000));
      parts.push(`<div class="gs-clock is-running">
          <span class="gs-clock-label">Shot clock</span>
          <span class="gs-clock-time" id="gs-clock-time">${left}s</span>
        </div>`);
    } else {
      const mine = sc.votes.includes(socket.id);
      parts.push(`<div class="gs-clock">
          <button class="gs-clock-btn${mine ? ' is-on' : ''}" id="gs-call-clock">
            ${mine ? '✓ Clock called' : '⏱ Call the clock'}
          </button>
          <span class="gs-clock-tally">${sc.votes.length} of ${sc.threshold} needed</span>
        </div>`);
    }
  }

  parts.push(`<button class="gs-leave" id="gs-leave-btn">Leave game</button>`);
  el.innerHTML = parts.join('');

  document.getElementById('gs-call-clock')?.addEventListener('click', () => socket.emit('call-clock'));
  wireLeaveButton(document.getElementById('gs-leave-btn'));

  clearInterval(clockTicker);
  if (sc.deadline) {
    clockTicker = setInterval(() => {
      const t = document.getElementById('gs-clock-time');
      if (!t) return clearInterval(clockTicker);
      const left = Math.max(0, Math.ceil((sc.deadline - Date.now()) / 1000));
      t.textContent = `${left}s`;
    }, 250);
  }
}

let ladyPrivateResult = null; // { targetName, alignment } — set by lady-result event

socket.on('lady-result', ({ targetName, alignment }) => {
  ladyPrivateResult = { targetName, alignment };
  if (lastGameState) renderGameContent(lastGameState);
});

// Quests that need two fails are the single most important fact on the board,
// and used to be invisible until the quest had already resolved.
function questReq(config) {
  const n = config.failsNeeded || 1;
  return n > 1 ? ` — needs <strong>${n} fails</strong> to fail` : '';
}

function renderGameContent(state) {
  const el = document.getElementById('game-content');
  const me = socket.id;
  const isLeader = state.leaderId === me;
  const onTeam   = state.proposedTeam.includes(me);
  const config   = state.campaignsConfig[state.currentCampaign] || {};
  const players  = state.players;

  // Dispute banner — shown on top of whatever else is happening
  if (state.pendingDispute) {
    const d = state.pendingDispute;
    const alreadyVoted = d.votes && d.votes[me];
    const voterCount = d.votes ? Object.keys(d.votes).length : 0;
    el.innerHTML = `
      <div class="dispute-banner">
        <div class="dispute-title">⚠ Outcome Dispute</div>
        <div class="dispute-body"><strong>${esc(d.proposerName)}</strong> proposes changing Quest ${d.campaign + 1} to <strong>${d.proposedResult}</strong>.<br>Unanimous approval required. (${voterCount}/${players.length} agreed)</div>
        ${!alreadyVoted ? `
          <div class="dispute-btns">
            <button class="vote-btn approve-btn" id="dispute-approve">✓ Agree</button>
            <button class="vote-btn reject-btn"  id="dispute-reject">✗ Reject</button>
          </div>` : `<div class="voted-msg">You agreed — waiting for others…</div>`}
      </div>`;
    el.querySelector('#dispute-approve')?.addEventListener('click', () => socket.emit('dispute-vote', { approve: true }));
    el.querySelector('#dispute-reject')?.addEventListener('click',  () => socket.emit('dispute-vote', { approve: false }));
    return;
  }

  if (state.phase === 'night-round') {
    const steps = state.nightRoundScript || [];
    const narratorName = players.find(p => p.id === state.leaderId)?.name || '?';
    el.innerHTML = `
      <div class="phase-header">
        <div class="phase-title">🌙 Night Round</div>
        <div class="phase-sub">${isLeader ? 'Read the script aloud, then begin the game.' : `${esc(narratorName)} reads the script aloud…`}</div>
      </div>
      <div class="night-round-card">
        ${steps.map((s, i) => `<div class="night-round-line"><span class="nr-line-num">${i + 1}.</span><span>${esc(s)}</span></div>`).join('')}
      </div>
      ${isLeader
        ? `<button class="primary-btn" id="night-round-continue-btn" style="margin-top:16px;">Begin the Quests →</button>`
        : `<div class="night-round-waiting">Waiting for ${esc(narratorName)} to finish…</div>`}`;
    el.querySelector('#night-round-continue-btn')?.addEventListener('click', () => socket.emit('night-round-continue'));
    return;
  }

  if (state.phase === 'lady-of-lake') {
    const isHolder = state.ladyHolder === me;
    const holder = players.find(p => p.id === state.ladyHolder);
    const eligible = players.filter(p => !state.ladyUsed.includes(p.id) && p.id !== me);

    if (isHolder && !ladyPrivateResult) {
      el.innerHTML = `
        <div class="phase-header">
          <div class="phase-title">🌊 Lady of the Lake</div>
          <div class="phase-sub">You hold the token. Secretly investigate one player's alignment.</div>
        </div>
        <div class="pick-player-list">
          ${eligible.map(p => `
            <button class="pick-player lady-pick" data-id="${p.id}">
              <span class="pick-name">${esc(p.name)}</span>
              <span class="pick-check"></span>
            </button>
          `).join('')}
        </div>`;
      el.querySelectorAll('.lady-pick').forEach(btn => {
        btn.addEventListener('click', () => socket.emit('lady-investigate', { targetId: btn.dataset.id }));
      });
    } else if (isHolder && ladyPrivateResult) {
      const { targetName, alignment } = ladyPrivateResult;
      const cls = alignment === 'evil' ? 'evil' : 'good';
      el.innerHTML = `
        <div class="phase-header">
          <div class="phase-title">🌊 Lady of the Lake</div>
          <div class="phase-sub">Only you can see this result.</div>
        </div>
        <div class="lady-result-card ${cls}">
          <div class="lady-result-name">${esc(targetName)}</div>
          <div class="lady-result-align ${cls}">${alignment === 'evil' ? '💀 Evil' : '⚔ Good'}</div>
        </div>
        <button class="primary-btn" id="lady-continue-btn" style="margin-top:16px;">Continue →</button>`;
      el.querySelector('#lady-continue-btn').addEventListener('click', () => {
        ladyPrivateResult = null;
        socket.emit('lady-announce', { announcement: alignment }); // always honest — host sees result in history
      });
    } else {
      el.innerHTML = `
        <div class="phase-header">
          <div class="phase-title">🌊 Lady of the Lake</div>
        </div>
        <div class="lady-waiting-card">
          <div class="lady-waiting-name">${esc(holder?.name || '?')}</div>
          <div class="lady-waiting-label">holds the Lady of the Lake token</div>
          <div class="lady-waiting-sub">They are secretly investigating another player's alignment…</div>
        </div>`;
    }
    return;
  }

  if (state.phase === 'game-over') {
    const rolesMap = {};
    if (state.revealedRoles) state.revealedRoles.forEach(p => { rolesMap[p.name] = p.role; });

    const rolesHtml = state.revealedRoles ? `
      <div class="roles-reveal">
        <div class="roles-reveal-title">True Roles</div>
        ${state.revealedRoles.map(p => `
          <div class="role-reveal-row ${EVIL_ROLES_CLIENT.has(p.role) ? 'evil' : 'good'}">
            <span class="rr-name">${esc(p.name)}</span>
            <span class="rr-role">${esc(p.role)}</span>
          </div>`).join('')}
      </div>` : '';

    const replayHtml = state.questHistory.length ? `
      <div class="replay-section">
        <div class="replay-title">Round by Round</div>
        ${state.questHistory.map((h, i) => {
          const teamRoles = h.team.map(name => {
            const role = rolesMap[name];
            return `<span class="rr-chip ${role && EVIL_ROLES_CLIENT.has(role) ? 'evil' : 'good'}">${esc(name)}${role ? ` <em>${esc(role)}</em>` : ''}</span>`;
          }).join('');
          const tvHtml = h.teamVotes?.length ? h.teamVotes.map(v =>
            `<span class="tv-chip ${v.vote === 'approve' ? 'approve' : 'reject'}">${esc(v.name)} ${v.vote === 'approve' ? '✓' : '✗'}</span>`
          ).join('') : '';
          const qvHtml = h.questVoteBreakdown?.length ? h.questVoteBreakdown.map(v =>
            `<span class="qv-chip ${v.vote === 'fail' ? 'evil' : 'good'}">${esc(v.name)} ${v.vote === 'fail' ? '✗ Fail' : '✓ Pass'}</span>`
          ).join('') : `<span class="qv-anon">${h.fails} fail${h.fails !== 1 ? 's' : ''}</span>`;
          return `
          <div class="replay-card ${h.passed ? 'pass' : 'fail'}" style="animation-delay:${i * 0.15}s">
            <div class="replay-card-header">
              <span class="replay-q">Quest ${h.campaign + 1}</span>
              <span class="replay-result ${h.passed ? 'pass' : 'fail'}">${h.passed ? '✔ Passed' : '✘ Failed'}</span>
            </div>
            <div class="replay-leader">Led by <strong>${esc(h.leaderName)}</strong></div>
            <div class="replay-section-label">Team</div>
            <div class="replay-chips">${teamRoles}</div>
            ${tvHtml ? `<div class="replay-section-label">Team Vote</div><div class="replay-chips">${tvHtml}</div>` : ''}
            <div class="replay-section-label">Quest Votes</div>
            <div class="replay-chips">${qvHtml}</div>
          </div>`;
        }).join('')}
      </div>` : '';

    el.innerHTML = `
      <div class="game-over-box ${state.winner}">
        <div class="go-icon">${state.winner === 'good' ? '⚔️' : '💀'}</div>
        <div class="go-title">${state.winner === 'good' ? 'Good Wins!' : 'Evil Wins!'}</div>
        ${state.winReason ? `<div class="go-reason">${esc(state.winReason)}</div>` : ''}
        ${rolesHtml}
        ${replayHtml}
        ${state.hostId === me
          ? `<button class="primary-btn" id="play-again-btn" style="margin-top:24px;">Play again — same room</button>`
          : `<div class="go-waiting">Waiting for the host to start another game…</div>`}
        <button class="secondary-btn" id="go-leave-btn" style="margin-top:10px;">Leave room</button>
      </div>`;

    document.getElementById('play-again-btn')?.addEventListener('click', () => socket.emit('play-again'));
    document.getElementById('go-leave-btn')?.addEventListener('click', () => {
      socket.emit('leave-game');
      clearSession();
      location.reload();
    });
    return;
  }

  if (state.phase === 'assassination') {
    // The shot normally sits with the Assassin, but they may hand it to the
    // Untrustworthy Servant — so the question is never "am I the Assassin",
    // it is "am I the one holding the knife right now".
    const holdsShot  = (state.killerId || state.assassinId) === me;
    const delegated  = !!state.assassinDelegated;
    const isAssassin = state.assassinId === me;

    if (holdsShot) {
      const handedOver = delegated && !isAssassin;
      const header = handedOver
        ? `<div class="phase-title" style="color:#ffb347">The Assassin handed you the knife.</div>
           <div class="phase-sub assassination-sub">You are the Untrustworthy Servant. Name Merlin and you win with Evil. Miss, and Good still takes it — with you.</div>`
        : `<div class="phase-title" style="color:#66ff88">Good won the quests!</div>
           <div class="phase-sub assassination-sub">You are the Assassin. One chance — who is Merlin?</div>`;

      el.innerHTML = `
        <div class="phase-header assassination-header">${header}</div>
        <div id="player-pick-list">
          ${players.filter(p => p.id !== me).map(p => `
            <div class="pick-player" data-id="${p.id}">
              <span class="pick-name">${esc(p.name)}</span>
              <span class="pick-check"></span>
            </div>`).join('')}
        </div>
        <button id="submit-assassinate-btn" class="primary-btn evil-action-btn" disabled style="margin-top:20px;">
          Select a player
        </button>
        ${state.canDelegate && isAssassin ? `
          <div class="assassination-delegate">
            <div class="assassination-delegate-note">
              There is an Untrustworthy Servant at this table, and you know who.
              You can hand them the shot instead — they win with you if they name
              Merlin. You cannot take it back.
            </div>
            <button id="delegate-assassinate-btn" class="secondary-btn">
              🪞 Hand the knife to the Untrustworthy Servant
            </button>
          </div>` : ''}`;

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
      const dbtn = document.getElementById('delegate-assassinate-btn');
      if (dbtn) dbtn.addEventListener('click', () => {
        dbtn.disabled = true;
        socket.emit('delegate-assassination');
      });
    } else {
      // Delegation is public the moment it happens — the Servant is outed by
      // taking the shot, so there is nothing left to hide at this point.
      const killerName = players.find(p => p.id === state.killerId)?.name;
      el.innerHTML = `
        <div class="phase-header assassination-header">
          <div class="phase-title" style="color:#66ff88">Good won the quests!</div>
          <div class="phase-sub assassination-sub">${delegated
            ? `${esc(killerName || 'The Untrustworthy Servant')} is choosing who to eliminate…`
            : 'The Assassin is choosing who to eliminate…'}</div>
        </div>
        <div class="assassination-hint">${delegated
          ? `The Assassin handed the knife to ${esc(killerName || 'the Untrustworthy Servant')} — the Untrustworthy Servant.`
          : 'Evil is deciding who they think Merlin is.'}</div>
        <div class="waiting-pulse">${delegated ? '🪞' : '🗡️'}</div>`;
    }
    return;
  }

  if (state.phase === 'team-select') {
    if (isLeader) {
      el.innerHTML = `
        <div class="phase-header">
          <div class="phase-title">You are the Leader</div>
          <div class="phase-sub">Select <strong>${config.teamSize}</strong> players for Campaign ${state.currentCampaign + 1}${questReq(config)}</div>
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
          <div class="phase-sub"><strong>${esc(state.leaderName)}</strong> is choosing a team of ${config.teamSize}…${questReq(config)}</div>
        </div>
        <div class="waiting-pulse">⏳</div>`;
    }
    return;
  }

  if (state.phase === 'team-vote' || state.phase === 'team-vote-result') {
    // Server masks everyone's vote value while phase is 'team-vote' — only who
    // voted is visible, not what. Track our own choice locally so we can still
    // tell the player what they picked without leaking it to anyone else.
    const teamKey = state.proposedTeam.join(',');
    if (teamKey !== myTeamVoteKey) { myTeamVote = null; myTeamVoteKey = teamKey; }
    const iHaveVoted = !!state.teamVotes[me];
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
      ${state.phase === 'team-vote' && !iHaveVoted ? `
        <div class="vote-btns">
          <button class="vote-btn approve-btn" id="btn-approve">✓ Approve</button>
          <button class="vote-btn reject-btn" id="btn-reject">✗ Reject</button>
        </div>` : ''}
      ${iHaveVoted && state.phase === 'team-vote' ? `<div class="voted-msg">${myTeamVote ? `You voted <strong>${myTeamVote === 'approve' ? '✓ Approve' : '✗ Reject'}</strong> — waiting for others…` : 'You voted — waiting for others…'}</div>` : ''}
      <div class="vote-roster">
        ${players.map(p => {
          const v = state.teamVotes[p.id];
          const cls = v === 'approve' ? 'approve' : v === 'reject' ? 'reject' : v === 'voted' ? 'pending' : '';
          const label = v === 'approve' ? '✓ Approve' : v === 'reject' ? '✗ Reject' : v === 'voted' ? '● Voted' : '…';
          return `<div class="vote-row ${cls}">
            <span>${esc(p.name)}</span>
            <span class="vote-tag">${label}</span>
          </div>`;
        }).join('')}
      </div>
      ${isLeader && state.phase === 'team-vote' && !allVoted ? `
        <button class="secondary-btn" id="btn-cancel-proposal" style="margin-top:16px;">↩ Change proposal</button>` : ''}`;

    if (state.phase === 'team-vote' && !iHaveVoted) {
      document.getElementById('btn-approve')?.addEventListener('click', () => { myTeamVote = 'approve'; socket.emit('team-vote', { vote: 'approve' }); });
      document.getElementById('btn-reject')?.addEventListener('click',  () => { myTeamVote = 'reject';  socket.emit('team-vote', { vote: 'reject' }); });
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
              <button class="qvote-btn fail-btn" id="qbtn-fail" ${myRole?.isEvil ? '' : 'disabled title="Good players can only Pass"'}>✘ Fail</button>
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
          if (!myRole?.isEvil) return;
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

  // Hide header and Continue until reveal is done
  document.getElementById('result-icon').textContent  = '🂠';
  document.getElementById('result-icon').className    = '';
  document.getElementById('result-title').textContent = 'Revealing…';
  document.getElementById('result-title').className   = 'result-title';

  const teamSize = state.proposedTeam.length;
  const failCount = res.fails;

  // Build card order: passes first, then fails last (most dramatic)
  // Each entry is true = pass, false = fail
  const passCount = teamSize - failCount;
  const cardOrder = [
    ...Array(passCount).fill(true),
    ...Array(failCount).fill(false),
  ];

  // Render all cards face-down initially
  let bodyHTML = `<div class="fail-cards" id="reveal-cards-row">`;
  for (let i = 0; i < teamSize; i++) {
    bodyHTML += `<div class="fail-card face-down" id="rcard-${i}">?</div>`;
  }
  bodyHTML += `</div>`;
  bodyHTML += `<div class="fail-summary" id="reveal-summary" style="opacity:0"></div>`;

  const passes   = state.campaignResults.filter(r => r === 'pass').length;
  const failures = state.campaignResults.filter(r => r === 'fail').length;
  bodyHTML += `<div class="camp-score" id="reveal-score" style="opacity:0"><span class="good">${passes} ✔</span> — <span class="evil">${failures} ✘</span></div>`;

  document.getElementById('result-body').innerHTML = bodyHTML;
  document.getElementById('result-continue-btn').style.display = 'none';
  overlay.style.display = 'flex';

  // Flip cards one by one with pauses; fails always last
  const CARD_DELAY = 1400; // ms between each card
  const FAIL_EXTRA_PAUSE = 1000; // extra suspense before first fail
  let totalDelay = 400; // initial pause before first card

  cardOrder.forEach((isPass, idx) => {
    const extraPause = (!isPass && idx === passCount) ? FAIL_EXTRA_PAUSE : 0;
    totalDelay += extraPause;
    const t = totalDelay;
    totalDelay += CARD_DELAY;

    setTimeout(() => {
      const card = document.getElementById(`rcard-${idx}`);
      if (!card) return;
      card.classList.remove('face-down');
      card.classList.add(isPass ? 'pass' : 'fail', 'flip-in');
      card.textContent = isPass ? '✔' : '✘';
    }, t);
  });

  // After all cards, show summary + result header
  setTimeout(() => {
    const passed = res.passed;
    document.getElementById('result-icon').textContent  = passed ? '⚔️' : '💀';
    document.getElementById('result-title').textContent = passed ? 'Quest Succeeded!' : 'Quest Failed!';
    document.getElementById('result-title').className   = passed ? 'result-title good' : 'result-title evil';

    const summaryEl = document.getElementById('reveal-summary');
    let summaryText = res.fails === 0 ? 'No fail cards — quest passes!'
      : res.fails === 1 ? '1 fail card played.'
      : `${res.fails} fail cards played.`;
    if (res.fails > 0 && res.failsNeeded > 1) summaryText += ` (needed ${res.failsNeeded} to fail)`;
    summaryEl.textContent = summaryText;
    summaryEl.style.transition = 'opacity 0.5s';
    summaryEl.style.opacity = '1';

    const scoreEl = document.getElementById('reveal-score');
    scoreEl.style.transition = 'opacity 0.5s';
    scoreEl.style.opacity = '1';

    const btn = document.getElementById('result-continue-btn');
    btn.style.display = '';
    btn.style.opacity = '0';
    btn.style.transition = 'opacity 0.4s';
    setTimeout(() => { btn.style.opacity = '1'; }, 50);
  }, totalDelay + 300);

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
