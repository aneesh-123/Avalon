const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ── Constants ──
const EVIL_ROLES = new Set(['Assassin','Morgana','Mordred','Oberon','Minion of Mordred']);

function isEvil(r)    { return EVIL_ROLES.has(r); }
function isMordred(r) { return r === 'Mordred'; }
function isMorgana(r) { return r === 'Morgana'; }
function isMerlin(r)  { return r === 'Merlin'; }
function isOberon(r)  { return r === 'Oberon'; }

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

// rooms[code] = { code, hostId, playerCount, roleConfig, players, state }
// player = { id, name, ready, role }
const rooms = {};

function getRoom(code) { return rooms[code]; }
function getRoomOf(socketId) {
  return Object.values(rooms).find(r => r.players.some(p => p.id === socketId));
}

function lobbyState(room) {
  return {
    code: room.code,
    playerCount: room.playerCount,
    hostId: room.hostId,
    players: room.players.map(p => ({ id: p.id, name: p.name, ready: p.ready })),
    state: room.state,
  };
}

function buildRoleList(playerCount, roleConfig) {
  const { evilCount, goodSpecials, evilSpecials } = roleConfig;
  const goodCount   = playerCount - evilCount;
  const loyalCount  = goodCount  - 1 - goodSpecials.length;
  const minionCount = evilCount  - 1 - evilSpecials.length;
  return [
    'Merlin',
    ...goodSpecials,
    ...Array(Math.max(0, loyalCount)).fill('Loyal Servant'),
    'Assassin',
    ...evilSpecials,
    ...Array(Math.max(0, minionCount)).fill('Minion of Mordred'),
  ];
}

function assignRoles(room) {
  const roles = shuffle(buildRoleList(room.playerCount, room.roleConfig));
  room.players.forEach((p, i) => { p.role = roles[i]; });

  // Send each player their private role info
  room.players.forEach((player, i) => {
    const role  = player.role;
    const known = [];

    room.players.forEach((other, j) => {
      if (i === j) return;
      const r = other.role;
      if (isMerlin(role)) {
        if (isEvil(r) && !isMordred(r)) known.push({ id: other.id, name: other.name, label: 'evil', css: 'known-evil' });
      } else if (role === 'Percival') {
        if (isMerlin(r) || isMorgana(r)) known.push({ id: other.id, name: other.name, label: 'Merlin or Morgana?', css: 'known-merlin' });
      } else if (isEvil(role) && !isOberon(role)) {
        if (isEvil(r) && !isOberon(r)) known.push({ id: other.id, name: other.name, label: 'evil ally', css: 'known-evil' });
      }
    });

    io.to(player.id).emit('your-role', {
      role,
      isEvil: isEvil(role),
      known,
    });
  });
}

io.on('connection', socket => {
  // Host creates a room
  socket.on('create-room', ({ playerCount, roleConfig, name }) => {
    const code = randomCode();
    rooms[code] = {
      code, hostId: socket.id, playerCount, roleConfig,
      players: [{ id: socket.id, name, ready: false, role: null }],
      state: 'lobby',
    };
    socket.join(code);
    socket.emit('room-created', { code });
    io.to(code).emit('lobby-update', lobbyState(rooms[code]));
  });

  // Player joins by code
  socket.on('join-room', ({ code, name }) => {
    const room = getRoom(code);
    if (!room)                           { socket.emit('join-error', 'Room not found.'); return; }
    if (room.state !== 'lobby')          { socket.emit('join-error', 'Game already started.'); return; }
    if (room.players.length >= room.playerCount) { socket.emit('join-error', 'Room is full.'); return; }
    if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      socket.emit('join-error', 'That name is taken.'); return;
    }
    room.players.push({ id: socket.id, name, ready: false, role: null });
    socket.join(code);
    socket.emit('room-joined', { code });
    io.to(code).emit('lobby-update', lobbyState(room));
  });

  // Player toggles ready
  socket.on('toggle-ready', () => {
    const room = getRoomOf(socket.id);
    if (!room || room.state !== 'lobby') return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    player.ready = !player.ready;
    io.to(room.code).emit('lobby-update', lobbyState(room));

    // Start if majority are ready AND room is full
    const full     = room.players.length === room.playerCount;
    const majority = room.players.filter(p => p.ready).length > room.playerCount / 2;
    if (full && majority) {
      room.state = 'playing';
      assignRoles(room);
      io.to(room.code).emit('game-start');
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
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Avalon running on http://localhost:${PORT}`));
