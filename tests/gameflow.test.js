/**
 * Game flow tests — drives the full game lifecycle through socket events,
 * verifying phase transitions, vote resolution, and win conditions.
 */

const registerHandlers = require('../server/socketHandlers');
const { rooms }        = require('../server/rooms');
const { gameState }    = require('../server/state');
const { makeIo, connectSocket, buildRoom, startGame, clearRooms } = require('./helpers');

jest.mock('../server/db', () => ({
  saveRoom:   () => Promise.resolve(),
  deleteRoom: () => Promise.resolve(),
  loadRooms:  () => Promise.resolve([]),
}));

let io;
beforeEach(() => {
  clearRooms();
  ({ io } = makeIo());
  registerHandlers(io);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePlayers(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, name: `Player${i + 1}` }));
}

// Connect all player sockets and join them to the given room code
function connectAll(io, playerDefs, roomCode) {
  return playerDefs.map(({ id }) => {
    const socket = connectSocket(io, id);
    if (roomCode) socket.join(roomCode);
    return socket;
  });
}

// ── 1. Lobby ──────────────────────────────────────────────────────────────────
describe('lobby', () => {
  test('create-room puts host in room and emits room-created', () => {
    const socket = connectSocket(io, 's1');
    socket.trigger('create-room', {
      playerCount: 5, name: 'Alice', token: 'tok1',
      roleConfig: { evilCount: 2, goodSpecials: [], evilSpecials: [], ladyOfLake: false },
      campaignsConfig: [{ teamSize: 2, failsNeeded: 1 }],
    });
    expect(socket.last('room-created')).toBeDefined();
    const code = socket.last('room-created').code;
    expect(rooms[code]).toBeDefined();
    expect(rooms[code].players[0].name).toBe('Alice');
  });

  test('join-room adds player and emits room-joined', () => {
    const s1 = connectSocket(io, 's1');
    s1.trigger('create-room', {
      playerCount: 5, name: 'Alice', token: 'tok1',
      roleConfig: { evilCount: 2, goodSpecials: [], evilSpecials: [], ladyOfLake: false },
      campaignsConfig: [{ teamSize: 2, failsNeeded: 1 }],
    });
    const code = s1.last('room-created').code;

    const s2 = connectSocket(io, 's2');
    s2.trigger('join-room', { code, name: 'Bob', token: 'tok2' });
    expect(s2.last('room-joined')).toBeDefined();
    expect(rooms[code].players).toHaveLength(2);
  });

  test('join-room rejects duplicate name', () => {
    const s1 = connectSocket(io, 's1');
    s1.trigger('create-room', {
      playerCount: 5, name: 'Alice', token: 't1',
      roleConfig: { evilCount: 2, goodSpecials: [], evilSpecials: [], ladyOfLake: false },
      campaignsConfig: [{ teamSize: 2, failsNeeded: 1 }],
    });
    const code = s1.last('room-created').code;

    const s2 = connectSocket(io, 's2');
    s2.trigger('join-room', { code, name: 'alice', token: 't2' }); // case-insensitive
    expect(s2.last('join-error')).toBe('Name taken.');
  });

  test('leave-lobby removes player and cleans up empty room', () => {
    const s1 = connectSocket(io, 's1');
    s1.trigger('create-room', {
      playerCount: 5, name: 'Alice', token: 't1',
      roleConfig: { evilCount: 2, goodSpecials: [], evilSpecials: [], ladyOfLake: false },
      campaignsConfig: [{ teamSize: 2, failsNeeded: 1 }],
    });
    const code = s1.last('room-created').code;
    s1.trigger('leave-lobby');
    expect(rooms[code]).toBeUndefined();
  });

  test('toggle-ready starts game when all players ready', () => {
    const playerDefs = makePlayers(5);
    const room = buildRoom('START', playerDefs, {
      roleConfig: { evilCount: 2, goodSpecials: [], evilSpecials: [], ladyOfLake: false },
    });
    const sockets = connectAll(io, playerDefs, room.code);

    sockets.forEach(s => s.trigger('toggle-ready'));

    expect(room.state).toBe('playing');
    expect(room.phase).toBe('team-select');
    sockets.forEach(s => {
      expect(s.received('game-start')).toBe(true);
      expect(s.last('your-role')).toBeDefined();
    });
  });
});

// ── 2. Team proposal and voting ───────────────────────────────────────────────
describe('team proposal and voting', () => {
  test('leader can propose a valid team', () => {
    const playerDefs = makePlayers(5);
    const room = buildRoom('PROP1', playerDefs, {
      roleConfig: { evilCount: 2, goodSpecials: [], evilSpecials: [], ladyOfLake: false },
    });
    startGame(room);
    const sockets = connectAll(io, playerDefs, room.code);
    const leaderSocket = sockets[room.currentLeaderIndex];

    leaderSocket.trigger('propose-team', { team: [room.players[0].id, room.players[1].id] });

    expect(room.phase).toBe('team-vote');
    expect(room.proposedTeam).toHaveLength(2);
  });

  test('non-leader cannot propose a team', () => {
    const playerDefs = makePlayers(5);
    const room = buildRoom('PROP2', playerDefs, {
      roleConfig: { evilCount: 2, goodSpecials: [], evilSpecials: [], ladyOfLake: false },
    });
    startGame(room);
    const sockets = connectAll(io, playerDefs, room.code);
    const nonLeader = sockets[(room.currentLeaderIndex + 1) % 5];

    nonLeader.trigger('propose-team', { team: [room.players[0].id, room.players[1].id] });

    expect(room.phase).toBe('team-select');
  });

  test('team is approved when majority approve', () => {
    const playerDefs = makePlayers(5);
    const room = buildRoom('VOTE1', playerDefs, {
      roleConfig: { evilCount: 2, goodSpecials: [], evilSpecials: [], ladyOfLake: false },
    });
    startGame(room);
    const sockets = connectAll(io, playerDefs, room.code);
    const leaderSocket = sockets[room.currentLeaderIndex];

    leaderSocket.trigger('propose-team', { team: [room.players[0].id, room.players[1].id] });

    // 3 approve, 2 reject
    sockets[0].trigger('team-vote', { vote: 'approve' });
    sockets[1].trigger('team-vote', { vote: 'approve' });
    sockets[2].trigger('team-vote', { vote: 'approve' });
    sockets[3].trigger('team-vote', { vote: 'reject' });
    sockets[4].trigger('team-vote', { vote: 'reject' });

    expect(room.phase).toBe('team-vote-result');
    expect(room.lastTeamVoteResult.approved).toBe(true);
  });

  test('team is rejected when majority reject', () => {
    const playerDefs = makePlayers(5);
    const room = buildRoom('VOTE2', playerDefs, {
      roleConfig: { evilCount: 2, goodSpecials: [], evilSpecials: [], ladyOfLake: false },
    });
    startGame(room);
    const sockets = connectAll(io, playerDefs, room.code);
    const leaderSocket = sockets[room.currentLeaderIndex];

    leaderSocket.trigger('propose-team', { team: [room.players[0].id, room.players[1].id] });
    // Leader auto-votes approve on propose; non-leaders all reject → majority reject
    sockets.forEach((s, i) => { if (s !== leaderSocket) s.trigger('team-vote', { vote: 'reject' }); });

    expect(room.lastTeamVoteResult.approved).toBe(false);
    expect(room.consecutiveRejections).toBe(1);
  });

  test('5 consecutive rejections ends the game', () => {
    const playerDefs = makePlayers(5);
    const room = buildRoom('VOTE3', playerDefs, {
      roleConfig: { evilCount: 2, goodSpecials: [], evilSpecials: [], ladyOfLake: false },
    });
    startGame(room);
    const sockets = connectAll(io, playerDefs, room.code);

    for (let i = 0; i < 5; i++) {
      const leaderSocket = sockets[room.currentLeaderIndex];
      leaderSocket.trigger('propose-team', { team: [room.players[0].id, room.players[1].id] });
      sockets.forEach(s => s.trigger('team-vote', { vote: 'reject' }));
      if (room.phase === 'team-vote-result') {
        sockets[0].trigger('continue-game');
      }
    }

    expect(room.winner).toBe('evil');
    expect(room.phase).toBe('game-over');
  });

  test('leader can cancel proposal and return to team-select', () => {
    const playerDefs = makePlayers(5);
    const room = buildRoom('CANC1', playerDefs, {
      roleConfig: { evilCount: 2, goodSpecials: [], evilSpecials: [], ladyOfLake: false },
    });
    startGame(room);
    const sockets = connectAll(io, playerDefs, room.code);
    const leaderSocket = sockets[room.currentLeaderIndex];

    leaderSocket.trigger('propose-team', { team: [room.players[0].id, room.players[1].id] });
    expect(room.phase).toBe('team-vote');

    leaderSocket.trigger('cancel-proposal');
    expect(room.phase).toBe('team-select');
    expect(room.proposedTeam).toHaveLength(0);
  });
});

// ── 3. Quest voting ───────────────────────────────────────────────────────────
describe('quest voting', () => {
  function setupQuestVote(code) {
    const playerDefs = makePlayers(5);
    const room = buildRoom(code, playerDefs, {
      roleConfig: { evilCount: 2, goodSpecials: [], evilSpecials: [], ladyOfLake: false },
    });
    startGame(room);
    const sockets = connectAll(io, playerDefs, room.code);
    const leaderSocket = sockets[room.currentLeaderIndex];

    // Propose team and get approved
    const teamIds = [room.players[0].id, room.players[1].id];
    leaderSocket.trigger('propose-team', { team: teamIds });
    sockets.forEach(s => s.trigger('team-vote', { vote: 'approve' }));
    sockets[0].trigger('continue-game'); // advance past team-vote-result

    return { room, sockets, leaderSocket };
  }

  test('quest passes when all team members pass', () => {
    const { room, sockets, leaderSocket } = setupQuestVote('QV001');

    sockets[0].trigger('quest-vote', { vote: 'pass' });
    sockets[1].trigger('quest-vote', { vote: 'pass' });
    leaderSocket.trigger('reveal-quest');

    expect(room.campaignResults[0]).toBe('pass');
  });

  test('quest fails when one fail vote cast', () => {
    const { room, sockets, leaderSocket } = setupQuestVote('QV002');
    room.players[1].role = 'Assassin'; // only evil players may vote fail

    sockets[0].trigger('quest-vote', { vote: 'pass' });
    sockets[1].trigger('quest-vote', { vote: 'fail' });
    leaderSocket.trigger('reveal-quest');

    expect(room.campaignResults[0]).toBe('fail');
  });

  test('only team members can cast quest votes', () => {
    const { room, sockets } = setupQuestVote('QV003');

    // sockets[2] is NOT on the proposed team (team is players[0] and [1])
    const nonMember = sockets.find(s => !room.proposedTeam.includes(s.id));
    const votesBefore = Object.keys(room.questVotes).length;
    nonMember.trigger('quest-vote', { vote: 'fail' });

    expect(Object.keys(room.questVotes).length).toBe(votesBefore);
  });
});

// ── 4. Win conditions ─────────────────────────────────────────────────────────
describe('win conditions', () => {
  function runQuests(room, sockets, results) {
    const { resolveTeamVote, advanceFromTeamVoteResult, resolveQuestVote, advanceFromQuestResult } = require('../server/gameEngine');

    results.forEach(result => {
      const config = room.campaignsConfig[room.currentCampaign];
      room.proposedTeam = room.players.slice(0, config.teamSize).map(p => p.id);
      room.teamVotes = {};
      room.players.forEach(p => { room.teamVotes[p.id] = 'approve'; });
      resolveTeamVote(room);
      advanceFromTeamVoteResult(room);

      room.proposedTeam.forEach(id => { room.questVotes[id] = result; });
      resolveQuestVote(room);
      advanceFromQuestResult(room);
    });
  }

  test('3 quest passes triggers assassination phase', () => {
    const playerDefs = makePlayers(5);
    const room = buildRoom('WIN1', playerDefs, {
      roleConfig: { evilCount: 2, goodSpecials: [], evilSpecials: [], ladyOfLake: false },
    });
    startGame(room);
    const sockets = connectAll(io, playerDefs, room.code);

    runQuests(room, sockets, ['pass', 'pass', 'pass']);

    expect(room.phase).toBe('assassination');
  });

  test('3 quest failures ends game as evil win', () => {
    const playerDefs = makePlayers(5);
    const room = buildRoom('WIN2', playerDefs, {
      roleConfig: { evilCount: 2, goodSpecials: [], evilSpecials: [], ladyOfLake: false },
    });
    startGame(room);
    const sockets = connectAll(io, playerDefs, room.code);

    runQuests(room, sockets, ['fail', 'fail', 'fail']);

    expect(room.winner).toBe('evil');
    expect(room.phase).toBe('game-over');
  });

  test('assassin killing Merlin makes evil win', () => {
    const playerDefs = makePlayers(5);
    const room = buildRoom('WIN3', playerDefs, {
      roleConfig: { evilCount: 2, goodSpecials: [], evilSpecials: [], ladyOfLake: false },
    });
    startGame(room);
    const sockets = connectAll(io, playerDefs, room.code);

    runQuests(room, sockets, ['pass', 'pass', 'pass']);
    expect(room.phase).toBe('assassination');

    const merlinId    = room.players.find(p => p.role === 'Merlin').id;
    const assassinSocket = sockets.find(s => s.id === room.assassinId);
    assassinSocket.trigger('assassinate', { targetId: merlinId });

    expect(room.winner).toBe('evil');
    expect(room.winReason).toContain('Merlin');
  });

  test('assassin missing Merlin makes good win', () => {
    const playerDefs = makePlayers(5);
    const room = buildRoom('WIN4', playerDefs, {
      roleConfig: { evilCount: 2, goodSpecials: [], evilSpecials: [], ladyOfLake: false },
    });
    startGame(room);
    const sockets = connectAll(io, playerDefs, room.code);

    runQuests(room, sockets, ['pass', 'pass', 'pass']);

    const nonMerlin   = room.players.find(p => p.role !== 'Merlin').id;
    const assassinSocket = sockets.find(s => s.id === room.assassinId);
    assassinSocket.trigger('assassinate', { targetId: nonMerlin });

    expect(room.winner).toBe('good');
  });
});
