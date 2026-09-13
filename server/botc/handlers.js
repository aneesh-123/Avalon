const { botcRooms, getBotcRoom, getBotcRoomOf, randomBotcCode } = require('./rooms');
const { MIN_PLAYERS, MAX_PLAYERS } = require('./characters');
const { botcLobbyState, botcGameState, botcGrimoire } = require('./state');
const engine = require('./engine');
const db = require('../db');

module.exports = function registerBotcHandlers(io) {
  // Clocktower state is per-viewer — each player's character and private
  // information differ — so there is no single broadcastable game payload.
  function broadcastGame(room) {
    room.players.forEach(p => io.to(p.id).emit('botc:phase-update', botcGameState(room, p.id)));
    if (room.storytellerView) {
      io.to(room.hostId).emit('botc:grimoire', botcGrimoire(room));
    }
    db.saveRoom(room).catch(e => console.error('[db]', e.message));
  }

  function broadcastLobby(room) {
    io.to(room.code).emit('botc:lobby-update', botcLobbyState(room));
    db.saveRoom(room).catch(e => console.error('[db]', e.message));
  }

  function runNight(room) {
    if (engine.advanceNight(room) === 'done') {
      engine.beginDay(room);
      engine.checkWin(room);
    }
    broadcastGame(room);
  }

  io.on('connection', socket => {

    socket.on('botc:request-sync', () => {
      const room = getBotcRoomOf(socket.id);
      if (!room) return;
      if (room.state === 'playing') socket.emit('botc:phase-update', botcGameState(room, socket.id));
      else socket.emit('botc:lobby-update', botcLobbyState(room));
    });

    socket.on('botc:create-room', ({ playerCount, name, token, storytellerView }) => {
      const count = parseInt(playerCount, 10);
      if (!(count >= MIN_PLAYERS && count <= MAX_PLAYERS)) {
        socket.emit('botc:join-error', `Player count must be between ${MIN_PLAYERS} and ${MAX_PLAYERS}.`);
        return;
      }
      const code = randomBotcCode();
      botcRooms[code] = {
        code, gameType: 'botc', hostId: socket.id, playerCount: count,
        storytellerView: !!storytellerView,
        players: [{ id: socket.id, name, token: token || null, ready: false }],
        state: 'lobby',
      };
      socket.join(code);
      socket.emit('botc:room-created', { code });
      broadcastLobby(botcRooms[code]);
    });

    socket.on('botc:join-room', ({ code, name, token }) => {
      const room = getBotcRoom(code);
      if (!room)                                   return socket.emit('botc:join-error', 'Room not found.');
      if (room.state !== 'lobby')                  return socket.emit('botc:join-error', 'That game has already started.');
      if (room.players.length >= room.playerCount) return socket.emit('botc:join-error', 'Room is full.');
      if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase()))
        return socket.emit('botc:join-error', 'Name taken.');

      room.players.push({ id: socket.id, name, token: token || null, ready: false });
      socket.join(code);
      socket.emit('botc:room-joined', { code });
      broadcastLobby(room);
    });

    socket.on('botc:rejoin-room', ({ code, name, token }) => {
      const room = getBotcRoom(code);
      if (!room) return socket.emit('botc:rejoin-error', 'Room not found.');
      const player = (token && room.players.find(p => p.token === token))
                  || room.players.find(p => p.name.toLowerCase() === name.toLowerCase());
      if (!player) return socket.emit('botc:rejoin-error', 'Name not found in that room.');

      const oldId = player.id;
      player.id = socket.id;
      if (token) player.token = token;
      if (room.hostId === oldId) room.hostId = socket.id;
      // Carry private state across the new socket id.
      if (room.info?.[oldId])       { room.info[socket.id]       = room.info[oldId];       delete room.info[oldId]; }
      if (room.fakeBoards?.[oldId]) { room.fakeBoards[socket.id] = room.fakeBoards[oldId]; delete room.fakeBoards[oldId]; }
      if (room.redHerring === oldId) room.redHerring = socket.id;
      if (room.night?.awaiting?.playerId === oldId) room.night.awaiting.playerId = socket.id;

      socket.join(code);
      socket.emit('botc:rejoin-ok', { state: room.state, claimedName: player.name });
      if (room.state === 'playing') socket.emit('botc:phase-update', botcGameState(room, socket.id));
      else broadcastLobby(room);
    });

    socket.on('botc:toggle-ready', () => {
      const room = getBotcRoomOf(socket.id);
      if (!room || room.state !== 'lobby') return;
      const player = room.players.find(p => p.id === socket.id);
      if (!player) return;
      player.ready = !player.ready;
      broadcastLobby(room);

      if (room.players.length === room.playerCount && room.players.every(p => p.ready)) {
        engine.setupGame(room);
        io.to(room.code).emit('botc:game-start');
        engine.beginNight(room);
        runNight(room);
      }
    });

    socket.on('botc:night-choice', ({ targetId, targetIds }) => {
      const room = getBotcRoomOf(socket.id);
      if (!room || room.phase !== 'night') return;
      if (!engine.applyNightChoice(room, socket.id, targetIds || targetId)) return;
      runNight(room);
    });

    socket.on('botc:nominate', ({ nomineeId }) => {
      const room = getBotcRoomOf(socket.id);
      if (!room || room.phase !== 'day') return;
      const err = engine.nominate(room, socket.id, nomineeId);
      if (err) return socket.emit('botc:action-error', err);
      engine.checkWin(room);
      broadcastGame(room);
    });

    socket.on('botc:slay', ({ targetId }) => {
      const room = getBotcRoomOf(socket.id);
      if (!room || room.phase !== 'day') return;
      const err = engine.slay(room, socket.id, targetId);
      if (err) return socket.emit('botc:action-error', err);
      engine.checkWin(room);
      broadcastGame(room);
    });

    socket.on('botc:vote', ({ vote }) => {
      const room = getBotcRoomOf(socket.id);
      if (!room || room.phase !== 'nomination') return;
      if (!engine.castNominationVote(room, socket.id, vote === true)) return;
      if (engine.allVotesIn(room)) engine.resolveNomination(room);
      broadcastGame(room);
    });

    socket.on('botc:close-nomination', () => {
      const room = getBotcRoomOf(socket.id);
      if (!room || room.phase !== 'nomination' || room.hostId !== socket.id) return;
      engine.resolveNomination(room);
      broadcastGame(room);
    });

    socket.on('botc:end-day', () => {
      const room = getBotcRoomOf(socket.id);
      if (!room || room.phase !== 'day' || room.hostId !== socket.id) return;
      engine.endDay(room);
      if (engine.checkWin(room)) return broadcastGame(room);
      engine.beginNight(room);
      runNight(room);
    });

    // The grimoire leaks the entire game, so it is host-only and only in rooms
    // that opted in — or to anyone once the game is already over.
    socket.on('botc:request-grimoire', () => {
      const room = getBotcRoomOf(socket.id);
      if (!room || room.state !== 'playing') return;
      const allowed = (room.storytellerView && room.hostId === socket.id)
                   || room.phase === 'game-over';
      if (!allowed) return;
      socket.emit('botc:grimoire', botcGrimoire(room));
    });

    socket.on('botc:leave-lobby', () => {
      const room = getBotcRoomOf(socket.id);
      if (!room || room.state !== 'lobby') return;
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) {
        delete botcRooms[room.code];
        db.deleteRoom(room.code).catch(() => {});
        return;
      }
      if (room.hostId === socket.id) room.hostId = room.players[0].id;
      broadcastLobby(room);
    });

    socket.on('botc:leave-game', () => {
      const room = getBotcRoomOf(socket.id);
      if (!room || room.state !== 'playing') return;
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) {
        delete botcRooms[room.code];
        db.deleteRoom(room.code).catch(() => {});
      }
    });
  });
};
