const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.get('/ping', (req, res) => res.send('ok'));

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
  const n = room.players.length;
  return {
    phase: room.phase,
    players: room.players.map(p => ({ id: p.id, name: p.name })),
    leaderId: room.players[room.currentLeaderIndex]?.id,
    leaderName: room.players[room.currentLeaderIndex]?.name,
    leaderQueue: Array.from({length: n}, (_, i) => room.players[(room.currentLeaderIndex + i) % n].name),
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
    assassinId: room.assassinId || null,
    specialRoles: room.players ? [...new Set(room.players.map(p => p.role).filter(r => r && r !== 'Loyal Servant' && r !== 'Minion of Mordred'))] : [],
    revealedRoles: room.phase === 'game-over'
      ? room.players.map(p => ({ id: p.id, name: p.name, role: p.role }))
      : null,
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
  const assassin = room.players.find(p => p.role === 'Assassin');
  if (assassin) room.assassinId = assassin.id;
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

  if (passes >= toWin)        { room.pendingAssassination = true; }
  else if (failures >= toWin) { room.winner = 'evil'; room.winReason = null; }

  room.phase = 'quest-result';
  room.resultHandled = false;
  io.to(room.code).emit('phase-update', gameState(room));
}

function advanceFromQuestResult(room) {
  if (room.resultHandled) return;
  room.resultHandled = true;
  if (room.pendingAssassination) {
    room.pendingAssassination = false;
    room.phase = 'assassination';
  } else if (room.winner) {
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

  socket.on('request-sync', () => {
    const room = getRoomOf(socket.id);
    if (!room) return;
    if (room.state === 'playing') socket.emit('phase-update', gameState(room));
    else socket.emit('lobby-update', lobbyState(room));
  });

  socket.on('rejoin-room', ({ code, name }) => {
    const room = getRoom(code);
    if (!room) { socket.emit('rejoin-error', 'Room not found.'); return; }
    const player = room.players.find(p => p.name.toLowerCase() === name.toLowerCase());
    if (!player) { socket.emit('rejoin-error', 'Name not found in that room.'); return; }

    // Update socket ID if it changed (reconnect with new socket)
    const oldId = player.id;
    if (oldId !== socket.id) {
      player.id = socket.id;
      if (room.hostId === oldId) room.hostId = socket.id;
    }
    socket.join(code);
    socket.emit('rejoin-ok', { state: room.state });

    if (room.state === 'playing') {
      socket.emit('game-start');
      socket.emit('your-role', { role: player.role, isEvil: isEvil(player.role), known: buildKnown(room, player) });
      socket.emit('phase-update', gameState(room));
      room.disconnected = room.disconnected || new Set();
      room.disconnected.delete(player.name);
      if (room.disconnected.size === 0) {
        io.to(code).emit('game-resumed');
      } else {
        socket.emit('game-paused', { disconnected: [...room.disconnected] });
      }
    } else {
      // Lobby: send full lobby state to everyone so all screens sync
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
    const allReady = room.players.every(p => p.ready);
    if (full && allReady) {
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
    room.teamVotes = { [socket.id]: 'approve' }; // leader auto-approves
    io.to(room.code).emit('phase-update', gameState(room));
    if (Object.keys(room.teamVotes).length === room.players.length) resolveTeamVote(room);
  });

  socket.on('team-vote', ({ vote }) => {
    const room = getRoomOf(socket.id);
    if (!room || room.phase !== 'team-vote') return;
    if (!['approve','reject'].includes(vote)) return;
    if (room.teamVotes[socket.id]) return; // already voted
    room.teamVotes[socket.id] = vote;
    io.to(room.code).emit('phase-update', gameState(room));
    if (Object.keys(room.teamVotes).length === room.players.length) resolveTeamVote(room);
  });

  socket.on('continue-game', () => {
    const room = getRoomOf(socket.id);
    if (!room) return;
    if (room.phase === 'team-vote-result') advanceFromTeamVoteResult(room);
    else if (room.phase === 'quest-result') advanceFromQuestResult(room);
  });

  socket.on('cancel-proposal', () => {
    const room = getRoomOf(socket.id);
    if (!room || room.phase !== 'team-vote') return;
    if (room.players[room.currentLeaderIndex].id !== socket.id) return;
    room.phase = 'team-select';
    room.proposedTeam = [];
    room.teamVotes = {};
    io.to(room.code).emit('phase-update', gameState(room));
  });

  socket.on('quest-vote', ({ vote }) => {
    const room = getRoomOf(socket.id);
    if (!room || (room.phase !== 'quest-vote' && room.phase !== 'quest-vote-ready')) return;
    if (!room.proposedTeam.includes(socket.id)) return;
    if (!['pass','fail'].includes(vote)) return;
    room.questVotes[socket.id] = vote;
    const allQuestVoted = Object.keys(room.questVotes).length === room.proposedTeam.length;
    if (allQuestVoted) room.phase = 'quest-vote-ready';
    io.to(room.code).emit('phase-update', gameState(room));
  });

  socket.on('assassinate', ({ targetId }) => {
    const room = getRoomOf(socket.id);
    if (!room || room.phase !== 'assassination') return;
    if (socket.id !== room.assassinId) return;
    const target = room.players.find(p => p.id === targetId);
    if (!target) return;
    if (target.role === 'Merlin') {
      room.winner = 'evil';
      room.winReason = 'The Assassin identified Merlin!';
    } else {
      room.winner = 'good';
      room.winReason = `${target.name} was not Merlin — Good prevails!`;
    }
    room.phase = 'game-over';
    io.to(room.code).emit('phase-update', gameState(room));
  });

  socket.on('reveal-quest', () => {
    const room = getRoomOf(socket.id);
    if (!room || room.phase !== 'quest-vote-ready') return;
    if (room.players[room.currentLeaderIndex].id !== socket.id) return;
    resolveQuestVote(room);
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
      const player = room.players.find(p => p.id === socket.id);
      if (!player) return;
      room.disconnected = room.disconnected || new Set();
      room.disconnected.add(player.name);
      io.to(room.code).emit('game-paused', { disconnected: [...room.disconnected] });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Avalon running on http://localhost:${PORT}`));
