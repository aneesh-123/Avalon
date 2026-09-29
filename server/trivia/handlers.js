// Socket handlers for Trivia Night. Every event is namespaced 'triv:' so it
// never collides with Avalon or Imposter on the same socket.
//
// Identity: a player is a seat keyed by the device token, not the socket id.
// Every action the client sends carries { code, token }, so an action that
// races a reconnect (new socket id, rejoin not processed yet) still lands on
// the right seat instead of being silently dropped. That matters most for the
// buzzer, where a dropped tap is a lost race.
const { trivRooms, getTrivRoom, getTrivRoomOf, randomTrivCode } = require('./rooms');
const E = require('./engine');
const { viewFor } = require('./state');
const { categoryList } = require('./questions');
const db = require('../db');
const { guardedOn, cleanName, isLiveSocket, EMPTY_ROOM_GRACE_MS, later } = require('../safeSocket');

module.exports = function registerTriviaHandlers(io) {
  const phaseTimers  = new Map();   // room code -> auto-mode phase timer
  const windowTimers = new Map();   // room code -> buzz-window timer

  const liveIds = room => new Set(room.players.filter(p => isLiveSocket(io, p.id)).map(p => p.id));
  const anyoneLive = room => room.players.some(p => isLiveSocket(io, p.id));

  function save(room) { db.saveRoom(room).catch(e => console.error('[db]', e.message)); }

  // Views differ per viewer (the host sees the answer key), so this is a
  // targeted emit per seat rather than one room broadcast.
  function broadcast(room, { persist = true } = {}) {
    const live = liveIds(room);
    room.players.forEach(p => io.to(p.id).emit('triv:state', viewFor(room, p, live)));
    if (persist) save(room);
  }

  function sendState(socket, room, player) {
    socket.emit('triv:state', viewFor(room, player, liveIds(room)));
  }

  // ── Timers ─────────────────────────────────────────────────────────────

  function clearTimers(code) {
    clearTimeout(phaseTimers.get(code)); phaseTimers.delete(code);
    clearTimeout(windowTimers.get(code)); windowTimers.delete(code);
  }

  function schedulePhase(room) {
    clearTimeout(phaseTimers.get(room.code));
    phaseTimers.delete(room.code);
    if (room.state !== 'playing' || room.config.mode !== 'auto' || !room.phaseEndsAt) return;
    const delay = Math.max(0, room.phaseEndsAt - Date.now());
    phaseTimers.set(room.code, later(delay, () => onPhaseTimer(room)));
  }

  function onPhaseTimer(room) {
    phaseTimers.delete(room.code);
    if (trivRooms[room.code] !== room || room.state !== 'playing') return;
    // Nobody is watching — every phone is asleep. Hold here rather than play
    // through the whole quiz to an empty room; the first phone back restarts it.
    if (!anyoneLive(room)) { room.stalled = true; save(room); return; }
    const now = Date.now();
    if (room.phaseEndsAt && now < room.phaseEndsAt - 5) { schedulePhase(room); return; }
    E.advance(room, now);
    broadcast(room);
    schedulePhase(room);
  }

  function scheduleWindow(room) {
    clearTimeout(windowTimers.get(room.code));
    const b = room.buzz;
    if (!b?.open || b.windowEndsAt === null) { windowTimers.delete(room.code); return; }
    const delay = Math.max(0, b.windowEndsAt - Date.now());
    windowTimers.set(room.code, later(delay, () => {
      windowTimers.delete(room.code);
      if (trivRooms[room.code] !== room) return;
      if (E.closeBuzzWindow(room)) broadcast(room);
    }));
  }

  // After a restart, or when the room sat with every phone asleep, the timers
  // are gone. Put the game back in motion from where it stands.
  function ensureRunning(room) {
    if (room.state !== 'playing') return;
    const now = Date.now();
    if (room.buzz?.open && room.buzz.windowEndsAt !== null && !windowTimers.has(room.code)) {
      if (now >= room.buzz.windowEndsAt) E.closeBuzzWindow(room);
      else scheduleWindow(room);
    }
    if (room.config.mode === 'auto' && room.phaseEndsAt && !phaseTimers.has(room.code)) {
      if (room.stalled || now >= room.phaseEndsAt) {
        // Give the returning table the full phase again, not a question that
        // expired while they were away.
        const ms = E.phaseDuration(room);
        if (ms) room.phaseEndsAt = now + ms;
      }
      room.stalled = false;
      schedulePhase(room);
    }
  }

  // ── Seats ──────────────────────────────────────────────────────────────

  // A socket holds one Trivia seat. Taking a seat elsewhere leaves lobbies
  // outright; a seat in a game in progress is kept for the token to reclaim.
  function leaveOtherRooms(socket, keepCode) {
    Object.values(trivRooms).forEach(room => {
      if (room.code === keepCode) return;
      const player = room.players.find(p => p.id === socket.id);
      if (!player) return;
      socket.leave('triv-' + room.code);
      if (room.state === 'lobby') removePlayer(room, player);
      else { player.id = 'left:' + socket.id; broadcast(room); }
    });
  }

  function removePlayer(room, player) {
    room.players = room.players.filter(p => p !== player);
    if (room.players.length === 0) {
      clearTimers(room.code);
      delete trivRooms[room.code];
      db.deleteRoom(room.code).catch(() => {});
      return;
    }
    if (room.hostId === player.id) {
      // In the lobby, and in no-host games, the next person simply inherits
      // the controls. A quizmaster mid-game is different — they are the one
      // who knows the answers — so that seat is left for someone to claim.
      const next = room.config.mode === 'auto' || room.state === 'lobby'
        ? (room.players.find(p => isLiveSocket(io, p.id)) || room.players[0])
        : null;
      room.hostId = next ? next.id : null;
      if (next && room.config.mode === 'host' && room.state === 'lobby') next.teamId = null;
    }
    E.pruneEmptyTeams(room);
    broadcast(room);
  }

  function attach(socket, room, player) {
    if (player.id !== socket.id) {
      leaveOtherRooms(socket, room.code);
      if (room.hostId === player.id) room.hostId = socket.id;
      player.id = socket.id;
    }
    socket.join('triv-' + room.code);
  }

  // Resolve who is acting. Normal path: the socket is seated. Reconnect race:
  // the socket is new but the payload carries the room and the seat's token.
  function seat(socket, payload) {
    let room = getTrivRoomOf(socket.id);
    let player = room?.players.find(p => p.id === socket.id);
    if (!player && typeof payload.token === 'string' && payload.token) {
      room = getTrivRoom(payload.code);
      player = room?.players.find(p => p.token === payload.token);
      if (player) { attach(socket, room, player); ensureRunning(room); }
    }
    if (!room || !player) { socket.emit('triv:desync'); return {}; }
    return { room, player };
  }

  const isController = (room, player) =>
    room.hostId === player.id || !room.hostId || !isLiveSocket(io, room.hostId);

  function scheduleEmptyRoomCleanup(room) {
    later(EMPTY_ROOM_GRACE_MS, () => {
      if (trivRooms[room.code] !== room) return;
      if (anyoneLive(room)) return;
      clearTimers(room.code);
      delete trivRooms[room.code];
      db.deleteRoom(room.code).catch(() => {});
    });
  }

  function joined(socket, room, player) {
    socket.emit('triv:joined', { code: room.code, name: player.name });
    broadcast(room);
  }

  // ── Events ─────────────────────────────────────────────────────────────

  io.on('connection', socket => {
    const on = guardedOn(socket, 'trivia');

    on('triv:get-categories', () => {
      socket.emit('triv:categories', { categories: categoryList() });
    });

    // Clock sync. The client sends its own clock, we answer with ours, and it
    // works out the offset from the round trip. Everything the buzzer ranks on
    // depends on this, so it is as small and fast as a handler can be.
    on('triv:clock', (_payload, ack) => {
      if (typeof ack === 'function') ack({ now: Date.now() });
    });

    on('triv:create-room', ({ name, token, config }) => {
      const hostName = cleanName(name);
      if (!hostName) { socket.emit('triv:error', 'Enter your name.'); return; }
      const cfg = E.sanitizeConfig(config);
      const code = randomTrivCode();
      leaveOtherRooms(socket, code);
      const room = {
        gameType: 'trivia', code, hostId: socket.id, config: cfg,
        players: [{ id: socket.id, name: hostName, token: typeof token === 'string' ? token : null, teamId: null }],
        teams: [], teamSeq: 0, state: 'lobby', createdAt: Date.now(),
      };
      trivRooms[code] = room;
      socket.join('triv-' + code);
      joined(socket, room, room.players[0]);
    });

    on('triv:join-room', ({ code, name, token }) => {
      const room = getTrivRoom(code);
      if (!room) { socket.emit('triv:error', 'Room not found. Check the code.'); return; }
      const clean = cleanName(name);
      if (!clean) { socket.emit('triv:error', 'Enter your name.'); return; }

      // This device already has a seat here: take it back.
      const mine = typeof token === 'string' && token ? room.players.find(p => p.token === token) : null;
      if (mine) { attach(socket, room, mine); ensureRunning(room); joined(socket, room, mine); return; }

      const same = room.players.find(p => p.name.toLowerCase() === clean.toLowerCase());
      if (same) {
        // A lost token (new phone, cleared storage) can reclaim a seat by name,
        // but never one that is still in use.
        if (isLiveSocket(io, same.id)) { socket.emit('triv:error', 'That name is taken in this room.'); return; }
        if (typeof token === 'string' && token) same.token = token;
        attach(socket, room, same); ensureRunning(room); joined(socket, room, same); return;
      }
      if (room.players.length >= 40) { socket.emit('triv:error', 'This room is full.'); return; }

      // Trivia lets latecomers in at any point: they join or start a team and
      // play from the next question.
      leaveOtherRooms(socket, room.code);
      const player = { id: socket.id, name: clean, token: typeof token === 'string' ? token : null, teamId: null };
      room.players.push(player);
      socket.join('triv-' + room.code);
      ensureRunning(room);
      joined(socket, room, player);
    });

    on('triv:rejoin-room', ({ code, token }) => {
      const room = getTrivRoom(code);
      if (!room) { socket.emit('triv:rejoin-error', 'That game has ended.'); return; }
      const player = typeof token === 'string' && token ? room.players.find(p => p.token === token) : null;
      if (!player) { socket.emit('triv:rejoin-error', 'You are no longer in that game.'); return; }
      attach(socket, room, player);
      ensureRunning(room);
      joined(socket, room, player);
    });

    on('triv:request-sync', payload => {
      const { room, player } = seat(socket, payload);
      if (!room) return;
      ensureRunning(room);
      sendState(socket, room, player);
    });

    // ── Teams ──

    on('triv:create-team', payload => {
      const { room, player } = seat(socket, payload);
      if (!room) return;
      if (room.config.mode === 'host' && room.hostId === player.id) return;   // the quizmaster plays for nobody
      const { team, error } = E.createTeam(room, payload.name);
      if (error) { socket.emit('triv:error', error); return; }
      E.setPlayerTeam(room, player, team.id);
      broadcast(room);
    });

    on('triv:join-team', payload => {
      const { room, player } = seat(socket, payload);
      if (!room) return;
      if (room.config.mode === 'host' && room.hostId === player.id) return;
      if (typeof payload.teamId !== 'string') return;
      if (!E.setPlayerTeam(room, player, payload.teamId)) { socket.emit('triv:error', 'That team is gone.'); return; }
      broadcast(room);
    });

    // ── Flow ──

    on('triv:start', payload => {
      const { room, player } = seat(socket, payload);
      if (!room || room.state !== 'lobby') return;
      if (!isController(room, player)) return;
      if (!E.activeTeams(room).length) { socket.emit('triv:error', 'Nobody is on a team yet.'); return; }
      E.startGame(room, Date.now());
      broadcast(room);
      schedulePhase(room);
    });

    // "Next" — begin the round, skip the question, move past the answer, or
    // start the next round. The engine decides what it means right now.
    on('triv:next', payload => {
      const { room, player } = seat(socket, payload);
      if (!room || room.state !== 'playing') return;
      if (!isController(room, player)) return;
      // A stale double-tap must not skip two steps: the client says which
      // phase it was looking at.
      if (payload.phase && payload.phase !== room.phase) return;
      if (typeof payload.qIndex === 'number' && payload.qIndex !== room.qIndex) return;
      if (E.advance(room, Date.now())) {
        clearTimeout(windowTimers.get(room.code)); windowTimers.delete(room.code);
        broadcast(room);
        schedulePhase(room);
      }
    });

    on('triv:open-buzzers', payload => {
      const { room, player } = seat(socket, payload);
      if (!room || room.config.mode !== 'host' || room.hostId !== player.id) return;
      if (E.openBuzzers(room, Date.now())) broadcast(room, { persist: false });
    });

    on('triv:buzz', payload => {
      const { room, player } = seat(socket, payload);
      if (!room) return;
      const now = Date.now();
      const res = E.registerBuzz(room, player, { openId: payload.openId, at: payload.at }, now);
      socket.emit('triv:buzz-ack', { ok: res.ok, reason: res.reason || null, openId: payload.openId });
      if (!res.ok) return;
      if (res.allIn) {
        clearTimeout(windowTimers.get(room.code)); windowTimers.delete(room.code);
        E.closeBuzzWindow(room);
        broadcast(room);
        return;
      }
      if (res.first) {
        scheduleWindow(room);
        broadcast(room, { persist: false });   // "someone buzzed — deciding"
      }
    });

    on('triv:judge', payload => {
      const { room, player } = seat(socket, payload);
      if (!room || room.config.mode !== 'host' || room.hostId !== player.id) return;
      if (typeof payload.teamId === 'string' && payload.teamId !== room.buzz?.answeringTeamId) return;
      if (E.judge(room, payload.correct === true, Date.now())) broadcast(room);
    });

    on('triv:adjust-score', payload => {
      const { room, player } = seat(socket, payload);
      if (!room || room.state !== 'playing' || room.hostId !== player.id) return;
      if (E.adjustScore(room, payload.teamId, payload.delta)) broadcast(room);
    });

    on('triv:answer', payload => {
      const { room, player } = seat(socket, payload);
      if (!room) return;
      const res = E.submitAnswer(room, player, payload.choice, Date.now());
      if (!res.ok) { socket.emit('triv:answer-rejected', { reason: res.reason }); sendState(socket, room, player); return; }
      if (res.allIn) E.resolveAutoQuestion(room, Date.now());
      broadcast(room);
      schedulePhase(room);
    });

    // The host's phone died and is not coming back: someone else takes over.
    on('triv:claim-host', payload => {
      const { room, player } = seat(socket, payload);
      if (!room || room.hostId === player.id) return;
      if (room.hostId && isLiveSocket(io, room.hostId)) return;
      room.hostId = player.id;
      // A quizmaster sees every answer, so they cannot also play for a team.
      if (room.config.mode === 'host') { player.teamId = null; E.pruneEmptyTeams(room); }
      broadcast(room);
    });

    on('triv:end-game', payload => {
      const { room, player } = seat(socket, payload);
      if (!room || !isController(room, player)) return;
      if (E.endGameEarly(room, Date.now())) { clearTimers(room.code); broadcast(room); }
    });

    on('triv:play-again', payload => {
      const { room, player } = seat(socket, payload);
      if (!room || room.phase !== 'game-over' || !isController(room, player)) return;
      clearTimers(room.code);
      E.resetToLobby(room);
      broadcast(room);
    });

    on('triv:leave', payload => {
      const { room, player } = seat(socket, payload);
      if (!room) return;
      socket.leave('triv-' + room.code);
      removePlayer(room, player);
    });

    on('disconnect', () => {
      const room = getTrivRoomOf(socket.id);
      if (!room) return;
      // Presence only — the seat stays, and teams keep playing without them.
      broadcast(room, { persist: false });
      if (!anyoneLive(room)) scheduleEmptyRoomCleanup(room);
    });
  });
};
