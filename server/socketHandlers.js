const { getRoom, getRoomOf, getRoomOfToken, rooms, randomCode } = require('./rooms');
const { assignRoles, buildKnown, isEvil, ladyReading, canPlayQuestCard } = require('./roles');
const { gameState, lobbyState } = require('./state');
const { beginGame, resolveTeamVote, advanceFromTeamVoteResult, resolveQuestVote, advanceFromQuestResult } = require('./gameEngine');
const db = require('./db');

module.exports = function registerHandlers(io) {
  // Live setTimeout handles for the shot clock, keyed by room code. Deliberately
  // outside the room object: rooms get JSON-serialized into the database, and a
  // Timeout is neither serializable nor meaningful after a restart.
  const clockTimers = new Map();

  // A socket can only sensibly be in one room. Without this, creating or joining
  // a second game while still seated in a first leaves the player in both, and
  // getRoomOf() resolves their actions against whichever room it happens to find
  // first — so the board renders one game while the lobby shows another.
  function leaveOtherRooms(socket, keepCode) {
    Object.values(rooms).forEach(room => {
      if (room.code === keepCode) return;
      if (!room.players.some(p => p.id === socket.id)) return;
      room.players = room.players.filter(p => p.id !== socket.id);
      socket.leave(room.code);
      if (room.players.length === 0) {
        delete rooms[room.code];
        db.deleteRoom(room.code).catch(() => {});
        return;
      }
      if (room.hostId === socket.id) room.hostId = room.players[0].id;
      if (room.state === 'lobby') broadcastLobby(room);
      else broadcastGame(room);
    });
  }

  // Returns a finished room to its lobby, keeping the code, the people and the
  // settings. Without this a room is destroyed after one game and the invite
  // link — and the QR everyone just scanned — stops working.
  //
  // Everything a game accumulates is cleared explicitly rather than by spreading
  // a fresh object, so a field added to the engine later shows up here as a
  // stale-state bug rather than silently leaking into the next game.
  function resetToLobby(room) {
    clearClock(room);

    room.state  = 'lobby';
    room.phase  = null;
    room.winner = null;
    room.winReason = null;

    room.currentCampaign = 0;
    room.currentLeaderIndex = 0;
    room.campaignResults = [];
    room.questHistory = [];
    room.consecutiveRejections = 0;

    room.proposedTeam = [];
    room.teamVotes = {};
    room.questVotes = {};
    room.lastTeamVoteResult = null;
    room.lastQuestResult = null;
    room.approvedTeamVote = null;
    room.resultHandled = false;
    room.pendingDispute = null;
    room.pendingAssassination = null;
    room.assassinId = null;

    room.ladyHolder = null;
    room.ladyUsed = [];
    room.ladyHistory = [];
    room.ladyPendingResult = null;

    room.clockFilled = [];
    room.clockSkipped = null;

    // Anyone who walked out during the game is gone; whoever is still here
    // starts the next one un-readied.
    room.players = room.players.filter(p => !(room.disconnected || []).includes(p.name));
    room.disconnected = [];
    room.players.forEach(p => { p.ready = false; p.role = null; });
    if (!room.players.some(p => p.id === room.hostId) && room.players.length) {
      room.hostId = room.players[0].id;
    }
  }

  // An action arriving from a socket the server no longer maps to a player means
  // that client reconnected under a new socket id without re-registering.
  // Silently dropping it is exactly why buttons appear dead until a refresh —
  // tell the client instead, so it can re-sync itself.
  function orphaned(socket) {
    socket.emit('desync');
  }

  function clearClock(room) {
    const t = clockTimers.get(room.code);
    if (t) clearTimeout(t);
    clockTimers.delete(room.code);
    room.clockVotes = {};
    room.clockDeadline = null;
    room.clockPhase = null;
  }

  // Emit game state to everyone in the room and persist to database
  function broadcastGame(room) {
    // Any phase change invalidates a running clock — the thing it was waiting
    // for already happened.
    if (room.clockPhase && room.phase !== room.clockPhase) clearClock(room);
    io.to(room.code).emit('phase-update', gameState(room));
    db.saveRoom(room).catch(e => console.error('[db]', e.message));
  }

  function startClock(room) {
    if (clockTimers.has(room.code)) return;
    const seconds = room.shotClockSeconds || 60;
    room.clockDeadline = Date.now() + seconds * 1000;
    room.clockPhase = room.phase;
    clockTimers.set(room.code, setTimeout(() => {
      clockTimers.delete(room.code);
      expireClock(room);
    }, seconds * 1000));
  }

  // The clock ran out. Force the blocked phase forward.
  function expireClock(room) {
    const phase = room.phase;
    if (phase !== room.clockPhase) return clearClock(room);   // stale

    if (phase === 'team-select') {
      // A skipped proposal counts as a rejection — that is the pressure. It can
      // reach the five-rejection loss, which is the game's own existing valve.
      room.consecutiveRejections = (room.consecutiveRejections || 0) + 1;
      room.clockSkipped = room.players[room.currentLeaderIndex]?.name || null;
      if (room.consecutiveRejections >= 5) {
        room.phase = 'game-over';
        room.winner = 'evil';
        room.winReason = '5 teams rejected in a row';
      } else {
        room.currentLeaderIndex = (room.currentLeaderIndex + 1) % room.players.length;
        room.proposedTeam = [];
        room.teamVotes = {};
      }
    } else if (phase === 'team-vote') {
      // Missing votes count as approve. Reject would let an absent player walk
      // the table into the five-rejection loss without anyone choosing it.
      room.clockFilled = [];
      room.players.forEach(p => {
        if (room.teamVotes[p.id] === undefined) {
          room.teamVotes[p.id] = 'approve';
          room.clockFilled.push(p.id);
        }
      });
      resolveTeamVote(room);
    } else {
      return clearClock(room);   // no honest default for any other phase
    }

    clearClock(room);
    broadcastGame(room);
  }

  // Same for rooms still in the lobby. Without persisting here, a room that
  // hasn't started yet exists only in memory, so a server restart loses it and
  // everyone holding the code gets "Room not found."
  function broadcastLobby(room) {
    io.to(room.code).emit('lobby-update', lobbyState(room));
    db.saveRoom(room).catch(e => console.error('[db]', e.message));
  }

  // Assigns roles, notifies everyone, and begins play. Shared by the
  // random-order path (straight from lobby) and the host-selected-order
  // path (after the host submits their chosen turn order).
  function startGame(room) {
    assignRoles(room);
    // beginGame() first: it picks the starting leader, and the Cleric's
    // information is "is the first leader good or evil" — so the leader has to
    // exist before buildKnown() runs.
    beginGame(room);
    room.players.forEach(p => {
      io.to(p.id).emit('your-role', {
        role: p.role,
        isEvil: isEvil(p.role),
        known: buildKnown(room, p),
      });
    });
    io.to(room.code).emit('game-start');
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
      // Mark them present *before* broadcasting, so the state everyone receives
      // already reflects the reconnect rather than needing a second event.
      room.disconnected = (room.disconnected || []).filter(n => n !== player.name);
      broadcastGame(room);
    } else {
      broadcastLobby(room);
    }
  }

  io.on('connection', socket => {

    socket.on('request-sync', () => {
      const room = getRoomOf(socket.id);
      if (!room) return orphaned(socket);
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
      room.disconnected = room.disconnected.filter(n => n !== player.name);
      broadcastGame(room);
    });

    socket.on('create-room', ({ playerCount, roleConfig, campaignsConfig, name, token, orderMode }) => {
      // Validate the campaign table on the way in. A malformed one used to be
      // stored happily and then dereferenced during propose-team, which threw
      // and took the whole process down — every game on the server, not just
      // this one.
      const validCampaigns = Array.isArray(campaignsConfig)
        && campaignsConfig.length > 0
        && campaignsConfig.every(c => c && Number.isInteger(c.teamSize) && c.teamSize > 0);
      if (!validCampaigns) {
        socket.emit('join-error', 'Invalid quest configuration.');
        return;
      }
      const code = randomCode();
      leaveOtherRooms(socket, code);
      rooms[code] = {
        code, hostId: socket.id, playerCount, roleConfig, campaignsConfig,
        orderMode: orderMode === 'host-selected' ? 'host-selected' : 'random',
        shotClockEnabled: !!roleConfig?.shotClock,
        shotClockSeconds: Math.max(15, Math.min(300, parseInt(roleConfig?.shotClockSeconds, 10) || 60)),
        clockVotes: {},
        players: [{ id: socket.id, name, token: token || null, ready: false, role: null }],
        state: 'lobby',
      };
      socket.join(code);
      socket.emit('room-created', { code });
      broadcastLobby(rooms[code]);
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
      leaveOtherRooms(socket, code);
      room.players.push({ id: socket.id, name, token: token || null, ready: false, role: null });
      socket.join(code);
      socket.emit('room-joined', { code });
      broadcastLobby(room);
    });

    socket.on('toggle-ready', () => {
      const room = getRoomOf(socket.id);
      if (!room) return orphaned(socket);
      if (room.state !== 'lobby') return;
      const player = room.players.find(p => p.id === socket.id);
      if (!player) return;
      player.ready = !player.ready;
      broadcastLobby(room);
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
      if (!room) return orphaned(socket);
      if (room.state !== 'ordering') return;
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

    socket.on('night-round-continue', () => {
      const room = getRoomOf(socket.id);
      if (!room) return orphaned(socket);
      if (room.phase !== 'night-round') return;
      if (room.players[room.currentLeaderIndex].id !== socket.id) return;
      room.phase = 'team-select';
      broadcastGame(room);
    });

    socket.on('propose-team', ({ team }) => {
      const room = getRoomOf(socket.id);
      if (!room) return orphaned(socket);
      if (room.phase !== 'team-select') return;
      const leader = room.players[room.currentLeaderIndex];
      if (leader.id !== socket.id) return;
      const config = room.campaignsConfig?.[room.currentCampaign];
      if (!config) return;   // malformed room — refuse rather than crash the server
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
      if (!room) return orphaned(socket);
      if (room.phase !== 'team-vote') return;
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
      if (!room) return orphaned(socket);
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
      if (!room) return orphaned(socket);
      if (room.phase !== 'team-vote') return;
      if (room.players[room.currentLeaderIndex].id !== socket.id) return;
      room.phase = 'team-select';
      room.proposedTeam = [];
      room.teamVotes = {};
      broadcastGame(room);
    });

    // Any player can call for a shot clock on a stalled phase. At a majority a
    // visible countdown starts; the blocked action happening cancels it.
    socket.on('call-clock', () => {
      const room = getRoomOf(socket.id);
      if (!room) return orphaned(socket);
      if (!room.shotClockEnabled) return;
      if (room.phase !== 'team-select' && room.phase !== 'team-vote') return;
      if (!room.players.some(p => p.id === socket.id)) return;
      if (room.clockDeadline) return;                 // already ticking

      room.clockVotes = room.clockVotes || {};
      if (room.clockVotes[socket.id]) delete room.clockVotes[socket.id];
      else room.clockVotes[socket.id] = true;
      room.clockPhase = room.phase;

      if (Object.keys(room.clockVotes).length >= Math.ceil(room.players.length / 2)) {
        startClock(room);
      }
      broadcastGame(room);
    });

    socket.on('quest-vote', ({ vote }) => {
      const room = getRoomOf(socket.id);
      if (!room) return orphaned(socket);
      if ((room.phase !== 'quest-vote' && room.phase !== 'quest-vote-ready')) return;
      if (!room.proposedTeam.includes(socket.id)) return;
      if (!['pass','fail'].includes(vote)) return;
      const voter = room.players.find(p => p.id === socket.id);
      if (!canPlayQuestCard(room, voter, vote)) return;
      room.questVotes[socket.id] = vote;
      const allQuestVoted = Object.keys(room.questVotes).length === room.proposedTeam.length;
      if (allQuestVoted) room.phase = 'quest-vote-ready';
      broadcastGame(room);
    });

    socket.on('propose-dispute', ({ campaign }) => {
      const room = getRoomOf(socket.id);
      if (!room) return orphaned(socket);
      if (room.state !== 'playing') return;
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
      if (!room) return orphaned(socket);
      if (!room.pendingDispute) return;
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
      if (!room) return orphaned(socket);
      if (room.phase !== 'lady-of-lake') return;
      if (socket.id !== room.ladyHolder) return;
      if (room.ladyUsed.includes(targetId)) return;
      const target = room.players.find(p => p.id === targetId);
      if (!target) return;
      room.ladyPendingResult = { targetId, alignment: ladyReading(target) };
      socket.emit('lady-result', { targetName: target.name, alignment: room.ladyPendingResult.alignment });
    });

    socket.on('lady-announce', ({ announcement }) => {
      const room = getRoomOf(socket.id);
      if (!room) return orphaned(socket);
      if (room.phase !== 'lady-of-lake') return;
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
      if (!room) return orphaned(socket);
      if (room.phase !== 'assassination') return;
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
      if (!room) return orphaned(socket);
      if (room.phase !== 'quest-vote-ready') return;
      if (room.players[room.currentLeaderIndex].id !== socket.id) return;
      resolveQuestVote(room);
      broadcastGame(room);
    });

    // Explicit leave — only way to be removed from lobby
    // Play the same room again. Host-only, and only once a game has finished —
    // otherwise it is a reset button anyone could hit mid-game.
    socket.on('play-again', () => {
      const room = getRoomOf(socket.id);
      if (!room) return orphaned(socket);
      if (room.state !== 'playing' || room.phase !== 'game-over') return;
      if (room.hostId !== socket.id) return socket.emit('action-error', 'Only the host can start another game.');

      resetToLobby(room);
      if (room.players.length === 0) {
        delete rooms[room.code];
        db.deleteRoom(room.code).catch(() => {});
        return;
      }
      io.to(room.code).emit('back-to-lobby');
      broadcastLobby(room);
    });

    // Change the setup while everyone is still gathering — someone dropped out,
    // so drop the target count and rebalance the roles rather than making the
    // host tear the room down and reshare a new link.
    socket.on('update-settings', ({ playerCount, roleConfig, campaignsConfig }) => {
      const room = getRoomOf(socket.id);
      if (!room) return orphaned(socket);
      if (room.state !== 'lobby') return;
      if (room.hostId !== socket.id) return socket.emit('action-error', 'Only the host can change the settings.');

      const count = parseInt(playerCount, 10);
      if (!Number.isInteger(count) || count < 5) {
        return socket.emit('action-error', 'A game needs at least 5 players.');
      }
      // Never set a target below the people already sitting here — that would
      // be unstartable until someone left, with nothing saying why.
      if (count < room.players.length) {
        return socket.emit('action-error',
          `${room.players.length} players have already joined. Remove someone first.`);
      }
      const validCampaigns = Array.isArray(campaignsConfig)
        && campaignsConfig.length > 0
        && campaignsConfig.every(c => c && Number.isInteger(c.teamSize) && c.teamSize > 0);
      if (!validCampaigns) return socket.emit('action-error', 'Invalid quest configuration.');

      const evil = parseInt(roleConfig?.evilCount, 10);
      if (!Number.isInteger(evil) || evil < 1 || evil >= count) {
        return socket.emit('action-error', 'Invalid good/evil split.');
      }
      const good = count - evil;
      const goodSpecials = Array.isArray(roleConfig?.goodSpecials) ? roleConfig.goodSpecials : [];
      const evilSpecials = Array.isArray(roleConfig?.evilSpecials) ? roleConfig.evilSpecials : [];
      // Merlin and the Assassin always occupy one slot on each side.
      if (goodSpecials.length > good - 1 || evilSpecials.length > evil - 1) {
        return socket.emit('action-error', 'Too many special roles for that split.');
      }

      room.playerCount = count;
      room.roleConfig = { ...room.roleConfig, ...roleConfig, evilCount: evil, goodSpecials, evilSpecials };
      room.campaignsConfig = campaignsConfig;
      room.shotClockEnabled = !!roleConfig?.shotClock;
      room.shotClockSeconds = Math.max(15, Math.min(300, parseInt(roleConfig?.shotClockSeconds, 10) || 60));
      // Settings changing under people invalidates their ready state.
      room.players.forEach(p => { p.ready = false; });
      broadcastLobby(room);
    });

    // Host removes someone from the lobby — the person who said they were in
    // and then wandered off. Lobby only: mid-game there are roles in play.
    socket.on('kick-player', ({ playerId }) => {
      const room = getRoomOf(socket.id);
      if (!room) return orphaned(socket);
      if (room.state !== 'lobby') return;
      if (room.hostId !== socket.id) return socket.emit('action-error', 'Only the host can remove players.');
      if (playerId === socket.id) return socket.emit('action-error', 'You cannot remove yourself.');
      if (!room.players.some(p => p.id === playerId)) return;

      io.to(playerId).emit('kicked');
      room.players = room.players.filter(p => p.id !== playerId);
      room.players.forEach(p => { p.ready = false; });
      broadcastLobby(room);
    });

    socket.on('leave-lobby', () => {
      const room = getRoomOf(socket.id);
      if (!room) return orphaned(socket);
      if (room.state !== 'lobby') return;
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) { delete rooms[room.code]; db.deleteRoom(room.code).catch(() => {}); return; }
      if (room.hostId === socket.id) room.hostId = room.players[0].id;
      broadcastLobby(room);
    });

    socket.on('leave-game', () => {
      const room = getRoomOf(socket.id);
      if (!room) return orphaned(socket);
      if (room.state !== 'playing') return;
      const player = room.players.find(p => p.id === socket.id);
      if (!player) return;
      room.disconnected = room.disconnected || [];
      if (!room.disconnected.includes(player.name)) room.disconnected.push(player.name);
      const allGone = room.disconnected.length === room.players.length;
      if (allGone) {
        delete rooms[room.code];
        db.deleteRoom(room.code).catch(() => {});
      } else {
        broadcastGame(room);
      }
    });

    socket.on('disconnect', () => {
      const room = getRoomOf(socket.id);
      if (!room) return orphaned(socket);
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
          broadcastGame(room);
        }
      }
    });
  });
};
