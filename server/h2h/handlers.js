// Socket handlers for Head to Head. Every event is namespaced 'h2h:' so it
// never collides with the other games on the same socket.
//
// Identity: a seat is keyed by the device token, and every action carries
// { code, token }, so an action that races a reconnect still lands on the
// right seat (the same scheme as Trivia and The Council).
const { h2hRooms, getH2hRoom, getH2hRoomOf, randomH2hCode, newPid } = require('./rooms');
const E = require('./engine');
const Q = require('./questions');
const { viewFor } = require('./state');
const db = require('../db');
const { guardedOn, cleanName, isLiveSocket, EMPTY_ROOM_GRACE_MS, later } = require('../safeSocket');

module.exports = function registerH2hHandlers(io) {
  const liveIds = room => new Set(room.players.filter(p => isLiveSocket(io, p.id)).map(p => p.id));
  const anyoneLive = room => room.players.some(p => isLiveSocket(io, p.id));
  function save(room) { db.saveRoom(room).catch(e => console.error('[db]', e.message)); }

  // ── The clock ──────────────────────────────────────────────────────────
  // One timer per room, aimed at the current phase's end. The timer lives
  // outside the room object, which is saved to the database.
  const timers = new WeakMap();
  function arm(room) {
    const due = room.state === 'playing' ? room.game?.phaseEnds : null;
    const cur = timers.get(room);
    if (cur && cur.due === due) return;
    if (cur) clearTimeout(cur.t);
    timers.delete(room);
    if (due == null) return;
    timers.set(room, { due, t: later(Math.max(0, due - Date.now()) + 20, () => {
      timers.delete(room);
      if (h2hRooms[room.code] !== room) return;
      broadcast(room);
    }) });
  }

  function broadcast(room, { persist = true } = {}) {
    // Catch up on any phase that ran out (also after a server restart).
    let moved = false;
    for (let i = 0; i < 20 && E.tick(room); i++) moved = true;
    const live = liveIds(room);
    const now = Date.now();
    room.players.forEach(p => io.to(p.id).emit('h2h:state', viewFor(room, p, live, now)));
    if (persist || moved) save(room);
    arm(room);
  }

  function sendState(socket, room, player) {
    socket.emit('h2h:state', viewFor(room, player, liveIds(room)));
  }

  // ── Seats ──────────────────────────────────────────────────────────────

  function leaveOtherRooms(socket, keepCode) {
    Object.values(h2hRooms).forEach(room => {
      if (room.code === keepCode) return;
      const player = room.players.find(p => p.id === socket.id);
      if (!player) return;
      socket.leave('h2h-' + room.code);
      if (room.state === 'lobby') removePlayer(room, player);
      else { player.id = 'left:' + socket.id; broadcast(room); }
    });
  }

  function removePlayer(room, player) {
    room.players = room.players.filter(p => p !== player);
    if (room.players.length === 0) {
      delete h2hRooms[room.code];
      db.deleteRoom(room.code).catch(() => {});
      return;
    }
    broadcast(room);
  }

  function attach(socket, room, player) {
    if (player.id !== socket.id) {
      leaveOtherRooms(socket, room.code);
      player.id = socket.id;
    }
    socket.join('h2h-' + room.code);
  }

  function seat(socket, payload) {
    let room = getH2hRoomOf(socket.id);
    let player = room?.players.find(p => p.id === socket.id);
    if (!player && typeof payload.token === 'string' && payload.token) {
      room = getH2hRoom(payload.code);
      player = room?.players.find(p => p.token === payload.token);
      if (player) attach(socket, room, player);
    }
    if (!room || !player) { socket.emit('h2h:desync'); return {}; }
    return { room, player };
  }

  function scheduleEmptyRoomCleanup(room) {
    later(EMPTY_ROOM_GRACE_MS, () => {
      if (h2hRooms[room.code] !== room || anyoneLive(room)) return;
      delete h2hRooms[room.code];
      db.deleteRoom(room.code).catch(() => {});
    });
  }

  function joined(socket, room, player) {
    socket.emit('h2h:joined', { code: room.code, name: player.name });
    broadcast(room);
  }

  const token = t => (typeof t === 'string' && t ? t : null);

  // ── Events ─────────────────────────────────────────────────────────────

  io.on('connection', socket => {
    const on = guardedOn(socket, 'h2h');

    on('h2h:create-room', ({ name, token: tok, category }) => {
      const clean = cleanName(name);
      if (!clean) { socket.emit('h2h:error', 'Enter your name.'); return; }
      const code = randomH2hCode();
      leaveOtherRooms(socket, code);
      const room = {
        gameType: 'h2h', code, state: 'lobby', phase: null, game: null,
        category: Q.isCategory(category) ? category : 'mixed', seen: [],
        players: [{ pid: newPid(), id: socket.id, name: clean, token: token(tok), score: 0 }],
        createdAt: Date.now(),
      };
      h2hRooms[code] = room;
      socket.join('h2h-' + code);
      joined(socket, room, room.players[0]);
    });

    on('h2h:join-room', ({ code, name, token: tok }) => {
      const room = getH2hRoom(code);
      if (!room) { socket.emit('h2h:error', 'Match not found. Check the code.'); return; }
      const clean = cleanName(name);
      if (!clean) { socket.emit('h2h:error', 'Enter your name.'); return; }

      const mine = token(tok) ? room.players.find(p => p.token === tok) : null;
      if (mine) { attach(socket, room, mine); joined(socket, room, mine); return; }

      const same = room.players.find(p => p.name.toLowerCase() === clean.toLowerCase());
      if (same) {
        if (isLiveSocket(io, same.id)) { socket.emit('h2h:error', 'That name is taken in this match.'); return; }
        if (token(tok)) same.token = tok;
        attach(socket, room, same); joined(socket, room, same); return;
      }
      if (room.players.length >= E.MAX_PLAYERS) {
        // A seat whose phone left the lobby for good can be taken over there.
        const gone = room.state === 'lobby' && room.players.find(p => !isLiveSocket(io, p.id));
        if (!gone) { socket.emit('h2h:error', 'This match already has two players.'); return; }
        room.players = room.players.filter(p => p !== gone);
      }
      if (room.state !== 'lobby') { socket.emit('h2h:error', 'That match has already started.'); return; }

      leaveOtherRooms(socket, room.code);
      const player = { pid: newPid(), id: socket.id, name: clean, token: token(tok), score: 0 };
      room.players.push(player);
      socket.join('h2h-' + room.code);
      joined(socket, room, player);
    });

    on('h2h:rejoin-room', ({ code, token: tok }) => {
      const room = getH2hRoom(code);
      if (!room) { socket.emit('h2h:rejoin-error', 'That match has ended.'); return; }
      const player = token(tok) ? room.players.find(p => p.token === tok) : null;
      if (!player) { socket.emit('h2h:rejoin-error', 'You are no longer in that match.'); return; }
      attach(socket, room, player);
      joined(socket, room, player);
    });

    on('h2h:request-sync', payload => {
      const { room, player } = seat(socket, payload);
      if (room) sendState(socket, room, player);
    });

    on('h2h:category', payload => {
      const { room } = seat(socket, payload);
      if (room && E.setCategory(room, payload.category)) broadcast(room);
    });

    on('h2h:start', payload => {
      const { room } = seat(socket, payload);
      if (!room) return;
      const res = E.startMatch(room);
      if (res.error) { socket.emit('h2h:error', res.error); return; }
      broadcast(room);
    });

    on('h2h:answer', payload => {
      const { room, player } = seat(socket, payload);
      if (!room) return;
      // The phone says which question it was answering, so a late tap can't
      // land on the next one.
      if (typeof payload.index === 'number' && room.game && payload.index !== room.game.index) return;
      if (!E.answer(room, player.pid, payload.choice, Number(payload.ms))) return;
      E.settle(room);
      broadcast(room, { persist: room.phase !== 'question' });
    });

    // From the final scores: 'rematch' starts again at once in the same
    // category; 'lobby' goes back to pick a new one.
    on('h2h:again', payload => {
      const { room } = seat(socket, payload);
      if (!room || room.phase !== 'game-over') return;
      E.resetToLobby(room);
      if (payload.mode === 'rematch' && room.players.length === E.MAX_PLAYERS) {
        save(room);                // a finished match, then a new one: counted as two games
        E.startMatch(room);
      }
      broadcast(room);
    });

    on('h2h:leave', payload => {
      const { room, player } = seat(socket, payload);
      if (!room) return;
      socket.leave('h2h-' + room.code);
      if (room.state === 'lobby') { removePlayer(room, player); return; }
      player.id = 'left:' + socket.id;
      broadcast(room);
      if (!anyoneLive(room)) scheduleEmptyRoomCleanup(room);
    });

    on('disconnect', () => {
      const room = getH2hRoomOf(socket.id);
      if (!room) return;
      broadcast(room, { persist: false });
      if (!anyoneLive(room)) scheduleEmptyRoomCleanup(room);
    });
  });
};
