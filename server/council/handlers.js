// Socket handlers for The Council. Every event is namespaced 'cn:' so it never
// collides with the other games on the same socket.
//
// Identity: a seat is keyed by the device token, and every action carries
// { code, token }, so an action that races a reconnect still lands on the
// right seat (the same scheme as Trivia).
const { councilRooms, getCouncilRoom, getCouncilRoomOf, randomCouncilCode, newPid } = require('./rooms');
const E = require('./engine');
const { viewFor } = require('./state');
const bots = require('./bots');
const db = require('../db');
const { guardedOn, cleanName, isLiveSocket, EMPTY_ROOM_GRACE_MS, later } = require('../safeSocket');

module.exports = function registerCouncilHandlers(io) {
  // Bots have no socket but are always at the table.
  const liveIds = room => new Set(room.players.filter(p => p.bot || isLiveSocket(io, p.id)).map(p => p.id));
  const anyoneLive = room => room.players.some(p => !p.bot && isLiveSocket(io, p.id));
  const humans = room => room.players.filter(p => !p.bot);
  function save(room) { db.saveRoom(room).catch(e => console.error('[db]', e.message)); }

  function broadcast(room, { persist = true } = {}) {
    const live = liveIds(room);
    room.players.forEach(p => { if (!p.bot) io.to(p.id).emit('cn:state', viewFor(room, p, live)); });
    if (persist) save(room);
    scheduleBot(room);
  }

  // ── Bots ───────────────────────────────────────────────────────────────
  // One bot move at a time, each after a short pause, so the table sees them
  // land the way people's would. The timer lives outside the room object,
  // which is saved to the database.
  const botTimers = new WeakMap();
  function scheduleBot(room) {
    if (botTimers.has(room) || !room.players.some(p => p.bot) || !bots.nextMove(room)) return;
    botTimers.set(room, later(bots.delay(), () => {
      botTimers.delete(room);
      if (councilRooms[room.code] !== room || !anyoneLive(room)) return;
      const move = bots.nextMove(room);
      if (!move || !bots.apply(room, move)) return;
      settleWaiting(room);
      broadcast(room);
    }));
  }

  function sendState(socket, room, player) {
    socket.emit('cn:state', viewFor(room, player, liveIds(room)));
  }

  // ── Seats ──────────────────────────────────────────────────────────────

  function leaveOtherRooms(socket, keepCode) {
    Object.values(councilRooms).forEach(room => {
      if (room.code === keepCode) return;
      const player = room.players.find(p => p.id === socket.id);
      if (!player) return;
      socket.leave('cn-' + room.code);
      if (room.state === 'lobby') removePlayer(room, player);
      else { player.id = 'left:' + socket.id; broadcast(room); }
    });
  }

  function removePlayer(room, player) {
    room.players = room.players.filter(p => p !== player);
    if (humans(room).length === 0) {
      delete councilRooms[room.code];
      db.deleteRoom(room.code).catch(() => {});
      return;
    }
    if (room.hostId === player.id) {
      const next = humans(room).find(p => isLiveSocket(io, p.id)) || humans(room)[0];
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
    socket.join('cn-' + room.code);
  }

  function seat(socket, payload) {
    let room = getCouncilRoomOf(socket.id);
    let player = room?.players.find(p => p.id === socket.id);
    if (!player && typeof payload.token === 'string' && payload.token) {
      room = getCouncilRoom(payload.code);
      player = room?.players.find(p => p.token === payload.token);
      if (player) attach(socket, room, player);
    }
    if (!room || !player) { socket.emit('cn:desync'); return {}; }
    return { room, player };
  }

  const isHost = (room, player) => room.hostId === player.id || !isLiveSocket(io, room.hostId);

  function scheduleEmptyRoomCleanup(room) {
    later(EMPTY_ROOM_GRACE_MS, () => {
      if (councilRooms[room.code] !== room || anyoneLive(room)) return;
      delete councilRooms[room.code];
      db.deleteRoom(room.code).catch(() => {});
    });
  }

  function joined(socket, room, player) {
    socket.emit('cn:joined', { code: room.code, name: player.name });
    broadcast(room);
  }

  // Everyone has done their part: move on. A phone that has gone dark holds
  // the table only until the host taps "Continue without them" (cn:skip).
  function settleWaiting(room) {
    if (room.state !== 'playing') return false;
    const all = room.players.map(p => p.pid);
    if (room.phase === 'roles' && E.allReady(room)) { E.beginRound(room); return true; }
    if (room.phase === 'vote' && E.voteComplete(room, all)) { E.resolveVote(room); return true; }
    if (room.phase === 'act' && E.actsComplete(room)) { E.resolveActs(room); return true; }
    return false;
  }

  // ── Events ─────────────────────────────────────────────────────────────

  io.on('connection', socket => {
    const on = guardedOn(socket, 'council');

    on('cn:create-room', ({ name, token, bots: botsWanted }) => {
      const hostName = cleanName(name);
      if (!hostName) { socket.emit('cn:error', 'Enter your name.'); return; }
      const code = randomCouncilCode();
      leaveOtherRooms(socket, code);
      const room = {
        gameType: 'council', code, hostId: socket.id, state: 'lobby', phase: null, game: null,
        players: [{ pid: newPid(), id: socket.id, name: hostName, token: typeof token === 'string' ? token : null, role: null }],
        createdAt: Date.now(),
      };
      // A practice table: bots fill the other seats (from /?game=council&bots=N).
      const botSeats = Math.min(Math.max(parseInt(botsWanted, 10) || 0, 0), E.MAX_PLAYERS - 1);
      for (let i = 0; i < botSeats; i++) {
        const pid = newPid();
        room.players.push({ pid, id: 'bot:' + pid, name: bots.botName(room), token: null, role: null, bot: true });
      }
      councilRooms[code] = room;
      socket.join('cn-' + code);
      joined(socket, room, room.players[0]);
    });

    on('cn:join-room', ({ code, name, token }) => {
      const room = getCouncilRoom(code);
      if (!room) { socket.emit('cn:error', 'Room not found. Check the code.'); return; }
      const clean = cleanName(name);
      if (!clean) { socket.emit('cn:error', 'Enter your name.'); return; }

      const mine = typeof token === 'string' && token ? room.players.find(p => p.token === token) : null;
      if (mine) { attach(socket, room, mine); joined(socket, room, mine); return; }

      const same = room.players.find(p => p.name.toLowerCase() === clean.toLowerCase());
      if (same) {
        if (same.bot || isLiveSocket(io, same.id)) { socket.emit('cn:error', 'That name is taken in this room.'); return; }
        if (typeof token === 'string' && token) same.token = token;
        attach(socket, room, same); joined(socket, room, same); return;
      }
      if (room.state !== 'lobby') { socket.emit('cn:error', 'That game has already started.'); return; }
      if (room.players.length >= E.MAX_PLAYERS) { socket.emit('cn:error', 'This room is full.'); return; }

      leaveOtherRooms(socket, room.code);
      const player = { pid: newPid(), id: socket.id, name: clean, token: typeof token === 'string' ? token : null, role: null };
      room.players.push(player);
      socket.join('cn-' + room.code);
      joined(socket, room, player);
    });

    on('cn:rejoin-room', ({ code, token }) => {
      const room = getCouncilRoom(code);
      if (!room) { socket.emit('cn:rejoin-error', 'That game has ended.'); return; }
      const player = typeof token === 'string' && token ? room.players.find(p => p.token === token) : null;
      if (!player) { socket.emit('cn:rejoin-error', 'You are no longer in that game.'); return; }
      attach(socket, room, player);
      joined(socket, room, player);
    });

    on('cn:request-sync', payload => {
      const { room, player } = seat(socket, payload);
      if (room) sendState(socket, room, player);
    });

    on('cn:start', payload => {
      const { room, player } = seat(socket, payload);
      if (!room || room.state !== 'lobby' || !isHost(room, player)) return;
      const res = E.startGame(room);
      if (res.error) { socket.emit('cn:error', res.error); return; }
      broadcast(room);
    });

    on('cn:ready', payload => {
      const { room, player } = seat(socket, payload);
      if (!room || !E.markReady(room, player.pid)) return;
      settleWaiting(room);
      broadcast(room);
    });

    // The host starts round 1 without waiting for a phone that is not coming.
    // The host moves the table on without a phone that is not coming back:
    // start round 1, count the votes that are in, or treat a missing partner
    // as helping (a loyal player could only have helped anyway).
    on('cn:skip', payload => {
      const { room, player } = seat(socket, payload);
      if (!room || room.state !== 'playing' || !isHost(room, player)) return;
      if (typeof payload.phase === 'string' && payload.phase !== room.phase) return;
      const g = room.game;
      if (room.phase === 'roles') E.beginRound(room);
      else if (room.phase === 'vote' && Object.keys(g.votes).length) E.resolveVote(room);
      else if (room.phase === 'act') {
        [g.proposal.leader, g.proposal.partner].forEach(pid => { if (!(pid in g.actions)) g.actions[pid] = 'help'; });
        E.resolveActs(room);
      } else return;
      broadcast(room);
    });

    on('cn:propose', payload => {
      const { room, player } = seat(socket, payload);
      if (!room) return;
      const res = E.propose(room, player.pid, { option: payload.option, partner: payload.partner });
      if (res.error) { socket.emit('cn:error', res.error); sendState(socket, room, player); return; }
      broadcast(room);
    });

    on('cn:withdraw', payload => {
      const { room, player } = seat(socket, payload);
      if (room && E.withdraw(room, player.pid)) broadcast(room);
    });

    on('cn:vote', payload => {
      const { room, player } = seat(socket, payload);
      if (!room || !E.castVote(room, player.pid, payload.approve === true)) return;
      settleWaiting(room);
      broadcast(room);
    });

    on('cn:act', payload => {
      const { room, player } = seat(socket, payload);
      if (!room || !E.act(room, player.pid, payload.choice)) return;
      settleWaiting(room);
      broadcast(room);
    });

    // "Next round" from the result screen. The client says which round it was
    // looking at, so a double tap cannot skip one.
    on('cn:next', payload => {
      const { room, player } = seat(socket, payload);
      if (!room || room.phase !== 'result') return;
      if (typeof payload.round === 'number' && payload.round !== room.game.round) return;
      if (E.nextRound(room)) broadcast(room);
    });

    on('cn:play-again', payload => {
      const { room, player } = seat(socket, payload);
      if (!room || room.phase !== 'game-over' || !isHost(room, player)) return;
      E.resetToLobby(room);
      broadcast(room);
    });

    on('cn:leave', payload => {
      const { room, player } = seat(socket, payload);
      if (!room) return;
      socket.leave('cn-' + room.code);
      if (room.state === 'lobby') { removePlayer(room, player); return; }
      // Mid-game the seat stays (the roles are dealt), but it stops counting
      // as live, so the table is not left waiting on it.
      player.id = 'left:' + socket.id;
      if (room.hostId === socket.id) room.hostId = humans(room).find(p => isLiveSocket(io, p.id))?.id || room.hostId;
      broadcast(room);
      if (!anyoneLive(room)) scheduleEmptyRoomCleanup(room);
    });

    on('disconnect', () => {
      const room = getCouncilRoomOf(socket.id);
      if (!room) return;
      // Presence only — the seat is kept for the token to reclaim.
      broadcast(room, { persist: false });
      if (!anyoneLive(room)) scheduleEmptyRoomCleanup(room);
    });
  });
};
