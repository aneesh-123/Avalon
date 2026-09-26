const { getRoom, getRoomOf, getRoomOfToken, rooms, randomCode } = require('./rooms');
const { assignRoles, buildKnown, isEvil, ladyReading, canPlayQuestCard, validateRoleConfig, delegateTarget, questCardRejection } = require('./roles');
const { gameState, lobbyState } = require('./state');
const { beginGame, resolveTeamVote, advanceFromTeamVoteResult, resolveQuestVote, advanceFromQuestResult } = require('./gameEngine');
const db = require('./db');
const { guardedOn, cleanName, isLiveSocket, EMPTY_ROOM_GRACE_MS, later } = require('./safeSocket');

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
      const player = room.players.find(p => p.id === socket.id);
      if (!player) return;
      socket.leave(room.code);
      if (room.state === 'playing' && room.phase !== 'game-over') {
        handOffHost(room, socket.id);
        vacateSeat(room, player);
        broadcastGame(room);
        if (room.players.every(p => room.disconnected.includes(p.name))) scheduleEmptyRoomCleanup(room);
        return;
      }
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) {
        delete rooms[room.code];
        db.deleteRoom(room.code).catch(() => {});
        return;
      }
      if (room.hostId === socket.id) room.hostId = room.players[0].id;
      if (room.state === 'ordering') {
        // The turn order was for a table that no longer exists.
        room.state = 'lobby';
        room.players.forEach(p => { p.ready = false; });
        io.to(room.code).emit('back-to-lobby');
      }
      if (room.state === 'playing') broadcastGame(room);
      else broadcastLobby(room);
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
    room.killerId = null;
    room.assassinDelegated = false;
    room.servantDefected = false;

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

  // A reconnecting player gets a brand new socket id, and the room refers to
  // players by that id in eight different places. Every one of them has to move
  // across together.
  //
  // This used to be written out twice — once for rejoin-room, once for
  // claim-slot — and the second copy stopped after proposedTeam. A player who
  // re-claimed their slot while holding the Assassin, the Lady, or the final
  // shot left those fields pointing at a socket that no longer existed, so the
  // handler guarding that phase (`socket.id !== room.assassinId`) refused them
  // in silence and the game could never advance past it. One list, used by both
  // paths, so a field added later cannot be remembered in only one of them.
  function remapPlayerId(room, oldId, newId, player) {
    if (oldId === newId) return;
    player.id = newId;
    if (room.hostId === oldId) room.hostId = newId;

    for (const map of [room.teamVotes, room.questVotes, room.clockVotes]) {
      if (map && map[oldId] !== undefined) { map[newId] = map[oldId]; delete map[oldId]; }
    }
    for (const key of ['proposedTeam', 'ladyUsed', 'clockFilled']) {
      if (Array.isArray(room[key])) room[key] = room[key].map(id => id === oldId ? newId : id);
    }
    for (const key of ['ladyHolder', 'assassinId', 'killerId']) {
      if (room[key] === oldId) room[key] = newId;
    }
    if (room.pendingDispute?.votes?.[oldId] !== undefined) {
      room.pendingDispute.votes[newId] = room.pendingDispute.votes[oldId];
      delete room.pendingDispute.votes[oldId];
    }
  }

  // Swap socket ID onto player record and emit all rejoin events
  function doRejoin(socket, room, player, token) {
    if (token && !player.token) player.token = token;
    const oldId = player.id;
    if (oldId !== socket.id) remapPlayerId(room, oldId, socket.id, player);
    socket.join(room.code);
    socket.emit('rejoin-ok', { state: room.state });

    if (room.state === 'playing') {
      socket.emit('game-start');
      socket.emit('your-role', { role: player.role, isEvil: isEvil(player.role), known: buildKnown(room, player) });
      // Mark them present *before* broadcasting, so the state everyone receives
      // already reflects the reconnect rather than needing a second event.
      room.disconnected = (room.disconnected || []).filter(n => n !== player.name);
      broadcastGame(room);
    } else if (room.state === 'ordering') {
      // Re-sent to the whole room, not just the rejoiner: the host's drag list
      // holds socket ids, and one that just changed would make submit-order
      // fail its permutation check in silence.
      emitOrderSelect(room);
    } else {
      broadcastLobby(room);
    }
  }

  function emitOrderSelect(room) {
    io.to(room.code).emit('enter-order-select', {
      players: room.players.map(p => ({ id: p.id, name: p.name })),
      hostId: room.hostId,
    });
  }

  // The quest table has to be playable by the table it is for: a team larger
  // than the room can never be proposed, and a missing failsNeeded compared as
  // `fails < undefined`, which is false — every quest failed on a clean sweep.
  function campaignsError(campaignsConfig, playerCount) {
    const ok = Array.isArray(campaignsConfig)
      && campaignsConfig.length > 0
      && campaignsConfig.length <= 10   // the create screen caps it here too
      && campaignsConfig.every(c => c
        && Number.isInteger(c.teamSize) && c.teamSize > 0
        && (!Number.isInteger(playerCount) || c.teamSize <= playerCount)
        && Number.isInteger(c.failsNeeded) && c.failsNeeded >= 1 && c.failsNeeded <= c.teamSize);
    return ok ? null : 'Invalid quest configuration.';
  }

  // Only the fields the engine reads, so a client cannot park arbitrary data
  // in a room that is then persisted and re-broadcast.
  function cleanCampaigns(campaignsConfig) {
    return campaignsConfig.map(c => ({ teamSize: c.teamSize, failsNeeded: c.failsNeeded }));
  }

  // A player who is somewhere else now. Mid-game they cannot simply be deleted
  // from room.players — their role, their seat in the leader order and any
  // team they are on would all vanish — so their slot is kept, pointed at an id
  // no socket will ever have, and marked away. Their token still reclaims it.
  function vacateSeat(room, player) {
    remapPlayerId(room, player.id, `left:${player.id}`, player);
    room.disconnected = room.disconnected || [];
    if (!room.disconnected.includes(player.name)) room.disconnected.push(player.name);
  }

  // Everyone has dropped. Wait before deleting: phones lose their socket every
  // time the app is backgrounded, and a whole table doing that at once is a
  // pause, not the end of the game.
  function scheduleEmptyRoomCleanup(room) {
    later(EMPTY_ROOM_GRACE_MS, () => {
      if (rooms[room.code] !== room) return;
      const present = room.players.filter(p => !(room.disconnected || []).includes(p.name));
      if (present.length) return;
      delete rooms[room.code];
      db.deleteRoom(room.code).catch(() => {});
    });
  }

  // Host powers exist to keep the room moving (play again, settings). A host
  // who has dropped for good would otherwise freeze the room at game over.
  function handOffHost(room, leavingId) {
    if (room.hostId !== leavingId) return;
    const next = room.players.find(p => p.id !== leavingId && !(room.disconnected || []).includes(p.name));
    if (next) room.hostId = next.id;
  }

  io.on('connection', socket => {
    const on = guardedOn(socket, 'avalon');

    on('request-sync', () => {
      const room = getRoomOf(socket.id);
      if (!room) return orphaned(socket);
      if (room.state === 'playing') socket.emit('phase-update', gameState(room));
      else socket.emit('lobby-update', lobbyState(room));
    });

    on('rejoin-room', ({ code, name, token }) => {
      const room = getRoom(code);
      if (!room) { socket.emit('rejoin-error', 'Room not found.'); return; }
      const byToken = token ? room.players.find(p => p.token === token) : null;
      if (byToken) { doRejoin(socket, room, byToken, token); return; }
      // Falling back to the name is for someone whose token was lost. It must
      // not let anyone who knows a name take over a seat that is still in use
      // — that would hand them the player's role card.
      const wanted = cleanName(name).toLowerCase();
      const player = wanted && room.players.find(p => p.name.toLowerCase() === wanted);
      if (!player) { socket.emit('rejoin-error', 'Name not found in that room.'); return; }
      if (player.id !== socket.id && isLiveSocket(io, player.id)) {
        socket.emit('rejoin-error', 'That player is still connected to this room.');
        return;
      }
      doRejoin(socket, room, player, token);
    });

    on('claim-slot', ({ code, claimName, token }) => {
      const room = getRoom(code);
      if (!room || room.state !== 'playing') { socket.emit('join-error', 'Game not in progress.'); return; }
      room.disconnected = room.disconnected || [];
      if (typeof claimName !== 'string' || !room.disconnected.includes(claimName)) { socket.emit('join-error', 'That player is not disconnected.'); return; }
      const player = room.players.find(p => p.name === claimName);
      if (!player) { socket.emit('join-error', 'Player not found.'); return; }
      if (token) player.token = token;
      const oldId = player.id;
      remapPlayerId(room, oldId, socket.id, player);
      leaveOtherRooms(socket, code);
      socket.join(code);
      socket.emit('rejoin-ok', { state: 'playing', claimedName: player.name });
      socket.emit('game-start');
      socket.emit('your-role', { role: player.role, isEvil: isEvil(player.role), known: buildKnown(room, player) });
      room.disconnected = room.disconnected.filter(n => n !== player.name);
      broadcastGame(room);
    });

    on('create-room', ({ playerCount, roleConfig, campaignsConfig, name, token, orderMode }) => {
      // Validate the campaign table on the way in. A malformed one used to be
      // stored happily and then dereferenced during propose-team, which threw
      // and took the whole process down — every game on the server, not just
      // this one.
      const count = parseInt(playerCount, 10);
      const campaignError = campaignsError(campaignsConfig, count);
      if (campaignError) { socket.emit('join-error', campaignError); return; }
      const setupError = validateRoleConfig(count, roleConfig);
      if (setupError) { socket.emit('join-error', setupError); return; }
      const hostName = cleanName(name);
      if (!hostName) { socket.emit('join-error', 'Enter your name.'); return; }

      const code = randomCode();
      leaveOtherRooms(socket, code);
      rooms[code] = {
        // playerCount is stored as a number: toggle-ready compares it with
        // `===`, so a string "5" from a client meant the game never started.
        code, hostId: socket.id, playerCount: count, roleConfig,
        campaignsConfig: cleanCampaigns(campaignsConfig),
        orderMode: orderMode === 'host-selected' ? 'host-selected' : 'random',
        shotClockSeconds: Math.max(15, Math.min(300, parseInt(roleConfig?.shotClockSeconds, 10) || 60)),
        clockVotes: {},
        players: [{ id: socket.id, name: hostName, token: typeof token === 'string' ? token : null, ready: false, role: null }],
        state: 'lobby',
      };
      socket.join(code);
      socket.emit('room-created', { code });
      broadcastLobby(rooms[code]);
    });

    on('join-room', ({ code, name: rawName, token }) => {
      const room = getRoom(code);
      if (!room) { socket.emit('join-error', 'Room not found.'); return; }
      const name = cleanName(rawName);
      if (!name) { socket.emit('join-error', 'Enter your name.'); return; }
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
      // Already seated here (a double-tapped Join): nothing to add.
      if (room.players.some(p => p.id === socket.id)) { socket.emit('room-joined', { code }); broadcastLobby(room); return; }
      leaveOtherRooms(socket, code);
      room.players.push({ id: socket.id, name, token: typeof token === 'string' ? token : null, ready: false, role: null });
      socket.join(code);
      socket.emit('room-joined', { code });
      broadcastLobby(room);
    });

    on('toggle-ready', () => {
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
          emitOrderSelect(room);
          db.saveRoom(room).catch(e => console.error('[db]', e.message));
        } else {
          startGame(room);
        }
      }
    });

    on('submit-order', ({ order, randomizeStart }) => {
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

    on('night-round-continue', () => {
      const room = getRoomOf(socket.id);
      if (!room) return orphaned(socket);
      if (room.phase !== 'night-round') return;
      if (room.players[room.currentLeaderIndex].id !== socket.id) return;
      room.phase = 'team-select';
      broadcastGame(room);
    });

    on('propose-team', ({ team }) => {
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
      // A repeated id would pass the size check with fewer real members, and
      // the quest would then wait forever for a vote nobody else can cast.
      if (new Set(team).size !== team.length) return;
      room.proposedTeam = [...team];
      room.phase = 'team-vote';
      room.teamVotes = { [socket.id]: 'approve' };
      broadcastGame(room);
      if (Object.keys(room.teamVotes).length === room.players.length) {
        resolveTeamVote(room);
        broadcastGame(room);
      }
    });

    on('team-vote', ({ vote }) => {
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

    on('continue-game', () => {
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

    on('cancel-proposal', () => {
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
    on('call-clock', () => {
      const room = getRoomOf(socket.id);
      if (!room) return orphaned(socket);
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

    on('quest-vote', ({ vote }) => {
      const room = getRoomOf(socket.id);
      if (!room) return orphaned(socket);
      // Every path out of this handler either acknowledges or refuses out loud.
      // The client shows a card as cast only once it hears back, so a handler
      // that returns in silence leaves the player believing they have voted
      // while the quest sits at "1/2 voted" forever.
      const refuse = reason => socket.emit('quest-vote-rejected', { vote, reason });

      if (room.phase !== 'quest-vote' && room.phase !== 'quest-vote-ready') {
        return refuse('That quest has already moved on.');
      }
      if (!room.proposedTeam.includes(socket.id)) {
        return refuse('You are not on this quest.');
      }
      const voter = room.players.find(p => p.id === socket.id);
      const rejection = questCardRejection(room, voter, vote);
      if (rejection) return refuse(rejection);
      room.questVotes[socket.id] = vote;
      // Acknowledge to the voter alone. The client waits for this before it
      // shows the vote as cast, so an unrecorded vote can never look recorded.
      socket.emit('quest-vote-ok', { vote });
      const allQuestVoted = Object.keys(room.questVotes).length === room.proposedTeam.length;
      if (allQuestVoted) room.phase = 'quest-vote-ready';
      broadcastGame(room);
    });

    on('propose-dispute', ({ campaign }) => {
      const room = getRoomOf(socket.id);
      if (!room) return orphaned(socket);
      if (room.state !== 'playing') return;
      // A finished game is finished: flipping a result after the reveal used to
      // clear the winner while leaving the table on the game-over screen.
      if (room.phase === 'game-over') return;
      if (!Number.isInteger(campaign) || campaign < 0 || campaign >= room.campaignResults.length) return;
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

    on('dispute-vote', ({ approve }) => {
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
      if (room.players.every(p => d.votes[p.id])) {
        const { campaign, proposedResult } = d;
        room.campaignResults[campaign] = proposedResult;
        if (room.questHistory[campaign]) room.questHistory[campaign].passed = proposedResult === 'pass';
        const total    = room.campaignsConfig.length;
        const toWin    = Math.ceil(total / 2);
        const passes   = room.campaignResults.filter(r => r === 'pass').length;
        const failures = room.campaignResults.filter(r => r === 'fail').length;
        if (passes >= toWin && !room.winner) { room.pendingAssassination = true; room.phase = 'assassination'; }
        else if (failures >= toWin)         { room.winner = 'evil'; room.winReason = 'Quest results corrected'; room.phase = 'game-over'; }
        else {
          room.winner = null; room.winReason = null;
          // The correction undid the win that was about to be (or being)
          // resolved. Without clearing this the quest-result screen still led
          // to the assassination, and an assassination already under way had
          // no way back to the quests.
          room.pendingAssassination = false;
          if (room.phase === 'assassination') {
            room.killerId = null;
            room.assassinDelegated = false;
            room.currentCampaign++;
            room.currentLeaderIndex = (room.currentLeaderIndex + 1) % room.players.length;
            room.phase = 'team-select';
            room.proposedTeam = [];
            room.teamVotes = {};
            room.questVotes = {};
          }
        }
        room.pendingDispute = null;
        broadcastGame(room);
      } else {
        broadcastGame(room);
      }
    });

    on('lady-investigate', ({ targetId }) => {
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

    on('lady-announce', ({ announcement }) => {
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
        announcement: announcement === 'evil' ? 'evil' : 'good',
      });
      if (!room.ladyUsed.includes(targetId)) room.ladyUsed.push(targetId);
      room.ladyHolder = targetId;
      room.ladyPendingResult = null;
      room.phase = 'team-select';
      broadcastGame(room);
    });

    // The Assassin hands the final shot to the Untrustworthy Servant. One-way
    // and one-time: once given away it cannot be taken back, which is what
    // makes it a real decision rather than a free look.
    on('delegate-assassination', () => {
      const room = getRoomOf(socket.id);
      if (!room) return orphaned(socket);
      if (room.phase !== 'assassination') return;
      if (socket.id !== room.assassinId) return;
      if (room.assassinDelegated) return;
      const servant = delegateTarget(room);
      if (!servant) return;
      room.killerId = servant.id;
      room.assassinDelegated = true;
      broadcastGame(room);
    });

    on('assassinate', ({ targetId }) => {
      const room = getRoomOf(socket.id);
      if (!room) return orphaned(socket);
      if (room.phase !== 'assassination') return;
      // Whoever holds the shot — the Assassin, or the Servant they gave it to.
      if (socket.id !== (room.killerId || room.assassinId)) return;
      const target = room.players.find(p => p.id === targetId);
      if (!target) return;
      const byServant = room.assassinDelegated;
      const shooter   = room.players.find(p => p.id === socket.id);
      if (target.role === 'Merlin') {
        room.winner = 'evil';
        if (byServant) {
          // The Servant defects: Evil takes the game and the Servant goes with
          // them. The one case where a Good role wins on the Evil side.
          room.servantDefected = true;
          room.winReason = `${shooter.name}, the Untrustworthy Servant, named Merlin and turned — Evil wins!`;
        } else {
          room.winReason = 'The Assassin identified Merlin!';
        }
      } else {
        // A miss is a miss whoever fired it. The Servant is Good, so they win
        // with Good here — losing their own team's game on a bad guess would
        // punish a player for a choice an enemy forced on them. To make a miss
        // cost the Servant personally, set winner to 'good' but flag them out
        // of the winning set at game-over instead.
        room.winner = 'good';
        room.winReason = byServant
          ? `${shooter.name} was handed the knife and missed — ${target.name} was not Merlin. Good prevails!`
          : `${target.name} was not Merlin — Good prevails!`;
      }
      room.phase = 'game-over';
      broadcastGame(room);
    });

    on('reveal-quest', () => {
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
    on('play-again', () => {
      const room = getRoomOf(socket.id);
      if (!room) return orphaned(socket);
      if (room.state !== 'playing' || room.phase !== 'game-over') return;
      if (room.hostId !== socket.id) {
        // A host who dropped out and never came back would otherwise leave the
        // table unable to play again, so the first person to ask takes over.
        const host = room.players.find(p => p.id === room.hostId);
        const hostAway = !host || (room.disconnected || []).includes(host.name);
        if (!hostAway) return socket.emit('action-error', 'Only the host can start another game.');
        room.hostId = socket.id;
      }

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
    on('update-settings', ({ playerCount, roleConfig, campaignsConfig }) => {
      const room = getRoomOf(socket.id);
      if (!room) return orphaned(socket);
      if (room.state !== 'lobby') return;
      if (room.hostId !== socket.id) return socket.emit('action-error', 'Only the host can change the settings.');

      const count = parseInt(playerCount, 10);
      // Never set a target below the people already sitting here — that would
      // be unstartable until someone left, with nothing saying why.
      if (count < room.players.length) {
        return socket.emit('action-error',
          `${room.players.length} players have already joined. Remove someone first.`);
      }
      const campaignError = campaignsError(campaignsConfig, count);
      if (campaignError) return socket.emit('action-error', campaignError);

      // One validator for both the create and edit paths, so they cannot drift.
      const setupError = validateRoleConfig(count, roleConfig);
      if (setupError) return socket.emit('action-error', setupError);

      room.playerCount = count;
      room.roleConfig = {
        ...room.roleConfig,
        ...roleConfig,
        evilCount: parseInt(roleConfig.evilCount, 10),
        goodSpecials: [...(roleConfig.goodSpecials || [])],
        evilSpecials: [...(roleConfig.evilSpecials || [])],
      };
      room.campaignsConfig = cleanCampaigns(campaignsConfig);
      room.shotClockSeconds = Math.max(15, Math.min(300, parseInt(roleConfig?.shotClockSeconds, 10) || 60));
      // Settings changing under people invalidates their ready state.
      room.players.forEach(p => { p.ready = false; });
      broadcastLobby(room);
    });

    // Host removes someone from the lobby — the person who said they were in
    // and then wandered off. Lobby only: mid-game there are roles in play.
    on('kick-player', ({ playerId }) => {
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

    on('leave-lobby', () => {
      const room = getRoomOf(socket.id);
      if (!room) return orphaned(socket);
      if (room.state !== 'lobby') return;
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) { delete rooms[room.code]; db.deleteRoom(room.code).catch(() => {}); return; }
      if (room.hostId === socket.id) room.hostId = room.players[0].id;
      broadcastLobby(room);
    });

    on('leave-game', () => {
      const room = getRoomOf(socket.id);
      if (!room) return orphaned(socket);
      if (room.state !== 'playing') return;
      const player = room.players.find(p => p.id === socket.id);
      if (!player) return;
      room.disconnected = room.disconnected || [];
      if (!room.disconnected.includes(player.name)) room.disconnected.push(player.name);
      handOffHost(room, socket.id);
      socket.leave(room.code);
      const allGone = room.players.every(p => room.disconnected.includes(p.name));
      if (allGone) {
        delete rooms[room.code];
        db.deleteRoom(room.code).catch(() => {});
      } else {
        broadcastGame(room);
      }
    });

    on('disconnect', () => {
      const room = getRoomOf(socket.id);
      if (!room) return;   // nobody left to tell
      if (room.state === 'lobby' || room.state === 'ordering') {
        // Do nothing — player stays in lobby until they explicitly leave.
        // The order screen is still pre-game: nothing is blocked on them, and
        // a phase-update here would push a game screen at a table with no game.
      } else {
        // Don't pause if game is already over — but do pass the host on, or
        // nobody is left who can start the next one.
        if (room.phase === 'game-over') { handOffHost(room, socket.id); return; }
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;
        room.disconnected = room.disconnected || [];
        if (!room.disconnected.includes(player.name)) room.disconnected.push(player.name);
        // No host hand-off here: mid-game the host has no powers, and a host
        // whose phone merely locked should come back as host. play-again
        // covers a host who never returns.
        const allGone = room.players.every(p => room.disconnected.includes(p.name));
        broadcastGame(room);
        if (allGone) scheduleEmptyRoomCleanup(room);
      }
    });
  });
};
