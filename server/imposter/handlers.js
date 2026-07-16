// Socket handlers for the Imposter game — mirrors the Avalon handler module's
// structure (broadcast + rejoin + pause/resume + leave semantics), with every
// event namespaced 'imp:' so the two games never collide on one socket.
const { impRooms, getImpRoom, getImpRoomOf, randomImpCode } = require('./rooms');
const { assignRoles, buildPrivateInfo, beginGame, submitClue, resolveVotes, resolveGuess, validateConfig } = require('./engine');
const { impLobbyState, impGameState } = require('./state');
const { categoryNames } = require('./words');
const db = require('../db');

const MIN_PLAYERS = 4;
const MAX_PLAYERS = 15;

module.exports = function registerImposterHandlers(io) {

  function broadcastGame(room) {
    io.to('imp-' + room.code).emit('imp:phase-update', impGameState(room));
    db.saveRoom(room).catch(e => console.error('[db]', e.message));
  }

  function broadcastLobby(room) {
    io.to('imp-' + room.code).emit('imp:lobby-update', impLobbyState(room));
  }

  function startGame(room) {
    assignRoles(room);
    beginGame(room);
    room.players.forEach(p => {
      io.to(p.id).emit('imp:your-role', buildPrivateInfo(room, p));
    });
    io.to('imp-' + room.code).emit('imp:game-start');
    broadcastGame(room);
  }

  // Swap socket ID onto the player record everywhere it's referenced,
  // then replay the current state to the reconnecting socket.
  function doRejoin(socket, room, player, token) {
    if (token && !player.token) player.token = token;
    const oldId = player.id;
    if (oldId !== socket.id) {
      player.id = socket.id;
      if (room.hostId === oldId) room.hostId = socket.id;
      if (room.clueOrder) room.clueOrder = room.clueOrder.map(id => id === oldId ? socket.id : id);
      if (room.clues) room.clues.forEach(c => { if (c.playerId === oldId) c.playerId = socket.id; });
      if (room.votes) {
        // Both voter keys and target values are socket ids
        const remapped = {};
        Object.entries(room.votes).forEach(([voter, target]) => {
          remapped[voter === oldId ? socket.id : voter] = (target === oldId ? socket.id : target);
        });
        room.votes = remapped;
      }
      if (room.voteCandidates) room.voteCandidates = room.voteCandidates.map(id => id === oldId ? socket.id : id);
      if (room.accusedId === oldId) room.accusedId = socket.id;
    }
    socket.join('imp-' + room.code);
    socket.emit('imp:rejoin-ok', { state: room.state, claimedName: player.name });

    if (room.state === 'playing') {
      socket.emit('imp:game-start');
      socket.emit('imp:your-role', buildPrivateInfo(room, player));
      socket.emit('imp:phase-update', impGameState(room));
      room.disconnected = room.disconnected || [];
      room.disconnected = room.disconnected.filter(n => n !== player.name);
      if (room.disconnected.length === 0) {
        io.to('imp-' + room.code).emit('imp:game-resumed');
      } else {
        socket.emit('imp:game-paused', { disconnected: [...room.disconnected] });
      }
    } else {
      broadcastLobby(room);
    }
  }

  io.on('connection', socket => {

    socket.on('imp:request-sync', () => {
      const room = getImpRoomOf(socket.id);
      if (!room) return;
      if (room.state === 'playing') socket.emit('imp:phase-update', impGameState(room));
      else broadcastLobby(room);
    });

    socket.on('imp:get-categories', () => {
      socket.emit('imp:categories', { categories: categoryNames() });
    });

    socket.on('imp:rejoin-room', ({ code, name, token }) => {
      const room = getImpRoom(code);
      if (!room) { socket.emit('imp:rejoin-error', 'Room not found.'); return; }
      const player = (token && room.players.find(p => p.token === token))
                  || room.players.find(p => p.name.toLowerCase() === name.toLowerCase());
      if (!player) { socket.emit('imp:rejoin-error', 'Name not found in that room.'); return; }
      doRejoin(socket, room, player, token);
    });

    socket.on('imp:create-room', ({ playerCount, config, name, token }) => {
      const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, parseInt(playerCount, 10) || MIN_PLAYERS));
      const cleanConfig = {
        imposterCount: Math.max(1, Math.min(3, parseInt(config?.imposterCount, 10) || 1)),
        impostersKnowEachOther: config?.impostersKnowEachOther !== false,
        hintLevel: ['none','category','vague','related','first-letter','letter-count'].includes(config?.hintLevel)
          ? config.hintLevel : 'category',
        categoryVisible: config?.categoryVisible !== false,
        clueRounds: config?.clueRounds === 2 ? 2 : 1,
        allowImposterGuess: config?.allowImposterGuess !== false,
        specialRoles: {
          detective:   !!config?.specialRoles?.detective,
          confused:    !!config?.specialRoles?.confused,
          doubleAgent: !!config?.specialRoles?.doubleAgent,
          accomplice:  !!config?.specialRoles?.accomplice,
          jester:      !!config?.specialRoles?.jester,
        },
        categories: Array.isArray(config?.categories) ? config.categories.filter(c => categoryNames().includes(c)) : [],
        customWord:     (config?.customWord || '').trim().slice(0, 40) || null,
        customCategory: (config?.customCategory || '').trim().slice(0, 30) || null,
        customRelated:  (config?.customRelated || '').trim().slice(0, 40) || null,
      };
      const err = validateConfig(n, cleanConfig);
      if (err) { socket.emit('imp:join-error', err); return; }

      const code = randomImpCode();
      impRooms[code] = {
        gameType: 'imposter',
        code, hostId: socket.id, playerCount: n, config: cleanConfig,
        players: [{ id: socket.id, name, token: token || null, ready: false, role: null }],
        state: 'lobby',
      };
      socket.join('imp-' + code);
      socket.emit('imp:room-created', { code });
      broadcastLobby(impRooms[code]);
    });

    socket.on('imp:join-room', ({ code, name, token }) => {
      const room = getImpRoom(code);
      if (!room) { socket.emit('imp:join-error', 'Room not found.'); return; }
      if (room.state !== 'lobby') {
        room.disconnected = room.disconnected || [];
        if (token) {
          const ownedPlayer = room.players.find(p => p.token === token);
          if (ownedPlayer && room.disconnected.includes(ownedPlayer.name)) {
            doRejoin(socket, room, ownedPlayer, token);
            return;
          }
        }
        const matchedPlayer = room.players.find(p => p.name.toLowerCase() === name.toLowerCase());
        if (matchedPlayer && room.disconnected.includes(matchedPlayer.name)) {
          doRejoin(socket, room, matchedPlayer, token);
          return;
        }
        if (matchedPlayer) {
          socket.emit('imp:join-error', 'That player is already connected to this game.');
          return;
        }
        socket.emit('imp:game-in-progress', { disconnectedSlots: [...room.disconnected] });
        return;
      }
      if (room.players.length >= room.playerCount) { socket.emit('imp:join-error', 'Room is full.'); return; }
      if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) { socket.emit('imp:join-error', 'Name taken.'); return; }
      room.players.push({ id: socket.id, name, token: token || null, ready: false, role: null });
      socket.join('imp-' + code);
      socket.emit('imp:room-joined', { code });
      broadcastLobby(room);
    });

    socket.on('imp:toggle-ready', () => {
      const room = getImpRoomOf(socket.id);
      if (!room || room.state !== 'lobby') return;
      const player = room.players.find(p => p.id === socket.id);
      if (!player) return;
      player.ready = !player.ready;
      broadcastLobby(room);
      const full     = room.players.length === room.playerCount;
      const allReady = room.players.every(p => p.ready);
      if (full && allReady) {
        const err = validateConfig(room.players.length, room.config);
        if (err) { io.to('imp-' + room.code).emit('imp:join-error', err); return; }
        startGame(room);
      }
    });

    socket.on('imp:submit-clue', ({ text }) => {
      const room = getImpRoomOf(socket.id);
      if (!room || room.state !== 'playing') return;
      const clean = String(text || '').trim().slice(0, 60);
      if (!clean) return;
      if (submitClue(room, socket.id, clean)) broadcastGame(room);
    });

    socket.on('imp:start-vote', () => {
      const room = getImpRoomOf(socket.id);
      if (!room || room.phase !== 'discussion') return;
      if (room.hostId !== socket.id) return;
      room.phase = 'vote';
      room.votes = {};
      broadcastGame(room);
    });

    socket.on('imp:cast-vote', ({ targetId }) => {
      const room = getImpRoomOf(socket.id);
      if (!room || room.phase !== 'vote') return;
      if (room.votes[socket.id]) return;                 // already voted
      if (targetId === socket.id) return;                // can't vote self
      if (!room.players.some(p => p.id === targetId)) return;
      if (room.voteCandidates && !room.voteCandidates.includes(targetId)) return;
      room.votes[socket.id] = targetId;
      if (Object.keys(room.votes).length === room.players.length) {
        const result = resolveVotes(room);
        if (result.action === 'revote') {
          io.to('imp-' + room.code).emit('imp:revote', {
            candidates: result.candidates.map(id => ({
              id, name: room.players.find(p => p.id === id)?.name || '?',
            })),
          });
        }
      }
      broadcastGame(room);
    });

    socket.on('imp:guess-word', ({ guess }) => {
      const room = getImpRoomOf(socket.id);
      if (!room || room.phase !== 'imposter-guess') return;
      if (socket.id !== room.accusedId) return;
      resolveGuess(room, String(guess || '').trim().slice(0, 60));
      broadcastGame(room);
    });

    socket.on('imp:leave-lobby', () => {
      const room = getImpRoomOf(socket.id);
      if (!room || room.state !== 'lobby') return;
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) { delete impRooms[room.code]; db.deleteRoom(room.code).catch(() => {}); return; }
      if (room.hostId === socket.id) room.hostId = room.players[0].id;
      broadcastLobby(room);
    });

    socket.on('imp:leave-game', () => {
      const room = getImpRoomOf(socket.id);
      if (!room || room.state !== 'playing') return;
      const player = room.players.find(p => p.id === socket.id);
      if (!player) return;
      room.disconnected = room.disconnected || [];
      if (!room.disconnected.includes(player.name)) room.disconnected.push(player.name);
      if (room.disconnected.length === room.players.length) {
        delete impRooms[room.code];
        db.deleteRoom(room.code).catch(() => {});
      } else {
        io.to('imp-' + room.code).emit('imp:game-paused', { disconnected: [...room.disconnected] });
      }
    });

    socket.on('disconnect', () => {
      const room = getImpRoomOf(socket.id);
      if (!room) return;
      if (room.state === 'lobby') return;   // stays until explicit leave, same as Avalon
      if (room.phase === 'game-over') return;
      const player = room.players.find(p => p.id === socket.id);
      if (!player) return;
      room.disconnected = room.disconnected || [];
      if (!room.disconnected.includes(player.name)) room.disconnected.push(player.name);
      if (room.disconnected.length === room.players.length) {
        delete impRooms[room.code];
        db.deleteRoom(room.code).catch(() => {});
      } else {
        io.to('imp-' + room.code).emit('imp:game-paused', { disconnected: [...room.disconnected] });
      }
    });
  });
};
