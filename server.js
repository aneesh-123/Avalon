const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ── Role helpers ──
const EVIL_ROLES = new Set(['Assassin','Morgana','Mordred','Oberon','Minion of Mordred']);
const isEvil   = r => EVIL_ROLES.has(r);
const isMordred = r => r === 'Mordred';
const isMorgana = r => r === 'Morgana';
const isMerlin  = r => r === 'Merlin';
const isOberon  = r => r === 'Oberon';

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomCode() { return Math.random().toString(36).substring(2, 7).toUpperCase(); }

const rooms = {};
function getRoom(code)     { return rooms[code]; }
function getRoomOf(sockId) { return Object.values(rooms).find(r => r.players.some(p => p.id === sockId)); }

// ── Lobby state (sent before game starts) ──
function lobbyState(room) {
  return {
    code: room.code,
    playerCount: room.playerCount,
    hostId: room.hostId,
    players: room.players.map(p => ({ id: p.id, name: p.name, ready: p.ready })),
    state: room.state,
  };
}

// ── Game state (sent during game) ──
function gameState(room) {
  return {
    phase: room.phase,
    players: room.players.map(p => ({ id: p.id, name: p.name })),
    leaderId: room.players[room.currentLeaderIndex]?.id,
    leaderName: room.players[room.currentLeaderIndex]?.name,
    currentCampaign: room.currentCampaign,
    campaignsConfig: room.campaignsConfig,
    campaignResults: room.campaignResults,
    proposedTeam: room.proposedTeam,
    teamVotes: room.teamVotes,           // public: {id -> 'approve'|'reject'}
    questVoteCount: Object.keys(room.questVotes || {}).length,  // anonymous count only
    consecutiveRejections: room.consecutiveRejections,
    lastTeamVoteResult: room.lastTeamVoteResult || null,
    lastQuestResult: room.lastQuestResult || null,
    winner: room.winner || null,
    winReason: room.winReason || null,
  };
}

// ── Role knowledge ──
function buildKnown(room, player) {
  const known = [];
  room.players.forEach(other => {
    if (other.id === player.id) return;
    const r = other.role;
    if (isMerlin(player.role)) {
      if (isEvil(r) && !isMordred(r)) known.push({ id: other.id, name: other.name, label: 'evil', css: 'known-evil' });
    } else if (player.role === 'Percival') {
      if (isMerlin(r) || isMorgana(r)) known.push({ id: other.id, name: other.name, label: 'Merlin or Morgana?', css: 'known-merlin' });
    } else if (isEvil(player.role) && !isOberon(player.role)) {
      if (isEvil(r) && !isOberon(r)) known.push({ id: other.id, name: other.name, label: 'evil ally', css: 'known-evil' });
    }
  });
  return known;
}

function buildRoleList(playerCount, roleConfig) {
  const { evilCount, goodSpecials, evilSpecials } = roleConfig;
  const goodCount   = playerCount - evilCount;
  const loyalCount  = goodCount  - 1 - goodSpecials.length;
  const minionCount = evilCount  - 1 - evilSpecials.length;
  return [
    'Merlin', ...goodSpecials, ...Array(Math.max(0, loyalCount)).fill('Loyal Servant'),
    'Assassin', ...evilSpecials, ...Array(Math.max(0, minionCount)).fill('Minion of Mordred'),
  ];
}

function assignRoles(room) {
  const roles = shuffle(buildRoleList(room.playerCount, room.roleConfig));
  room.players.forEach((p, i) => { p.role = roles[i]; });
  room.players.forEach(player => {
    io.to(player.id).emit('your-role', {
      role: player.role,
      isEvil: isEvil(player.role),
      known: buildKnown(room, player),
    });
  });
}

// ── Game phase logic ──
function beginGamePhase(room) {
  room.state = 'playing';
  room.currentLeaderIndex = Math.floor(Math.random() * room.players.length);
  room.currentCampaign = 0;
  room.campaignResults = [];
  room.consecutiveRejections = 0;
  room.phase = 'team-select';
  room.proposedTeam = [];
  room.teamVotes = {};
  room.questVotes = {};
  room.lastTeamVoteResult = null;
  room.lastQuestResult = null;
  room.resultHandled = false;
  io.to(room.code).emit('phase-update', gameState(room));
}

function resolveTeamVote(room) {
  const votes   = Object.values(room.teamVotes);
  const approves = votes.filter(v => v === 'approve').length;
  const rejects  = votes.filter(v => v === 'reject').length;
  const approved = approves > rejects;

  room.lastTeamVoteResult = {
    votes: room.players.map(p => ({ id: p.id, name: p.name, vote: room.teamVotes[p.id] || null })),
    approved,
  };

  if (approved) {
    room.consecutiveRejections = 0;
    room.phase = 'team-vote-result'; // show result briefly, then quest-vote
  } else {
    room.consecutiveRejections++;
    if (room.consecutiveRejections >= 5) {
      room.phase = 'game-over';
      room.winner = 'evil';
      room.winReason = '5 teams rejected in a row';
    } else {
      room.phase = 'team-vote-result'; // show result, then back to team-select
    }
  }
  room.resultHandled = false;
  io.to(room.code).emit('phase-update', gameState(room));
}

function advanceFromTeamVoteResult(room) {
  if (room.resultHandled) return;
  room.resultHandled = true;
  if (room.lastTeamVoteResult.approved) {
    room.phase = 'quest-vote';
    room.questVotes = {};
  } else if (room.winner) {
    // game over already set
  } else {
    room.currentLeaderIndex = (room.currentLeaderIndex + 1) % room.players.length;
    room.phase = 'team-select';
    room.proposedTeam = [];
    room.teamVotes = {};
  }
  io.to(room.code).emit('phase-update', gameState(room));
}

function resolveQuestVote(room) {
  const votes  = Object.values(room.questVotes);
  const fails  = votes.filter(v => v === 'fail').length;
  const config = room.campaignsConfig[room.currentCampaign];
  const passed = fails < config.failsNeeded;

  room.campaignResults.push(passed ? 'pass' : 'fail');
  room.lastQuestResult = { fails, failsNeeded: config.failsNeeded, passed };

  const total   = room.campaignsConfig.length;
  const toWin   = Math.ceil(total / 2);
  const passes  = room.campaignResults.filter(r => r === 'pass').length;
  const failures = room.campaignResults.filter(r => r === 'fail').length;

  if (passes >= toWin)   { room.winner = 'good'; room.winReason = null; }
  else if (failures >= toWin) { room.winner = 'evil'; room.winReason = null; }

  room.phase = 'quest-result';
  room.resultHandled = false;
  io.to(room.code).emit('phase-update', gameState(room));
}

function advanceFromQuestResult(room) {
  if (room.resultHandled) return;
  room.resultHandled = true;
  if (room.winner) {
    room.phase = 'game-over';
  } else {
    room.currentCampaign++;
    room.currentLeaderIndex = (room.currentLeaderIndex + 1) % room.players.length;
    room.phase = 'team-select';
    room.proposedTeam = [];
    room.teamVotes = {};
    room.questVotes = {};
    room.lastTeamVoteResult = null;
    room.lastQuestResult = null;
  }
  io.to(room.code).emit('phase-update', gameState(room));
}

// ── Socket handlers ──
io.on('connection', socket => {

  socket.on('rejoin-room', ({ code, name }) => {
    const room = getRoom(code);
    if (!room) { socket.emit('rejoin-error', 'Room not found.'); return; }
    const player = room.players.find(p => p.name.toLowerCase() === name.toLowerCase());
    if (!player) { socket.emit('rejoin-error', 'Name not found in that room.'); return; }
    const oldId = player.id;
    player.id = socket.id;
    if (room.hostId === oldId) room.hostId = socket.id;
    socket.join(code);
    socket.emit('rejoin-ok', { state: room.state });
    if (room.state === 'playing') {
      socket.emit('game-start');
      socket.emit('your-role', { role: player.role, isEvil: isEvil(player.role), known: buildKnown(room, player) });
      socket.emit('phase-update', gameState(room));
    } else {
      io.to(code).emit('lobby-update', lobbyState(room));
    }
  });

  socket.on('create-room', ({ playerCount, roleConfig, campaignsConfig, name }) => {
    const code = randomCode();
    rooms[code] = {
      code, hostId: socket.id, playerCount, roleConfig, campaignsConfig,
      players: [{ id: socket.id, name, ready: false, role: null }],
      state: 'lobby',
    };
    socket.join(code);
    socket.emit('room-created', { code });
    io.to(code).emit('lobby-update', lobbyState(rooms[code]));
  });

  socket.on('join-room', ({ code, name }) => {
    const room = getRoom(code);
    if (!room)                           { socket.emit('join-error', 'Room not found.'); return; }
    if (room.state !== 'lobby')          { socket.emit('join-error', 'Game already started.'); return; }
    if (room.players.length >= room.playerCount) { socket.emit('join-error', 'Room is full.'); return; }
    if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) { socket.emit('join-error', 'Name taken.'); return; }
    room.players.push({ id: socket.id, name, ready: false, role: null });
    socket.join(code);
    socket.emit('room-joined', { code });
    io.to(code).emit('lobby-update', lobbyState(room));
  });

  socket.on('toggle-ready', () => {
    const room = getRoomOf(socket.id);
    if (!room || room.state !== 'lobby') return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    player.ready = !player.ready;
    io.to(room.code).emit('lobby-update', lobbyState(room));
    const full     = room.players.length === room.playerCount;
    const majority = room.players.filter(p => p.ready).length > room.playerCount / 2;
    if (full && majority) {
      assignRoles(room);
      io.to(room.code).emit('game-start');
      beginGamePhase(room);
    }
  });

  socket.on('propose-team', ({ team }) => {
    const room = getRoomOf(socket.id);
    if (!room || room.phase !== 'team-select') return;
    const leader = room.players[room.currentLeaderIndex];
    if (leader.id !== socket.id) return;
    const config = room.campaignsConfig[room.currentCampaign];
    if (!Array.isArray(team) || team.length !== config.teamSize) return;
    const ids = new Set(room.players.map(p => p.id));
    if (!team.every(id => ids.has(id))) return;
    room.proposedTeam = team;
    room.phase = 'team-vote';
    room.teamVotes = {};
    io.to(room.code).emit('phase-update', gameState(room));
  });

  socket.on('team-vote', ({ vote }) => {
    const room = getRoomOf(socket.id);
    if (!room || room.phase !== 'team-vote') return;
    if (!['approve','reject'].includes(vote)) return;
    if (room.teamVotes[socket.id]) return; // already voted
    room.teamVotes[socket.id] = vote;
    io.to(room.code).emit('phase-update', gameState(room));
    if (Object.keys(room.teamVotes).length === room.players.length) {
      resolveTeamVote(room);
    }
  });

  socket.on('continue-game', () => {
    const room = getRoomOf(socket.id);
    if (!room) return;
    if (room.phase === 'team-vote-result') advanceFromTeamVoteResult(room);
    else if (room.phase === 'quest-result') advanceFromQuestResult(room);
  });

  socket.on('quest-vote', ({ vote }) => {
    const room = getRoomOf(socket.id);
    if (!room || room.phase !== 'quest-vote') return;
    if (!room.proposedTeam.includes(socket.id)) return;
    if (!['pass','fail'].includes(vote)) return;
    if (room.questVotes[socket.id]) return;
    room.questVotes[socket.id] = vote;
    io.to(room.code).emit('phase-update', gameState(room));
    if (Object.keys(room.questVotes).length === room.proposedTeam.length) {
      resolveQuestVote(room);
    }
  });

  socket.on('disconnect', () => {
    const room = getRoomOf(socket.id);
    if (!room) return;
    if (room.state === 'lobby') {
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) { delete rooms[room.code]; return; }
      if (room.hostId === socket.id) room.hostId = room.players[0].id;
      io.to(room.code).emit('lobby-update', lobbyState(room));
    } else {
      io.to(room.code).emit('player-disconnected', { name: room.players.find(p => p.id === socket.id)?.name });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Avalon running on http://localhost:${PORT}`));
