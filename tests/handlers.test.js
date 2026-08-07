/**
 * Handler tests for the game options that sit outside the core quest loop:
 * host-selected turn order, quest-result disputes, and Lady of the Lake.
 *
 * These are all host/table-driven features that mutate shared game state, so a
 * regression here silently corrupts a live game rather than throwing.
 */

const registerHandlers = require('../server/socketHandlers');
const { isEvil }       = require('../server/roles');
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

function makePlayers(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, name: `Player${i + 1}` }));
}

function connectAll(io, playerDefs, roomCode) {
  return playerDefs.map(({ id }) => {
    const socket = connectSocket(io, id);
    if (roomCode) socket.join(roomCode);
    return socket;
  });
}

// ── Host-selected turn order ──────────────────────────────────────────────────
describe('host-selected turn order', () => {
  function readyRoom(code = 'ORDER') {
    const playerDefs = makePlayers(5);
    const room = buildRoom(code, playerDefs, { orderMode: 'host-selected' });
    const sockets = connectAll(io, playerDefs, code);
    sockets.forEach(s => s.trigger('toggle-ready'));
    return { room, sockets };
  }

  test('all-ready enters the ordering phase instead of starting the game', () => {
    const { room, sockets } = readyRoom();

    expect(room.state).toBe('ordering');
    expect(sockets[0].last('enter-order-select')).toMatchObject({ hostId: 's1' });
    expect(sockets[0].last('enter-order-select').players).toHaveLength(5);
    expect(sockets[0].received('game-start')).toBe(false);
  });

  test('host submitting an order reseats the players and starts the game', () => {
    const { room, sockets } = readyRoom();

    sockets[0].trigger('submit-order', { order: ['s3', 's1', 's5', 's2', 's4'], randomizeStart: false });

    expect(room.state).toBe('playing');
    expect(room.players.map(p => p.id)).toEqual(['s3', 's1', 's5', 's2', 's4']);
    sockets.forEach(s => expect(s.received('game-start')).toBe(true));
  });

  test('randomizeStart false starts with the first player in the host order', () => {
    const { room, sockets } = readyRoom();

    sockets[0].trigger('submit-order', { order: ['s4', 's2', 's1', 's5', 's3'], randomizeStart: false });

    expect(room.currentLeaderIndex).toBe(0);
    expect(room.players[room.currentLeaderIndex].id).toBe('s4');
  });

  test('a non-host cannot submit the order', () => {
    const { room, sockets } = readyRoom();

    sockets[2].trigger('submit-order', { order: ['s3', 's1', 's5', 's2', 's4'], randomizeStart: false });

    expect(room.state).toBe('ordering');
  });

  test.each([
    ['a missing player',   ['s1', 's2', 's3', 's4']],
    ['a duplicate player', ['s1', 's1', 's3', 's4', 's5']],
    ['an unknown player',  ['s1', 's2', 's3', 's4', 'ghost']],
    ['not an array',       's1,s2,s3,s4,s5'],
  ])('an order with %s is rejected', (_label, order) => {
    const { room, sockets } = readyRoom();

    sockets[0].trigger('submit-order', { order, randomizeStart: false });

    expect(room.state).toBe('ordering');
  });
});

// ── Quest result disputes ─────────────────────────────────────────────────────
describe('quest result disputes', () => {
  function disputableRoom(code = 'DISPUTE', results = ['pass']) {
    const playerDefs = makePlayers(5);
    const room = buildRoom(code, playerDefs);
    const sockets = connectAll(io, playerDefs, code);
    startGame(room);
    room.campaignResults = [...results];
    room.questHistory = results.map((r, i) => ({ campaign: i, passed: r === 'pass' }));
    return { room, sockets };
  }

  test('a player can propose flipping a recorded result', () => {
    const { room, sockets } = disputableRoom();

    sockets[1].trigger('propose-dispute', { campaign: 0 });

    expect(room.pendingDispute).toMatchObject({
      campaign: 0, proposerName: 'Player2', proposedResult: 'fail',
    });
    expect(room.pendingDispute.votes.s2).toBe(true);
  });

  test('a dispute on a campaign with no result is ignored', () => {
    const { room, sockets } = disputableRoom();

    sockets[1].trigger('propose-dispute', { campaign: 3 });

    expect(room.pendingDispute).toBeUndefined();
  });

  test('a second dispute cannot open while one is pending', () => {
    const { room, sockets } = disputableRoom();
    sockets[1].trigger('propose-dispute', { campaign: 0 });

    sockets[2].trigger('propose-dispute', { campaign: 0 });

    expect(room.pendingDispute.proposerName).toBe('Player2');
  });

  test('a single rejection cancels the dispute immediately', () => {
    const { room, sockets } = disputableRoom();
    sockets[1].trigger('propose-dispute', { campaign: 0 });

    sockets[3].trigger('dispute-vote', { approve: false });

    expect(room.pendingDispute).toBeNull();
    expect(room.campaignResults[0]).toBe('pass');
  });

  test('unanimous approval flips the result and the quest history', () => {
    const { room, sockets } = disputableRoom();
    sockets[1].trigger('propose-dispute', { campaign: 0 });

    sockets.forEach(s => s.trigger('dispute-vote', { approve: true }));

    expect(room.campaignResults[0]).toBe('fail');
    expect(room.questHistory[0].passed).toBe(false);
    expect(room.pendingDispute).toBeNull();
  });

  test('a flip that reaches three failures ends the game for evil', () => {
    const { room, sockets } = disputableRoom('D3', ['fail', 'fail', 'pass']);
    sockets[1].trigger('propose-dispute', { campaign: 2 });

    sockets.forEach(s => s.trigger('dispute-vote', { approve: true }));

    expect(room.winner).toBe('evil');
    expect(room.phase).toBe('game-over');
  });

  test('a flip that reaches three passes sends the game to assassination', () => {
    const { room, sockets } = disputableRoom('D4', ['pass', 'pass', 'fail']);
    sockets[1].trigger('propose-dispute', { campaign: 2 });

    sockets.forEach(s => s.trigger('dispute-vote', { approve: true }));

    expect(room.phase).toBe('assassination');
    expect(room.pendingAssassination).toBe(true);
  });

  test('the dispute stays open until every player has voted', () => {
    const { room, sockets } = disputableRoom();
    sockets[1].trigger('propose-dispute', { campaign: 0 });

    sockets[2].trigger('dispute-vote', { approve: true });
    sockets[3].trigger('dispute-vote', { approve: true });

    expect(room.pendingDispute).not.toBeNull();
    expect(room.campaignResults[0]).toBe('pass');
  });
});

// ── Lady of the Lake ──────────────────────────────────────────────────────────
describe('lady of the lake', () => {
  function ladyRoom(code = 'LADY') {
    const playerDefs = makePlayers(5);
    const room = buildRoom(code, playerDefs, {
      roleConfig: { evilCount: 2, goodSpecials: [], evilSpecials: [], ladyOfLake: true },
    });
    const sockets = connectAll(io, playerDefs, code);
    startGame(room);
    room.phase = 'lady-of-lake';
    const holderSocket = sockets.find(s => s.id === room.ladyHolder);
    const target = room.players.find(p => !room.ladyUsed.includes(p.id));
    return { room, sockets, holderSocket, target };
  }

  test('the holder learns the true alignment of their target', () => {
    const { room, holderSocket, target } = ladyRoom();

    holderSocket.trigger('lady-investigate', { targetId: target.id });

    const expected = isEvil(target.role) ? 'evil' : 'good';
    expect(holderSocket.last('lady-result')).toEqual({ targetName: target.name, alignment: expected });
    expect(room.ladyPendingResult).toEqual({ targetId: target.id, alignment: expected });
  });

  test('a non-holder cannot investigate', () => {
    const { room, sockets, target } = ladyRoom();
    const impostor = sockets.find(s => s.id !== room.ladyHolder);

    impostor.trigger('lady-investigate', { targetId: target.id });

    expect(impostor.received('lady-result')).toBe(false);
    expect(room.ladyPendingResult).toBeNull();
  });

  test('an already-investigated player cannot be investigated again', () => {
    const { room, holderSocket } = ladyRoom();
    const usedId = room.ladyUsed[0];

    holderSocket.trigger('lady-investigate', { targetId: usedId });

    expect(holderSocket.received('lady-result')).toBe(false);
  });

  test('announcing passes the token on and returns play to team-select', () => {
    const { room, holderSocket, target } = ladyRoom();
    holderSocket.trigger('lady-investigate', { targetId: target.id });

    holderSocket.trigger('lady-announce', { announcement: 'good' });

    expect(room.ladyHolder).toBe(target.id);
    expect(room.ladyUsed).toContain(target.id);
    expect(room.ladyPendingResult).toBeNull();
    expect(room.phase).toBe('team-select');
    expect(room.ladyHistory[0]).toMatchObject({ target: target.name, announcement: 'good' });
  });

  test('the announcement is recorded verbatim, even when it is a lie', () => {
    const { room, holderSocket, target } = ladyRoom();
    holderSocket.trigger('lady-investigate', { targetId: target.id });
    const truth = room.ladyPendingResult.alignment;
    const lie = truth === 'evil' ? 'good' : 'evil';

    holderSocket.trigger('lady-announce', { announcement: lie });

    expect(room.ladyHistory[0].announcement).toBe(lie);
  });

  test('announcing without investigating first does nothing', () => {
    const { room, holderSocket } = ladyRoom();

    holderSocket.trigger('lady-announce', { announcement: 'good' });

    expect(room.phase).toBe('lady-of-lake');
    expect(room.ladyHistory).toHaveLength(0);
  });
});
