const { getRoom, getRoomOf, getRoomOfToken, rooms, randomCode } = require('./rooms');
const { assignRoles, buildKnown, isEvil } = require('./roles');
const { gameState, lobbyState } = require('./state');
const { beginGame, resolveTeamVote, advanceFromTeamVoteResult, resolveQuestVote, advanceFromQuestResult } = require('./gameEngine');
const db = require('./db');

module.exports = function registerHandlers(io) {
  // Emit game state to everyone in the room and persist to database
  function broadcastGame(room) {
    io.to(room.code).emit('phase-update', gameState(room));
    db.saveRoom(room).catch(e => console.error('[db]', e.message));
  }

  // Assigns roles, notifies everyone, and begins play. Shared by the
  // random-order path (straight from lobby) and the host-selected-order
  // path (after the host submits their chosen turn order).
  function startGame(room) {
    assignRoles(room);
    room.players.forEach(p => {
      io.to(p.id).emit('your-role', {
        role: p.role,
        isEvil: isEvil(p.role),
        known: buildKnown(room, p),
      });
    });
    io.to(room.code).emit('game-start');
    beginGame(room);
    broadcastGame(room);
  }

  // Swap socket ID onto player record and emit all rejoin events
  function doRejoin(socket, room, player, token) {
    if (token && !player.token) player.token = token;
    const oldId = player.id;
    if (oldId !== socket.id) {
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
      if (room.ladyHolder === oldId) room.ladyHolder = socket.id;
      if (room.ladyUsed)  room.ladyUsed  = room.ladyUsed.map(id => id === oldId ? socket.id : id);
      if (room.assassinId === oldId) room.assassinId = socket.id;
    }
    socket.join(room.code);
    socket.emit('rejoin-ok', { state: room.state });

    if (room.state === 'playing') {
      socket.emit('game-start');
      socket.emit('your-role', { role: player.role, isEvil: isEvil(player.role), known: buildKnown(room, player) });
      socket.emit('phase-update', gameState(room));
      room.disconnected = room.disconnected || [];
      room.disconnected = room.disconnected.filter(n => n !== player.name);
      if (room.disconnected.length === 0) {
        io.to(room.code).emit('game-resumed');
      } else {
        socket.emit('game-paused', { disconnected: [...room.disconnected] });
      }
    } else {
      io.to(room.code).emit('lobby-update', lobbyState(room));
    }
  }

  io.on('connection', socket => {

    socket.on('request-sync', () => {
      const room = getRoomOf(socket.id);
      if (!room) return;
      if (room.state === 'playing') socket.emit('phase-update', gameState(room));
      else socket.emit('lobby-update', lobbyState(room));
    });

    socket.on('rejoin-room', ({ code, name, token }) => {
      const room = getRoom(code);
      if (!room) { socket.emit('rejoin-error', 'Room not found.'); return; }
      const player = (token && room.players.find(p => p.token === token))
                  || room.players.find(p => p.name.toLowerCase() === name.toLowerCase());
      if (!player) { socket.emit('rejoin-error', 'Name not found in that room.'); return; }
      doRejoin(socket, room, player, token);
    });

    socket.on('claim-slot', ({ code, claimName, token }) => {
      const room = getRoom(code);
      if (!room || room.state !== 'playing') { socket.emit('join-error', 'Game not in progress.'); return; }
      room.disconnected = room.disconnected || [];
      if (!room.disconnected.includes(claimName)) { socket.emit('join-error', 'That player is not disconnected.'); return; }
      const player = room.players.find(p => p.name === claimName);
      if (!player) { socket.emit('join-error', 'Player not found.'); return; }
      if (token) player.token = token;
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
      room.disconnected = room.disconnected.filter(n => n !== player.name);
      if (room.disconnected.length === 0) {
        io.to(code).emit('game-resumed');
      } else {
        socket.emit('game-paused', { disconnected: [...room.disconnected] });
      }
    });

    socket.on('create-room', ({ playerCount, roleConfig, campaignsConfig, name, token, orderMode }) => {
      const code = randomCode();
      rooms[code] = {
        code, hostId: socket.id, playerCount, roleConfig, campaignsConfig,
        orderMode: orderMode === 'host-selected' ? 'host-selected' : 'random',
        players: [{ id: socket.id, name, token: token || null, ready: false, role: null }],
        state: 'lobby',
      };
      socket.join(code);
      socket.emit('room-created', { code });
      io.to(code).emit('lobby-update', lobbyState(rooms[code]));
    });

    socket.on('join-room', ({ code, name, token }) => {
      const room = getRoom(code);
      if (!room) { socket.emit('join-error', 'Room not found.'); return; }
      if (room.state !== 'lobby') {
        room.disconnected = room.disconnected || [];
        // Token-based rejoin
        if (token) {
          const ownedPlayer = room.players.find(p => p.token === token);
          if (ownedPlayer && room.disconnected.includes(ownedPlayer.name)) {
            doRejoin(socket, room, ownedPlayer, token);
            return;
          }
        }
        // Name-based rejoin — player types their exact name to reclaim their slot
        const matchedPlayer = room.players.find(p => p.name.toLowerCase() === name.toLowerCase());
        if (matchedPlayer && room.disconnected.includes(matchedPlayer.name)) {
          doRejoin(socket, room, matchedPlayer, token);
          return;
        }
        // Name matched but player not disconnected
        if (matchedPlayer) {
          socket.emit('join-error', 'That player is already connected to this game.');
          return;
        }
        socket.emit('game-in-progress', { disconnectedSlots: [...room.disconnected] });
        return;
      }
      if (room.players.length >= room.playerCount) { socket.emit('join-error', 'Room is full.'); return; }
      if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) { socket.emit('join-error', 'Name taken.'); return; }
      room.players.push({ id: socket.id, name, token: token || null, ready: false, role: null });
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
        if (room.orderMode === 'host-selected') {
          room.state = 'ordering';
          io.to(room.code).emit('enter-order-select', {
            players: room.players.map(p => ({ id: p.id, name: p.name })),
            hostId: room.hostId,
          });
        } else {
          startGame(room);
        }
      }
    });

    socket.on('submit-order', ({ order, randomizeStart }) => {
      const room = getRoomOf(socket.id);
      if (!room || room.state !== 'ordering') return;
      if (room.hostId !== socket.id) return;
      const currentIds = room.players.map(p => p.id);
      const isValidPermutation = Array.isArray(order)
        && order.length === currentIds.length
        && currentIds.every(id => order.includes(id))
        && order.every(id => currentIds.includes(id));
      if (!isValidPermutation) return;
      room.players = order.map(id => room.players.find(p => p.id === id));
      room.randomizeStart = !!randomizeStart;
      startGame(room);
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
      room.teamVotes = { [socket.id]: 'approve' };
      broadcastGame(room);
      if (Object.keys(room.teamVotes).length === room.players.length) {
        resolveTeamVote(room);
        broadcastGame(room);
      }
    });

    socket.on('team-vote', ({ vote }) => {
      const room = getRoomOf(socket.id);
      if (!room || room.phase !== 'team-vote') return;
      if (!['approve','reject'].includes(vote)) return;
      if (room.teamVotes[socket.id]) return;
      room.teamVotes[socket.id] = vote;
      broadcastGame(room);
      if (Object.keys(room.teamVotes).length === room.players.length) {
        resolveTeamVote(room);
        broadcastGame(room);
      }
    });

    socket.on('continue-game', () => {
      const room = getRoomOf(socket.id);
      if (!room) return;
      if (room.phase === 'team-vote-result') {
        advanceFromTeamVoteResult(room);
        broadcastGame(room);
      } else if (room.phase === 'quest-result') {
        advanceFromQuestResult(room);
        broadcastGame(room);
      }
    });

    socket.on('cancel-proposal', () => {
      const room = getRoomOf(socket.id);
      if (!room || room.phase !== 'team-vote') return;
      if (room.players[room.currentLeaderIndex].id !== socket.id) return;
      room.phase = 'team-select';
      room.proposedTeam = [];
      room.teamVotes = {};
      broadcastGame(room);
    });

    socket.on('quest-vote', ({ vote }) => {
      const room = getRoomOf(socket.id);
      if (!room || (room.phase !== 'quest-vote' && room.phase !== 'quest-vote-ready')) return;
      if (!room.proposedTeam.includes(socket.id)) return;
      if (!['pass','fail'].includes(vote)) return;
      const voter = room.players.find(p => p.id === socket.id);
      if (vote === 'fail' && !isEvil(voter?.role)) return; // Good players can only Pass
      room.questVotes[socket.id] = vote;
      const allQuestVoted = Object.keys(room.questVotes).length === room.proposedTeam.length;
      if (allQuestVoted) room.phase = 'quest-vote-ready';
      broadcastGame(room);
    });

    socket.on('propose-dispute', ({ campaign }) => {
      const room = getRoomOf(socket.id);
      if (!room || room.state !== 'playing') return;
      if (room.campaignResults[campaign] === undefined) return;
      if (room.pendingDispute) return;
      const proposer = room.players.find(p => p.id === socket.id);
      if (!proposer) return;
      const flipped = room.campaignResults[campaign] === 'pass' ? 'fail' : 'pass';
      room.pendingDispute = {
        campaign,
        proposerName: proposer.name,
        proposedResult: flipped,
        votes: { [socket.id]: true },
      };
      broadcastGame(room);
    });

    socket.on('dispute-vote', ({ approve }) => {
      const room = getRoomOf(socket.id);
      if (!room || !room.pendingDispute) return;
      const d = room.pendingDispute;
      if (!approve) {
        room.pendingDispute = null;
        broadcastGame(room);
        return;
      }
      d.votes[socket.id] = true;
      if (Object.keys(d.votes).length === room.players.length) {
        const { campaign, proposedResult } = d;
        room.campaignResults[campaign] = proposedResult;
        if (room.questHistory[campaign]) room.questHistory[campaign].passed = proposedResult === 'pass';
        const total    = room.campaignsConfig.length;
        const toWin    = Math.ceil(total / 2);
        const passes   = room.campaignResults.filter(r => r === 'pass').length;
        const failures = room.campaignResults.filter(r => r === 'fail').length;
        if (passes >= toWin && !room.winner) { room.pendingAssassination = true; room.phase = 'assassination'; }
        else if (failures >= toWin)         { room.winner = 'evil'; room.winReason = 'Quest results corrected'; room.phase = 'game-over'; }
        else { room.winner = null; room.winReason = null; }
        room.pendingDispute = null;
        broadcastGame(room);
      } else {
        broadcastGame(room);
      }
    });

    socket.on('lady-investigate', ({ targetId }) => {
      const room = getRoomOf(socket.id);
      if (!room || room.phase !== 'lady-of-lake') return;
      if (socket.id !== room.ladyHolder) return;
      if (room.ladyUsed.includes(targetId)) return;
      const target = room.players.find(p => p.id === targetId);
      if (!target) return;
      room.ladyPendingResult = { targetId, alignment: isEvil(target.role) ? 'evil' : 'good' };
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
      if (!room.ladyUsed.includes(targetId)) room.ladyUsed.push(targetId);
      room.ladyHolder = targetId;
      room.ladyPendingResult = null;
      room.phase = 'team-select';
      broadcastGame(room);
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
      broadcastGame(room);
    });

    socket.on('reveal-quest', () => {
      const room = getRoomOf(socket.id);
      if (!room || room.phase !== 'quest-vote-ready') return;
      if (room.players[room.currentLeaderIndex].id !== socket.id) return;
      resolveQuestVote(room);
      broadcastGame(room);
    });

    // Explicit leave — only way to be removed from lobby
    socket.on('leave-lobby', () => {
      const room = getRoomOf(socket.id);
      if (!room || room.state !== 'lobby') return;
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) { delete rooms[room.code]; db.deleteRoom(room.code).catch(() => {}); return; }
      if (room.hostId === socket.id) room.hostId = room.players[0].id;
      io.to(room.code).emit('lobby-update', lobbyState(room));
    });

    socket.on('leave-game', () => {
      const room = getRoomOf(socket.id);
      if (!room || room.state !== 'playing') return;
      const player = room.players.find(p => p.id === socket.id);
      if (!player) return;
      room.disconnected = room.disconnected || [];
      if (!room.disconnected.includes(player.name)) room.disconnected.push(player.name);
      const allGone = room.disconnected.length === room.players.length;
      if (allGone) {
        delete rooms[room.code];
        db.deleteRoom(room.code).catch(() => {});
      } else {
        io.to(room.code).emit('game-paused', { disconnected: [...room.disconnected] });
      }
    });

    socket.on('disconnect', () => {
      const room = getRoomOf(socket.id);
      if (!room) return;
      if (room.state === 'lobby') {
        // Do nothing — player stays in lobby until they explicitly leave
      } else {
        // Don't pause if game is already over
        if (room.phase === 'game-over') return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;
        room.disconnected = room.disconnected || [];
        if (!room.disconnected.includes(player.name)) room.disconnected.push(player.name);
        // Auto-delete room if everyone has disconnected
        const allGone = room.disconnected.length === room.players.length;
        if (allGone) {
          delete rooms[room.code];
          db.deleteRoom(room.code).catch(() => {});
        } else {
          io.to(room.code).emit('game-paused', { disconnected: [...room.disconnected] });
        }
      }
    });
  });
};
