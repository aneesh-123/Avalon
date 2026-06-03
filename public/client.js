const socket = io();

let myId = null;
let myRole = null;
let myVisibleAs = {};
let roomCode = null;
let isHost = false;
let gameState = null;
let selectedTeam = [];

// ---- DOM helpers ----
const $ = id => document.getElementById(id);

function show(id) { $(id).style.display = 'block'; }
function hide(id) { $(id).style.display = 'none'; }

function notify(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'notification' + (type ? ' ' + type : '');
  el.textContent = msg;
  $('notifications').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ---- Entry Screen ----
$('create-btn').onclick = () => {
  const name = $('player-name').value.trim();
  if (!name) { $('entry-error').textContent = 'Enter your name'; return; }
  socket.emit('create-room', { name });
};

$('join-btn').onclick = () => {
  const name = $('player-name').value.trim();
  const code = $('room-code-input').value.trim().toUpperCase();
  if (!name) { $('entry-error').textContent = 'Enter your name'; return; }
  if (code.length < 3) { $('entry-error').textContent = 'Enter room code'; return; }
  socket.emit('join-room', { code, name });
};

socket.on('room-created', ({ code, playerId }) => {
  myId = playerId;
  roomCode = code;
  isHost = true;
  $('entry-error').textContent = '';
  hide('entry-screen');
  show('waiting-room');
  $('display-code').textContent = code;
  show('host-controls');
  hide('guest-wait');
});

socket.on('room-joined', ({ code, playerId }) => {
  myId = playerId;
  roomCode = code;
  isHost = false;
  $('entry-error').textContent = '';
  hide('entry-screen');
  show('waiting-room');
  $('display-code').textContent = code;
  hide('host-controls');
  show('guest-wait');
});

$('start-btn').onclick = () => {
  socket.emit('start-game');
};

// ---- Game State ----
socket.on('game-state', (state) => {
  gameState = state;
  renderState(state);
});

socket.on('your-role', (info) => {
  myRole = info.role;
  myVisibleAs = info.visibleAs || {};
  showRoleModal(info);
});

function showRoleModal(info) {
  const modal = $('role-modal');
  if (!modal) return;
  const evilRoles = ['Assassin','Morgana','Mordred','Oberon','Minion of Mordred'];
  const evil = evilRoles.includes(info.role);

  const roleDescriptions = {
    'Merlin': 'You know who the evil players are (except Mordred). Guide the good side without revealing yourself.',
    'Percival': 'You know who Merlin and Morgana are, but not which is which. Protect Merlin.',
    'Loyal Servant': 'You have no special knowledge. Vote wisely and support good quests.',
    'Assassin': 'You are evil. If good wins the quests, you get one chance to assassinate Merlin.',
    'Morgana': 'You are evil. You appear as Merlin to Percival. Deceive and sabotage.',
    'Mordred': 'You are evil but hidden from Merlin. Use this advantage wisely.',
    'Oberon': 'You are evil but act alone — evil players don\'t know you and you don\'t know them.',
  };

  const knownPlayers = Object.entries(info.visibleAs || {});
  let knownHtml = '';
  if (knownPlayers.length > 0) {
    knownHtml = '<div style="margin-top:12px; background:#0f346088; border-radius:8px; padding:10px; text-align:left;">';
    knownHtml += '<div class="label" style="margin-bottom:6px;">Information you know:</div>';
    knownPlayers.forEach(([id, appearance]) => {
      const player = (info.players || []).find(p => p.id === id);
      const color = appearance === 'evil' || appearance === 'evil ally' ? '#ff8888' : '#cc88ff';
      knownHtml += `<div style="margin-bottom:4px;"><strong style="color:${color};">${player?.name || id}</strong>: ${appearance}</div>`;
    });
    knownHtml += '</div>';
  }

  modal.querySelector('#role-modal-content').innerHTML = `
    <div class="role-banner ${evil ? 'evil' : 'good'}">
      <div class="role-name">${info.role}</div>
      <div class="role-allegiance">${evil ? 'Minion of Mordred (Evil)' : 'Loyal Servant of Arthur (Good)'}</div>
    </div>
    <p style="color:#bbb; margin-top:10px; font-size:0.9rem; text-align:left;">${roleDescriptions[info.role] || ''}</p>
    ${knownHtml}
  `;

  modal.style.display = 'flex';

  const btn = $('role-ready-btn');
  btn.disabled = false;
  btn.textContent = 'I understand my role — Ready!';
  btn.onclick = () => {
    btn.disabled = true;
    btn.textContent = 'Waiting for others...';
    $('role-ready-status').textContent = 'All players must be ready to proceed.';
    socket.emit('player-ready');
  };
}

socket.on('all-ready', () => {
  const modal = $('role-modal');
  if (modal) modal.style.display = 'none';
});

socket.on('error', (msg) => {
  notify('Error: ' + msg, 'evil');
});

socket.on('team-vote-result', (result) => {
  const approved = result.approved;
  const label = approved ? 'Team APPROVED' : 'Team REJECTED';
  notify(label, approved ? 'good' : 'evil');
  // Show in the vote log panel if game area visible
  const log = $('vote-log');
  if (log) {
    const entry = document.createElement('div');
    entry.style.marginBottom = '8px';
    entry.innerHTML = `<strong style="color:${approved?'#88ff88':'#ff8888'}">${label}</strong><div class="vote-result-row">${
      result.votes.map(v => `<span class="vote-badge ${v.vote}">${v.name}${v.id===myId?'<span class="tag-you">you</span>':''}</span>`).join('')
    }</div>`;
    log.prepend(entry);
  }
});

socket.on('quest-result', (result) => {
  const passed = result.result === 'pass';
  notify(`Quest ${passed ? 'SUCCEEDED' : 'FAILED'} — ${result.failCount} fail vote(s)`, passed ? 'good' : 'evil');
});

socket.on('assassination-phase', ({ assassinId, assassinName }) => {
  if (myId === assassinId) {
    notify('You are the Assassin. Choose Merlin to win!', 'evil');
  } else {
    notify(`${assassinName} is the Assassin. They must now choose Merlin...`, 'evil');
  }
});

socket.on('assassination-result', ({ targetName, targetRole, winner }) => {
  const msg = winner === 'evil'
    ? `${targetName} was ${targetRole} — Evil wins by assassination!`
    : `${targetName} was ${targetRole}, not Merlin — Good wins!`;
  notify(msg, winner === 'evil' ? 'evil' : 'good');
});

socket.on('reveal-roles', (players) => {
  renderRoleReveal(players);
});

socket.on('player-disconnected', ({ name }) => {
  notify(`${name || 'A player'} disconnected`, '');
});

// ---- Render ----
function renderState(state) {
  if (state.state === 'lobby') {
    renderLobby(state);
  } else if (state.state === 'role-reveal') {
    // Role reveal is handled by the 'your-role' event modal — nothing to do here
  } else {
    hide('entry-screen');
    hide('waiting-room');
    const modal = $('role-modal');
    if (modal) modal.style.display = 'none';
    show('game-area');
    renderGame(state);
  }
}

function renderLobby(state) {
  const list = $('waiting-player-list');
  list.innerHTML = state.players.map(p =>
    `<li class="${p.id === myId ? 'is-you' : ''}">${p.name}${p.id === myId ? ' (you)' : ''}${state.host === p.id ? ' (host)' : ''}</li>`
  ).join('');
  $('player-count').textContent = state.players.length;
  if (isHost) {
    show('host-controls');
    hide('guest-wait');
    const btn = $('start-btn');
    btn.disabled = state.players.length < 5;
    btn.textContent = state.players.length < 5
      ? `Start Game (need ${5 - state.players.length} more)`
      : `Start Game (${state.players.length} players)`;
  } else {
    hide('host-controls');
    show('guest-wait');
  }
}

function renderGame(state) {
  if (!$('game-area').innerHTML.includes('game-layout')) {
    buildGameUI();
  }
  updateQuestTrack(state);
  updateRejectionTrack(state);
  updatePlayers(state);
  updatePhaseArea(state);
  updateSidebar(state);
  if (state.state === 'ended') renderEndScreen(state);
}

function buildGameUI() {
  $('game-area').innerHTML = `
    <div class="container" style="max-width:960px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:8px; padding-top:12px;">
        <h2 style="color:#c9a96e; margin:0;">Avalon</h2>
        <div id="game-header-info" style="font-size:0.85rem; color:#888;">Room: <span id="header-room-code">${roomCode || ''}</span></div>
      </div>
      <div class="game-layout">
        <div id="main-col">
          <div class="panel" id="quest-panel">
            <h3>Quest Track</h3>
            <div class="quest-track" id="quest-track"></div>
            <div style="margin-top:10px;">
              <span class="label">Rejected: </span>
              <div class="rejection-track" id="rejection-track"></div>
            </div>
          </div>
          <div class="panel" id="phase-panel">
            <div class="phase-title" id="phase-title"></div>
            <div class="phase-desc" id="phase-desc"></div>
            <div id="phase-actions"></div>
          </div>
          <div class="panel" id="vote-log-panel">
            <h3>Vote History</h3>
            <div id="vote-log"></div>
          </div>
        </div>
        <div id="side-col">
          <div class="panel" id="role-panel"></div>
          <div class="panel" id="players-panel">
            <h3>Players</h3>
            <div class="players-grid" id="players-grid"></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function updateQuestTrack(state) {
  const track = $('quest-track');
  if (!track) return;
  const n = state.players.length;
  const sizes = {5:[2,3,2,3,3],6:[2,3,4,3,4],7:[2,3,3,4,4],8:[3,4,4,5,5],9:[3,4,4,5,5],10:[3,4,4,5,5]};
  const teamSizes = sizes[n] || sizes[5];
  track.innerHTML = [0,1,2,3,4].map(i => {
    let cls = '';
    let label = '';
    if (i < state.questResults.length) {
      cls = state.questResults[i];
      label = state.questResults[i] === 'pass' ? '✓' : '✗';
    } else if (i === state.currentQuest && state.state === 'playing') {
      cls = 'current';
      label = '★';
    }
    const needTwo = n >= 7 && i === 3;
    return `<div class="quest-dot ${cls}" title="Quest ${i+1}: ${teamSizes[i]} players${needTwo?' (need 2 fails)':''}">
      <span>${label || (i+1)}</span>
      <span style="font-size:0.65rem">${teamSizes[i]}${needTwo?'**':''}</span>
    </div>`;
  }).join('');
}

function updateRejectionTrack(state) {
  const track = $('rejection-track');
  if (!track) return;
  track.innerHTML = [0,1,2,3,4].map(i =>
    `<div class="rejection-dot ${i < state.consecutiveRejections ? 'filled' : ''}"></div>`
  ).join('');
}

function updatePlayers(state) {
  const grid = $('players-grid');
  if (!grid) return;
  const leader = state.currentLeaderId;
  grid.innerHTML = state.players.map(p => {
    let classes = ['player-chip'];
    let badge = '';
    if (p.id === myId) classes.push('is-you');
    if (p.id === leader) { classes.push('is-leader'); badge += '<span class="chip-badge">Leader</span>'; }
    if (state.proposedTeam.includes(p.id)) { classes.push('on-team'); badge += '<span class="chip-badge">On Quest</span>'; }
    if (myVisibleAs[p.id] === 'evil') { classes.push('evil-known'); badge += '<span class="chip-badge">⚡Evil</span>'; }
    if (myVisibleAs[p.id] === 'evil ally') { classes.push('evil-known'); badge += '<span class="chip-badge">ally</span>'; }
    if (myVisibleAs[p.id] === 'Merlin or Morgana') { classes.push('merlin-known'); badge += '<span class="chip-badge">M/M</span>'; }
    return `<div class="${classes.join(' ')}" data-id="${p.id}">${p.name}${p.id === myId ? ' (you)' : ''}${badge}</div>`;
  }).join('');
}

function updatePhaseArea(state) {
  const title = $('phase-title');
  const desc = $('phase-desc');
  const actions = $('phase-actions');
  if (!title) return;

  const me = state.players.find(p => p.id === myId);
  const leader = state.players.find(p => p.id === state.currentLeaderId);
  const amLeader = state.currentLeaderId === myId;
  const onTeam = state.proposedTeam.includes(myId);

  if (state.state === 'ended') {
    title.textContent = 'Game Over';
    desc.textContent = '';
    actions.innerHTML = '';
    return;
  }

  if (state.state === 'assassination') {
    title.textContent = 'Assassination Phase';
    renderAssassinationPhase(state, desc, actions);
    return;
  }

  if (state.phase === 'team-building') {
    title.textContent = `Quest ${state.currentQuest + 1} — Team Selection`;
    desc.textContent = amLeader
      ? `You are the leader. Choose ${state.teamSize} players for the quest.`
      : `${leader?.name || 'Leader'} is choosing a team of ${state.teamSize}.`;

    if (amLeader) {
      selectedTeam = [];
      renderTeamBuilder(state, actions);
    } else {
      actions.innerHTML = `<p style="color:#888;font-style:italic">Waiting for ${leader?.name} to propose a team...</p>`;
    }
  } else if (state.phase === 'team-vote') {
    const voted = state.teamVoteCount;
    const total = state.players.length;
    title.textContent = 'Team Vote';
    const teamNames = state.proposedTeam.map(id => state.players.find(p=>p.id===id)?.name).join(', ');
    desc.textContent = `Proposed team: ${teamNames}. (${voted}/${total} voted)`;
    renderTeamVote(state, actions);
  } else if (state.phase === 'quest-vote') {
    const voted = state.questVoteCount;
    const total = state.proposedTeam.length;
    title.textContent = 'Quest Vote';
    if (onTeam) {
      desc.textContent = `You are on the quest! Vote success or fail. (${voted}/${total} voted)`;
      renderQuestVote(state, actions);
    } else {
      desc.textContent = `Quest in progress... (${voted}/${total} voted)`;
      actions.innerHTML = `<p style="color:#888;font-style:italic">Waiting for quest results...</p>`;
    }
  }
}

function renderTeamBuilder(state, actions) {
  const needed = state.teamSize;
  actions.innerHTML = `
    <p style="margin-bottom:10px; color:#bbb;">Click players to select (${needed} needed):</p>
    <div class="players-grid" id="team-select-grid"></div>
    <div style="margin-top:12px;">
      <button class="btn btn-primary" id="propose-btn" disabled>Propose Team (0/${needed})</button>
    </div>
  `;

  const grid = $('team-select-grid');
  selectedTeam = [];

  function renderChips() {
    grid.innerHTML = state.players.map(p => {
      const sel = selectedTeam.includes(p.id);
      return `<div class="player-chip selectable ${sel ? 'selected' : ''} ${p.id === myId ? 'is-you' : ''}"
        data-id="${p.id}">${p.name}${p.id === myId ? ' (you)' : ''}</div>`;
    }).join('');

    grid.querySelectorAll('.player-chip').forEach(chip => {
      chip.onclick = () => {
        const id = chip.dataset.id;
        if (selectedTeam.includes(id)) {
          selectedTeam = selectedTeam.filter(x => x !== id);
        } else if (selectedTeam.length < needed) {
          selectedTeam.push(id);
        }
        renderChips();
        const btn = $('propose-btn');
        btn.disabled = selectedTeam.length !== needed;
        btn.textContent = `Propose Team (${selectedTeam.length}/${needed})`;
      };
    });
  }

  renderChips();

  $('propose-btn').onclick = () => {
    if (selectedTeam.length === needed) {
      socket.emit('propose-team', { team: [...selectedTeam] });
    }
  };
}

function renderTeamVote(state, actions) {
  const alreadyVoted = false; // server allows re-vote (last vote wins); just show buttons
  actions.innerHTML = `
    <div class="vote-buttons">
      <button class="btn btn-good" id="approve-btn">✓ Approve</button>
      <button class="btn btn-evil" id="reject-btn">✗ Reject</button>
    </div>
    <div id="my-vote-display" style="margin-top:8px; color:#888; font-style:italic;"></div>
  `;

  $('approve-btn').onclick = () => {
    socket.emit('team-vote', { vote: 'approve' });
    $('my-vote-display').textContent = 'You voted: Approve';
    $('approve-btn').disabled = true;
    $('reject-btn').disabled = true;
  };
  $('reject-btn').onclick = () => {
    socket.emit('team-vote', { vote: 'reject' });
    $('my-vote-display').textContent = 'You voted: Reject';
    $('approve-btn').disabled = true;
    $('reject-btn').disabled = true;
  };
}

function renderQuestVote(state, actions) {
  const isEvil = myRole && ['Assassin','Morgana','Mordred','Oberon','Minion of Mordred'].includes(myRole);
  actions.innerHTML = `
    <div class="vote-buttons">
      <button class="btn btn-good" id="success-btn">⚔ Success</button>
      ${isEvil ? '<button class="btn btn-evil" id="fail-btn">💀 Fail</button>' : ''}
    </div>
    <div id="my-quest-display" style="margin-top:8px; color:#888; font-style:italic;"></div>
  `;

  $('success-btn').onclick = () => {
    socket.emit('quest-vote', { vote: 'success' });
    $('my-quest-display').textContent = 'You voted: Success';
    $('success-btn').disabled = true;
    const fb = $('fail-btn');
    if (fb) fb.disabled = true;
  };
  const fb = $('fail-btn');
  if (fb) fb.onclick = () => {
    socket.emit('quest-vote', { vote: 'fail' });
    $('my-quest-display').textContent = 'You voted: Fail';
    $('success-btn').disabled = true;
    fb.disabled = true;
  };
}

function renderAssassinationPhase(state, desc, actions) {
  const amAssassin = myRole === 'Assassin';
  if (amAssassin) {
    desc.textContent = 'Good has won the quests. As the Assassin, choose who you think Merlin is. If correct, Evil wins!';
    actions.innerHTML = `
      <div class="assassination-panel">
        <h2>Choose Merlin</h2>
        <div class="players-grid" id="assassination-grid" style="justify-content:center; margin-top:12px;"></div>
        <button class="btn btn-danger" id="assassinate-btn" disabled style="margin-top:16px;">Assassinate</button>
      </div>
    `;

    let targetId = null;
    const grid = $('assassination-grid');
    grid.innerHTML = state.players
      .filter(p => p.id !== myId)
      .map(p => `<div class="player-chip selectable" data-id="${p.id}">${p.name}</div>`).join('');

    grid.querySelectorAll('.player-chip').forEach(chip => {
      chip.onclick = () => {
        grid.querySelectorAll('.player-chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
        targetId = chip.dataset.id;
        $('assassinate-btn').disabled = false;
      };
    });

    $('assassinate-btn').onclick = () => {
      if (targetId) {
        socket.emit('assassinate', { targetId });
        $('assassinate-btn').disabled = true;
      }
    };
  } else {
    desc.textContent = 'Good has won the quests! The Assassin is choosing who to assassinate...';
    actions.innerHTML = `<p style="color:#888; font-style:italic">Waiting for the Assassin to choose...</p>`;
  }
}

function updateSidebar(state) {
  const rolePanel = $('role-panel');
  if (!rolePanel || !myRole) return;

  const evilRoles = ['Assassin','Morgana','Mordred','Oberon','Minion of Mordred'];
  const evil = evilRoles.includes(myRole);

  let knownInfo = '';
  const knownPlayers = Object.entries(myVisibleAs);
  if (knownPlayers.length > 0) {
    knownInfo = `<div style="margin-top:10px; font-size:0.85rem; color:#bbb;">
      <div class="label" style="margin-bottom:4px;">You can see:</div>
      ${knownPlayers.map(([id, info]) => {
        const p = state.players.find(p => p.id === id);
        return `<div>${p?.name || id}: <strong>${info}</strong></div>`;
      }).join('')}
    </div>`;
  }

  rolePanel.innerHTML = `
    <h3>Your Role</h3>
    <div class="role-banner ${evil ? 'evil' : 'good'}">
      <div class="role-name">${myRole}</div>
      <div class="role-allegiance">${evil ? 'Evil — Minions of Mordred' : 'Good — Loyal to Arthur'}</div>
    </div>
    ${knownInfo}
  `;
}

function renderEndScreen(state) {
  const main = $('main-col');
  if (!main) return;
  const winner = state.winner;
  const existingEnd = $('end-screen');
  if (existingEnd) return;

  const div = document.createElement('div');
  div.id = 'end-screen';
  div.className = 'panel win-screen';

  let rolesHtml = '';
  if (state.revealedRoles && state.revealedRoles.length > 0) {
    const evilRoles = new Set(['Assassin','Morgana','Mordred','Oberon','Minion of Mordred']);
    rolesHtml = `<table class="roles-table">
      <tr><th>Player</th><th>Role</th><th>Side</th></tr>
      ${state.revealedRoles.map(p => {
        const evil = evilRoles.has(p.role);
        return `<tr>
          <td>${p.name}${p.id === myId ? ' <span class="tag-you">you</span>' : ''}</td>
          <td class="${evil ? 'role-evil' : 'role-good'}">${p.role}</td>
          <td class="${evil ? 'role-evil' : 'role-good'}">${evil ? 'Evil' : 'Good'}</td>
        </tr>`;
      }).join('')}
    </table>`;
  }

  div.innerHTML = `
    <div class="win-title ${winner}">${winner === 'good' ? 'Good Wins!' : 'Evil Wins!'}</div>
    <p style="color:#bbb; margin-bottom:16px;">${
      winner === 'good' ? 'The forces of Arthur have prevailed!' : 'The forces of Mordred have triumphed!'
    }</p>
    <div id="roles-reveal-container">${rolesHtml}</div>
    <button class="btn btn-primary" style="margin-top:24px;" onclick="location.reload()">Play Again</button>
  `;
  main.prepend(div);
}

function renderRoleReveal(players) {
  const container = $('roles-reveal-container');
  if (!container) return;
  const evilRoles = new Set(['Assassin','Morgana','Mordred','Oberon','Minion of Mordred']);
  container.innerHTML = `
    <table class="roles-table">
      <tr><th>Player</th><th>Role</th><th>Side</th></tr>
      ${players.map(p => {
        const evil = evilRoles.has(p.role);
        return `<tr>
          <td>${p.name}${p.id === myId ? ' <span class="tag-you">you</span>' : ''}</td>
          <td class="${evil ? 'role-evil' : 'role-good'}">${p.role}</td>
          <td class="${evil ? 'role-evil' : 'role-good'}">${evil ? 'Evil' : 'Good'}</td>
        </tr>`;
      }).join('')}
    </table>
  `;
}
