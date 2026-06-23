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
    questHistory: (room.questHistory || []).map(h => ({
      ...h,
      // Only reveal who voted what on quests at game-over
      questVoteBreakdown: room.phase === 'game-over' ? h.questVoteBreakdown : undefined,
    })),
    pendingDispute: room.pendingDispute || null,
    ladyHolder: room.ladyHolder || null,
    ladyHolderName: room.players.find(p => p.id === room.ladyHolder)?.name || null,
    ladyHistory: room.ladyHistory || [],
    ladyUsed: room.ladyUsed ? [...room.ladyUsed] : [],
    winner: room.winner || null,
    winReason: room.winReason || null,
    assassinId: room.assassinId || null,
    specialRoles: room.players ? [...new Set(room.players.map(p => p.role).filter(r => r && r !== 'Loyal Servant' && r !== 'Minion of Mordred'))] : [],
    rolesInGame: room.players ? room.players.map(p => p.role).filter(Boolean) : [],
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
  room.questHistory = [];
  room.consecutiveRejections = 0;
  room.phase = 'team-select';
  room.proposedTeam = [];
  room.teamVotes = {};
  room.questVotes = {};
  room.lastTeamVoteResult = null;
  room.lastQuestResult = null;
  room.resultHandled = false;
  // Lady of the Lake: token starts with player to the right of first leader
  if (room.roleConfig.ladyOfLake && room.players.length > 1) {
    const holderIndex = (room.currentLeaderIndex + 1) % room.players.length;
    room.ladyHolder = room.players[holderIndex].id;
    room.ladyUsed = new Set([room.players[holderIndex].id]); // can't re-investigate past holders
    room.ladyHistory = [];
    room.ladyPendingResult = null; // { targetId, alignment } — private, not in gameState
  } else {
    room.ladyHolder = null;
  }
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
    room.approvedTeamVote = room.lastTeamVoteResult; // save for questHistory
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
  room.questHistory = room.questHistory || [];

  // Build quest vote breakdown (revealed only at game-over)
  const questVoteBreakdown = Object.entries(room.questVotes).map(([id, vote]) => {
    const p = room.players.find(q => q.id === id);
    return { name: p ? p.name : '?', vote };
  });

  room.questHistory.push({
    campaign: room.currentCampaign,
    team: room.proposedTeam.map(id => { const p = room.players.find(q => q.id === id); return p ? p.name : '?'; }),
    leaderName: room.players[room.currentLeaderIndex]?.name,
    teamVotes: room.approvedTeamVote?.votes || [],
    questVoteBreakdown, // private until game-over
    fails,
    failsNeeded: config.failsNeeded,
    passed,
  });

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
    const total = room.campaignsConfig.length;
    // Lady of the Lake triggers after quests 2 through (total-1), i.e. not after the last quest
    const useLady = room.ladyHolder && room.currentCampaign < total - 1 &&
      room.currentCampaign >= 1; // skip after quest 1, use after 2, 3, 4...
    room.currentCampaign++;
    room.currentLeaderIndex = (room.currentLeaderIndex + 1) % room.players.length;
    if (useLady) {
      room.phase = 'lady-of-lake';
      room.ladyPendingResult = null;
      io.to(room.code).emit('phase-update', gameState(room));
      return;
    }
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

    // Update socket ID and remap all ID references if it changed
    const oldId = player.id;
    if (oldId !== socket.id) {
      player.id = socket.id;
      if (room.hostId === oldId) room.hostId = socket.id;
      // Remap vote keys so vote roster doesn't show "?"
      if (room.teamVotes?.[oldId] !== undefined) {
        room.teamVotes[socket.id] = room.teamVotes[oldId];
        delete room.teamVotes[oldId];
      }
      if (room.questVotes?.[oldId] !== undefined) {
        room.questVotes[socket.id] = room.questVotes[oldId];
        delete room.questVotes[oldId];
      }
      if (room.proposedTeam) {
        room.proposedTeam = room.proposedTeam.map(id => id === oldId ? socket.id : id);
      }
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
      io.to(code).emit('lobby-update', lobbyState(room));
    }
  });

  // Let a player claim a disconnected slot under any name (e.g. they lost their session)
  socket.on('claim-slot', ({ code, claimName }) => {
    const room = getRoom(code);
    if (!room || room.state !== 'playing') { socket.emit('join-error', 'Game not in progress.'); return; }
    room.disconnected = room.disconnected || new Set();
    if (!room.disconnected.has(claimName)) { socket.emit('join-error', 'That player is not disconnected.'); return; }
    const player = room.players.find(p => p.name === claimName);
    if (!player) { socket.emit('join-error', 'Player not found.'); return; }
    const oldId = player.id;
    player.id = socket.id;
    if (room.hostId === oldId) room.hostId = socket.id;
    if (room.teamVotes?.[oldId] !== undefined) {
      room.teamVotes[socket.id] = room.teamVotes[oldId];
      delete room.teamVotes[oldId];
    }
    if (room.questVotes?.[oldId] !== undefined) {
      room.questVotes[socket.id] = room.questVotes[oldId];
      delete room.questVotes[oldId];
    }
    if (room.proposedTeam) {
      room.proposedTeam = room.proposedTeam.map(id => id === oldId ? socket.id : id);
    }
    socket.join(code);
    socket.emit('rejoin-ok', { state: 'playing', claimedName: player.name });
    socket.emit('game-start');
    socket.emit('your-role', { role: player.role, isEvil: isEvil(player.role), known: buildKnown(room, player) });
    socket.emit('phase-update', gameState(room));
    room.disconnected.delete(player.name);
    if (room.disconnected.size === 0) {
      io.to(code).emit('game-resumed');
    } else {
      socket.emit('game-paused', { disconnected: [...room.disconnected] });
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
    if (!room) { socket.emit('join-error', 'Room not found.'); return; }
    if (room.state !== 'lobby') {
      // Game in progress — offer to claim a disconnected slot
      room.disconnected = room.disconnected || new Set();
      const slots = [...room.disconnected];
      socket.emit('game-in-progress', { disconnectedSlots: slots });
      return;
    }
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

  socket.on('propose-dispute', ({ campaign }) => {
    const room = getRoomOf(socket.id);
    if (!room || room.state !== 'playing') return;
    if (room.campaignResults[campaign] === undefined) return;
    if (room.pendingDispute) return; // already one pending
    const proposer = room.players.find(p => p.id === socket.id);
    if (!proposer) return;
    const flipped = room.campaignResults[campaign] === 'pass' ? 'fail' : 'pass';
    room.pendingDispute = {
      campaign,
      proposerName: proposer.name,
      proposedResult: flipped,
      votes: { [socket.id]: true }, // proposer auto-approves
    };
    io.to(room.code).emit('phase-update', gameState(room));
  });

  socket.on('dispute-vote', ({ approve }) => {
    const room = getRoomOf(socket.id);
    if (!room || !room.pendingDispute) return;
    const d = room.pendingDispute;
    if (!approve) {
      room.pendingDispute = null;
      io.to(room.code).emit('phase-update', gameState(room));
      return;
    }
    d.votes[socket.id] = true;
    if (Object.keys(d.votes).length === room.players.length) {
      // Unanimous — flip the result
      const { campaign, proposedResult } = d;
      room.campaignResults[campaign] = proposedResult;
      if (room.questHistory[campaign]) room.questHistory[campaign].passed = proposedResult === 'pass';
      // Recompute winner
      const total = room.campaignsConfig.length;
      const toWin = Math.ceil(total / 2);
      const passes   = room.campaignResults.filter(r => r === 'pass').length;
      const failures = room.campaignResults.filter(r => r === 'fail').length;
      if (passes >= toWin && !room.winner) { room.pendingAssassination = true; room.phase = 'assassination'; }
      else if (failures >= toWin)         { room.winner = 'evil'; room.winReason = 'Quest results corrected'; room.phase = 'game-over'; }
      else { room.winner = null; room.winReason = null; }
      room.pendingDispute = null;
      io.to(room.code).emit('phase-update', gameState(room));
    } else {
      io.to(room.code).emit('phase-update', gameState(room));
    }
  });

  socket.on('lady-investigate', ({ targetId }) => {
    const room = getRoomOf(socket.id);
    if (!room || room.phase !== 'lady-of-lake') return;
    if (socket.id !== room.ladyHolder) return;
    if (room.ladyUsed.has(targetId)) return; // can't pick a past holder
    const target = room.players.find(p => p.id === targetId);
    if (!target) return;
    room.ladyPendingResult = { targetId, alignment: isEvil(target.role) ? 'evil' : 'good' };
    // Send private result only to the holder
    socket.emit('lady-result', { targetName: target.name, alignment: room.ladyPendingResult.alignment });
  });

  socket.on('lady-announce', ({ announcement }) => {
    const room = getRoomOf(socket.id);
    if (!room || room.phase !== 'lady-of-lake') return;
    if (socket.id !== room.ladyHolder) return;
    if (!room.ladyPendingResult) return;
    const { targetId } = room.ladyPendingResult;
    const target = room.players.find(p => p.id === targetId);
    if (!target) return;
    const holderPlayer = room.players.find(p => p.id === socket.id);
    room.ladyHistory.push({
      investigator: holderPlayer?.name,
      target: target.name,
      announcement,
    });
    room.ladyUsed.add(targetId);
    room.ladyHolder = targetId;
    room.ladyPendingResult = null;
    room.phase = 'team-select';
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
