// Socket handlers for the Secret Hitler game mode. Every event is namespaced
// 'sec:' so it never collides with the other games on the same socket.
//
// Identity follows Trivia Night: a seat is keyed by the device token, and
// every action the client sends carries { code, token }, so a vote that
// races a reconnect (new socket id, rejoin not processed yet) still lands on
// the right seat.
const { secRooms, getSecRoom, getSecRoomOf, randomSecCode } = require('./rooms');
const E = require('./engine');
const { viewFor } = require('./state');
const db = require('../db');
const { guardedOn, cleanName, isLiveSocket, EMPTY_ROOM_GRACE_MS, later } = require('../safeSocket');

module.exports = function registerSecretHandlers(io) {
  const liveIds = room => new Set(room.players.filter(p => isLiveSocket(io, p.id)).map(p => p.id));
  const anyoneLive = room => room.players.some(p => isLiveSocket(io, p.id));

  function save(room) { db.saveRoom(room).catch(e => console.error('[db]', e.message)); }

  // Views differ per seat (roles, cards in hand), so this is a targeted emit
  // per player rather than one room broadcast.
  function broadcast(room, { persist = true } = {}) {
    const live = liveIds(room);
    room.players.forEach(p => io.to(p.id).emit('sec:state', viewFor(room, p, live)));
    if (persist) save(room);
  }

  function sendState(socket, room, player) {
    socket.emit('sec:state', viewFor(room, player, liveIds(room)));
  }

  // ── Seats ──────────────────────────────────────────────────────────────

  // A socket holds one seat. Taking a seat elsewhere leaves lobbies outright;
  // a seat in a game in progress is kept for the token to reclaim, because
  // the rules need every seat to stay put.
  function leaveOtherRooms(socket, keepCode) {
    Object.values(secRooms).forEach(room => {
      if (room.code === keepCode) return;
      const player = room.players.find(p => p.id === socket.id);
      if (!player) return;
      socket.leave('sec-' + room.code);
      if (room.state === 'lobby') removePlayer(room, player);
      else { player.id = 'left:' + socket.id; broadcast(room); }
    });
  }

  function deleteRoom(room) {
    delete secRooms[room.code];
    db.deleteRoom(room.code).catch(() => {});
  }

  function removePlayer(room, player) {
    room.players = room.players.filter(p => p !== player);
    if (room.players.length === 0) { deleteRoom(room); return; }
    if (room.hostId === player.id) {
      const next = room.players.find(p => isLiveSocket(io, p.id)) || room.players[0];
      room.hostId = next.id;
    }
    broadcast(room);
  }

  function attach(socket, room, player) {
    if (player.id !== socket.id) {
      leaveOtherRooms(socket, room.code);
      if (room.hostId === player.id) room.hostId = socket.id;
      player.id = socket.id;
    }
    socket.join('sec-' + room.code);
  }

  // Resolve who is acting. Normal path: the socket is seated. Reconnect race:
  // the socket is new but the payload carries the room and the seat's token.
  function seat(socket, payload) {
    let room = getSecRoomOf(socket.id);
    let player = room?.players.find(p => p.id === socket.id);
    if (!player && typeof payload.token === 'string' && payload.token) {
      room = getSecRoom(payload.code);
      player = room?.players.find(p => p.token === payload.token);
      if (player) attach(socket, room, player);
    }
    if (!room || !player) { socket.emit('sec:desync'); return {}; }
    return { room, player, seat: room.players.indexOf(player) };
  }

  // The host runs the lobby. If their phone is gone, anyone can.
  const isController = (room, player) =>
    room.hostId === player.id || !room.hostId || !isLiveSocket(io, room.hostId);

  function scheduleEmptyRoomCleanup(room) {
    later(EMPTY_ROOM_GRACE_MS, () => {
      if (secRooms[room.code] !== room) return;
      if (anyoneLive(room)) return;
      deleteRoom(room);
    });
  }

  function joined(socket, room, player) {
    socket.emit('sec:joined', { code: room.code, name: player.name });
    broadcast(room);
  }

  // ── Events ─────────────────────────────────────────────────────────────

  io.on('connection', socket => {
    const on = guardedOn(socket, 'secret');

    // A game action: resolve the seat, run the engine, broadcast if it took.
    const action = (event, fn) => on(event, payload => {
      const { room, player, seat: s } = seat(socket, payload);
      if (!room || room.state !== 'playing' || !room.g) return;
      if (fn(room, s, payload, player)) broadcast(room);
      else sendState(socket, room, player);   // a stale tap: show them what is true now
    });

    on('sec:create-room', ({ name, token }) => {
      const hostName = cleanName(name);
      if (!hostName) { socket.emit('sec:error', 'Enter your name.'); return; }
      const code = randomSecCode();
      leaveOtherRooms(socket, code);
      const room = {
        gameType: 'secret', code, hostId: socket.id, state: 'lobby', createdAt: Date.now(),
        players: [{ id: socket.id, name: hostName, token: typeof token === 'string' ? token : null }],
      };
      secRooms[code] = room;
      socket.join('sec-' + code);
      joined(socket, room, room.players[0]);
    });

    on('sec:join-room', ({ code, name, token }) => {
      const room = getSecRoom(code);
      if (!room) { socket.emit('sec:error', 'Room not found. Check the code.'); return; }
      const clean = cleanName(name);
      if (!clean) { socket.emit('sec:error', 'Enter your name.'); return; }

      // This device already has a seat here: take it back.
      const mine = typeof token === 'string' && token ? room.players.find(p => p.token === token) : null;
      if (mine) { attach(socket, room, mine); joined(socket, room, mine); return; }

      const same = room.players.find(p => p.name.toLowerCase() === clean.toLowerCase());
      if (same) {
        // A lost token (new phone, cleared storage) can reclaim a seat by name,
        // but never one that is still in use.
        if (isLiveSocket(io, same.id)) { socket.emit('sec:error', 'That name is taken in this room.'); return; }
        if (typeof token === 'string' && token) same.token = token;
        attach(socket, room, same); joined(socket, room, same); return;
      }
      if (room.state !== 'lobby') { socket.emit('sec:error', 'That game has already started. Join with the name you used to take your seat back.'); return; }
      if (room.players.length >= E.MAX_PLAYERS) { socket.emit('sec:error', `This room is full (${E.MAX_PLAYERS} players).`); return; }

      leaveOtherRooms(socket, room.code);
      const player = { id: socket.id, name: clean, token: typeof token === 'string' ? token : null };
      room.players.push(player);
      socket.join('sec-' + room.code);
      joined(socket, room, player);
    });

    on('sec:rejoin-room', ({ code, token }) => {
      const room = getSecRoom(code);
      if (!room) { socket.emit('sec:rejoin-error', 'That game has ended.'); return; }
      const player = typeof token === 'string' && token ? room.players.find(p => p.token === token) : null;
      if (!player) { socket.emit('sec:rejoin-error', 'You are no longer in that game.'); return; }
      attach(socket, room, player);
      joined(socket, room, player);
    });

    on('sec:request-sync', payload => {
      const { room, player } = seat(socket, payload);
      if (room) sendState(socket, room, player);
    });

    // ── Lobby ──

    // The presidency passes around the table in seat order, so the host lines
    // the list up with where people actually sit.
    on('sec:move-seat', payload => {
      const { room, player } = seat(socket, payload);
      if (!room || room.state !== 'lobby' || !isController(room, player)) return;
      const from = payload.from, dir = payload.dir;
      if (!Number.isInteger(from) || (dir !== -1 && dir !== 1)) return;
      const to = from + dir;
      if (from < 0 || from >= room.players.length || to < 0 || to >= room.players.length) return;
      [room.players[from], room.players[to]] = [room.players[to], room.players[from]];
      broadcast(room);
    });

    on('sec:shuffle-seats', payload => {
      const { room, player } = seat(socket, payload);
      if (!room || room.state !== 'lobby' || !isController(room, player)) return;
      room.players = E.shuffle(room.players);
      broadcast(room);
    });

    on('sec:start', payload => {
      const { room, player } = seat(socket, payload);
      if (!room || room.state !== 'lobby' || !isController(room, player)) return;
      const n = room.players.length;
      if (n < E.MIN_PLAYERS) { socket.emit('sec:error', `You need at least ${E.MIN_PLAYERS} players.`); return; }
      if (n > E.MAX_PLAYERS) { socket.emit('sec:error', `At most ${E.MAX_PLAYERS} players.`); return; }
      E.startGame(room);
      broadcast(room);
    });

    // ── Game ──

    action('sec:ready', (room, s) => E.markReady(room, s));
    action('sec:begin', (room, s, _p, player) => isController(room, player) && E.beginPlay(room));
    action('sec:nominate', (room, s, p) => E.nominate(room, s, p.target));
    action('sec:vote', (room, s, p) => E.castVote(room, s, p.ja));
    action('sec:discard', (room, s, p) => E.presidentDiscard(room, s, p.index));
    action('sec:enact', (room, s, p) => E.chancellorEnact(room, s, p.index));
    action('sec:veto', (room, s) => E.proposeVeto(room, s));
    action('sec:veto-answer', (room, s, p) => E.answerVeto(room, s, p.accept));
    action('sec:power', (room, s, p) => E.usePower(room, s, p.target));
    action('sec:power-done', (room, s) => E.powerDone(room, s));

    on('sec:claim-host', payload => {
      const { room, player } = seat(socket, payload);
      if (!room || room.hostId === player.id) return;
      if (room.hostId && isLiveSocket(io, room.hostId)) return;
      room.hostId = player.id;
      broadcast(room);
    });

    on('sec:play-again', payload => {
      const { room, player } = seat(socket, payload);
      if (!room || room.state !== 'playing' || room.g?.phase !== 'over' || !isController(room, player)) return;
      E.resetToLobby(room);
      broadcast(room);
    });

    // Ending early is the host's call, and anyone's once the host is gone.
    on('sec:end-game', payload => {
      const { room, player } = seat(socket, payload);
      if (!room || room.state !== 'playing' || !isController(room, player)) return;
      E.resetToLobby(room);
      broadcast(room);
    });

    on('sec:leave', payload => {
      const { room, player } = seat(socket, payload);
      if (!room) return;
      socket.leave('sec-' + room.code);
      if (room.state === 'lobby') { removePlayer(room, player); return; }
      // Mid-game the seat stays (the rules need it); it can be reclaimed by name.
      player.id = 'left:' + socket.id;
      player.token = null;
      if (room.hostId === socket.id) {
        const next = room.players.find(p => isLiveSocket(io, p.id));
        room.hostId = next ? next.id : null;
      }
      if (!anyoneLive(room)) { deleteRoom(room); return; }
      broadcast(room);
    });

    on('disconnect', () => {
      const room = getSecRoomOf(socket.id);
      if (!room) return;
      broadcast(room, { persist: false });   // presence only — the seat stays
      if (!anyoneLive(room)) scheduleEmptyRoomCleanup(room);
    });
  });
};
