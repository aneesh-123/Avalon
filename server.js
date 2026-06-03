const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Game data
const QUEST_TEAM_SIZES = {
  5:  [2,3,2,3,3],
  6:  [2,3,4,3,4],
  7:  [2,3,3,4,4],
  8:  [3,4,4,5,5],
  9:  [3,4,4,5,5],
  10: [3,4,4,5,5]
};

// Quest 4 (index 3) requires 2 fails for 7+ players
const QUEST_DOUBLE_FAIL = { minPlayers: 7, questIndex: 3 };

const ROLES_BY_COUNT = {
  5:  ['Merlin','Percival','Loyal Servant','Assassin','Morgana'],
  6:  ['Merlin','Percival','Loyal Servant','Loyal Servant','Assassin','Morgana'],
  7:  ['Merlin','Percival','Loyal Servant','Loyal Servant','Assassin','Morgana','Mordred'],
  8:  ['Merlin','Percival','Loyal Servant','Loyal Servant','Loyal Servant','Assassin','Morgana','Mordred'],
  9:  ['Merlin','Percival','Loyal Servant','Loyal Servant','Loyal Servant','Loyal Servant','Assassin','Morgana','Mordred'],
  10: ['Merlin','Percival','Loyal Servant','Loyal Servant','Loyal Servant','Loyal Servant','Assassin','Morgana','Mordred','Oberon']
};

const EVIL_ROLES = new Set(['Assassin','Morgana','Mordred','Oberon','Minion of Mordred']);

function isEvil(role) { return EVIL_ROLES.has(role); }

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

// rooms: { [roomCode]: Room }
const rooms = {};

function createRoom(hostSocketId, hostName) {
  const code = generateRoomCode();
  rooms[code] = {
    code,
    host: hostSocketId,
    players: [{ id: hostSocketId, name: hostName, role: null }],
    state: 'lobby', // lobby, playing, assassination, ended
    currentQuest: 0,
    currentLeaderIndex: 0,
    questResults: [], // 'pass' | 'fail'
    consecutiveRejections: 0,
    phase: null, // 'team-building' | 'team-vote' | 'quest-vote' | 'assassination'
    proposedTeam: [],
    teamVotes: {}, // socketId -> 'approve' | 'reject'
    questVotes: {}, // socketId -> 'success' | 'fail'
    winner: null,
    assassinationTarget: null
  };
  return code;
}

function getRoom(roomCode) { return rooms[roomCode]; }

function getRoomOfSocket(socketId) {
  return Object.values(rooms).find(r => r.players.some(p => p.id === socketId));
}

function buildInfoForPlayer(room, socketId) {
  const player = room.players.find(p => p.id === socketId);
  if (!player) return null;

  const role = player.role;
  const visibleAs = {}; // socketId -> what they see about others

  // Merlin sees all evil except Mordred
  // Evil sees each other except Oberon doesn't see others and isn't seen
  // Percival sees Merlin and Morgana (but not which is which)

  room.players.forEach(p => {
    if (p.id === socketId) return;
    let appearance = null;

    if (role === 'Merlin') {
      if (isEvil(p.role) && p.role !== 'Mordred') appearance = 'evil';
    } else if (role === 'Percival') {
      if (p.role === 'Merlin' || p.role === 'Morgana') appearance = 'Merlin or Morgana';
    } else if (isEvil(role) && role !== 'Oberon') {
      if (isEvil(p.role) && p.role !== 'Oberon') appearance = 'evil ally';
    }

    if (appearance) visibleAs[p.id] = appearance;
  });

  return {
    socketId,
    name: player.name,
    role,
    isEvil: isEvil(role),
    visibleAs,
    players: room.players.map(p => ({ id: p.id, name: p.name }))
  };
}

function buildPublicState(room) {
  const n = room.players.length;
  const teamSize = room.state === 'playing' ? QUEST_TEAM_SIZES[n][room.currentQuest] : null;
  return {
    code: room.code,
    state: room.state,
    phase: room.phase,
    host: room.host,
    players: room.players.map(p => ({ id: p.id, name: p.name })),
    currentQuest: room.currentQuest,
    currentLeaderIndex: room.currentLeaderIndex,
    currentLeaderId: room.state === 'playing' ? room.players[room.currentLeaderIndex]?.id : null,
    questResults: room.questResults,
    questSizes: QUEST_TEAM_SIZES[n] || [],
    consecutiveRejections: room.consecutiveRejections,
    proposedTeam: room.proposedTeam,
    teamSize,
    teamVoteCount: Object.keys(room.teamVotes).length,
    questVoteCount: Object.keys(room.questVotes).length,
    winner: room.winner,
    lastTeamVoteResult: room.lastTeamVoteResult || null,
    lastQuestVoteResult: room.lastQuestVoteResult || null,
    revealedRoles: room.revealedRoles || null,
    assassinationTarget: room.assassinationTarget || null,
  };
}

function startGame(room) {
  const n = room.players.length;
  const roles = shuffle(ROLES_BY_COUNT[n]);
  room.players.forEach((p, i) => { p.role = roles[i]; p.ready = false; });
  room.state = 'role-reveal';
  room.phase = 'role-reveal';
  room.currentQuest = 0;
  room.currentLeaderIndex = Math.floor(Math.random() * n);
  room.questResults = [];
  room.consecutiveRejections = 0;
  room.proposedTeam = [];
  room.teamVotes = {};
  room.questVotes = {};

  // Send private info to each player
  room.players.forEach(p => {
    const info = buildInfoForPlayer(room, p.id);
    io.to(p.id).emit('your-role', info);
  });
}

function beginPlay(room) {
  room.state = 'playing';
  room.phase = 'team-building';
  io.to(room.code).emit('all-ready');
  io.to(room.code).emit('game-state', buildPublicState(room));
}

function advanceLeader(room) {
  room.currentLeaderIndex = (room.currentLeaderIndex + 1) % room.players.length;
}

function resolveTeamVote(room) {
  const votes = Object.values(room.teamVotes);
  const approves = votes.filter(v => v === 'approve').length;
  const rejects = votes.filter(v => v === 'reject').length;
  const approved = approves > rejects;

  room.lastTeamVoteResult = {
    votes: room.players.map(p => ({ id: p.id, name: p.name, vote: room.teamVotes[p.id] || null })),
    approved
  };

  if (approved) {
    room.consecutiveRejections = 0;
    room.phase = 'quest-vote';
    room.questVotes = {};
  } else {
    room.consecutiveRejections++;
    if (room.consecutiveRejections >= 5) {
      room.winner = 'evil';
      room.state = 'ended';
      room.phase = null;
    } else {
      advanceLeader(room);
      room.phase = 'team-building';
      room.proposedTeam = [];
      room.teamVotes = {};
    }
  }

  io.to(room.code).emit('team-vote-result', room.lastTeamVoteResult);
  io.to(room.code).emit('game-state', buildPublicState(room));
}

function resolveQuestVote(room) {
  const votes = Object.values(room.questVotes);
  const fails = votes.filter(v => v === 'fail').length;
  const n = room.players.length;
  const needTwoFails = n >= QUEST_DOUBLE_FAIL.minPlayers && room.currentQuest === QUEST_DOUBLE_FAIL.questIndex;
  const questFailed = needTwoFails ? fails >= 2 : fails >= 1;
  const result = questFailed ? 'fail' : 'pass';

  room.lastQuestVoteResult = { failCount: fails, result };
  room.questResults.push(result);

  const passes = room.questResults.filter(r => r === 'pass').length;
  const failures = room.questResults.filter(r => r === 'fail').length;

  io.to(room.code).emit('quest-result', room.lastQuestVoteResult);

  if (passes >= 3) {
    // Good wins quests -> assassination phase
    room.state = 'assassination';
    room.phase = 'assassination';
    // Find assassin
    const assassin = room.players.find(p => p.role === 'Assassin');
    io.to(room.code).emit('game-state', buildPublicState(room));
    io.to(room.code).emit('assassination-phase', { assassinId: assassin?.id, assassinName: assassin?.name });
  } else if (failures >= 3) {
    room.winner = 'evil';
    room.state = 'ended';
    room.phase = null;
    revealRoles(room);
    io.to(room.code).emit('game-state', buildPublicState(room));
  } else {
    // Next quest
    room.currentQuest++;
    advanceLeader(room);
    room.phase = 'team-building';
    room.proposedTeam = [];
    room.teamVotes = {};
    room.questVotes = {};
    io.to(room.code).emit('game-state', buildPublicState(room));
  }
}

function revealRoles(room) {
  const revealed = room.players.map(p => ({ id: p.id, name: p.name, role: p.role }));
  room.revealedRoles = revealed;
  io.to(room.code).emit('reveal-roles', revealed);
}

io.on('connection', (socket) => {
  console.log('connected:', socket.id);

  socket.on('create-room', ({ name }) => {
    if (!name || name.trim().length < 1) return;
    const code = createRoom(socket.id, name.trim());
    socket.join(code);
    socket.emit('room-created', { code, playerId: socket.id });
    io.to(code).emit('game-state', buildPublicState(rooms[code]));
  });

  socket.on('join-room', ({ code, name }) => {
    const room = getRoom(code);
    if (!room) { socket.emit('error', 'Room not found'); return; }
    if (room.state !== 'lobby') { socket.emit('error', 'Game already started'); return; }
    if (room.players.length >= 10) { socket.emit('error', 'Room is full'); return; }
    if (room.players.some(p => p.name === name.trim())) { socket.emit('error', 'Name taken'); return; }

    room.players.push({ id: socket.id, name: name.trim(), role: null });
    socket.join(code);
    socket.emit('room-joined', { code, playerId: socket.id });
    io.to(code).emit('game-state', buildPublicState(room));
  });

  socket.on('player-ready', () => {
    const room = getRoomOfSocket(socket.id);
    if (!room || room.state !== 'role-reveal') return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) player.ready = true;
    if (room.players.every(p => p.ready)) {
      beginPlay(room);
    }
  });

  socket.on('start-game', () => {
    const room = getRoomOfSocket(socket.id);
    if (!room) return;
    if (room.host !== socket.id) { socket.emit('error', 'Only host can start'); return; }
    if (room.players.length < 5) { socket.emit('error', 'Need at least 5 players'); return; }
    startGame(room);
  });

  socket.on('propose-team', ({ team }) => {
    const room = getRoomOfSocket(socket.id);
    if (!room || room.phase !== 'team-building') return;
    const leader = room.players[room.currentLeaderIndex];
    if (leader.id !== socket.id) { socket.emit('error', 'Not your turn to propose'); return; }

    const n = room.players.length;
    const needed = QUEST_TEAM_SIZES[n][room.currentQuest];
    if (!Array.isArray(team) || team.length !== needed) { socket.emit('error', `Team must have ${needed} players`); return; }
    // Validate all IDs are in the room
    const playerIds = new Set(room.players.map(p => p.id));
    if (!team.every(id => playerIds.has(id))) { socket.emit('error', 'Invalid player in team'); return; }

    room.proposedTeam = team;
    room.phase = 'team-vote';
    room.teamVotes = {};
    io.to(room.code).emit('game-state', buildPublicState(room));
  });

  socket.on('team-vote', ({ vote }) => {
    const room = getRoomOfSocket(socket.id);
    if (!room || room.phase !== 'team-vote') return;
    if (!['approve','reject'].includes(vote)) return;

    room.teamVotes[socket.id] = vote;
    io.to(room.code).emit('game-state', buildPublicState(room));

    if (Object.keys(room.teamVotes).length === room.players.length) {
      resolveTeamVote(room);
    }
  });

  socket.on('quest-vote', ({ vote }) => {
    const room = getRoomOfSocket(socket.id);
    if (!room || room.phase !== 'quest-vote') return;
    if (!['success','fail'].includes(vote)) return;
    if (!room.proposedTeam.includes(socket.id)) { socket.emit('error', 'You are not on this quest'); return; }

    room.questVotes[socket.id] = vote;
    io.to(room.code).emit('game-state', buildPublicState(room));

    if (Object.keys(room.questVotes).length === room.proposedTeam.length) {
      resolveQuestVote(room);
    }
  });

  socket.on('assassinate', ({ targetId }) => {
    const room = getRoomOfSocket(socket.id);
    if (!room || room.state !== 'assassination') return;
    const assassin = room.players.find(p => p.role === 'Assassin');
    if (!assassin || assassin.id !== socket.id) { socket.emit('error', 'Only assassin can assassinate'); return; }

    const target = room.players.find(p => p.id === targetId);
    if (!target) { socket.emit('error', 'Invalid target'); return; }

    room.assassinationTarget = targetId;
    room.state = 'ended';
    room.phase = null;

    if (target.role === 'Merlin') {
      room.winner = 'evil';
    } else {
      room.winner = 'good';
    }

    revealRoles(room);
    io.to(room.code).emit('assassination-result', { targetId, targetName: target.name, targetRole: target.role, winner: room.winner });
    io.to(room.code).emit('game-state', buildPublicState(room));
  });

  socket.on('disconnect', () => {
    const room = getRoomOfSocket(socket.id);
    if (!room) return;
    if (room.state === 'lobby') {
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) {
        delete rooms[room.code];
      } else {
        if (room.host === socket.id) room.host = room.players[0].id;
        io.to(room.code).emit('game-state', buildPublicState(room));
      }
    } else {
      io.to(room.code).emit('player-disconnected', { name: room.players.find(p=>p.id===socket.id)?.name });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Avalon server running on port ${PORT}`));
