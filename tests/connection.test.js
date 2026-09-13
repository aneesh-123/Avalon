/**
 * Connection lifecycle tests — the join / drop / reclaim paths.
 *
 * These cover the handlers that keep a game playable when players' phones
 * sleep, browsers refresh, or someone rage-quits and comes back: disconnect,
 * leave-game, leave-lobby, claim-slot, and request-sync. Game *rules* live in
 * gameflow.test.js; this file is strictly about surviving connection churn.
 */

const registerHandlers = require('../server/socketHandlers');
const { rooms }        = require('../server/rooms');
const { makeIo, connectSocket, buildRoom, startGame, clearRooms } = require('./helpers');

const mockDeleteRoom = jest.fn(() => Promise.resolve());
jest.mock('../server/db', () => ({
  saveRoom:   () => Promise.resolve(),
  deleteRoom: (...a) => mockDeleteRoom(...a),
  loadRooms:  () => Promise.resolve([]),
}));

let io;
beforeEach(() => {
  clearRooms();
  mockDeleteRoom.mockClear();
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

// A room mid-game with every player connected.
function playingRoom(code = 'PLAY', n = 5, overrides = {}) {
  const playerDefs = makePlayers(n);
  const room = buildRoom(code, playerDefs, overrides);
  const sockets = connectAll(io, playerDefs, code);
  startGame(room);
  return { room, sockets, playerDefs };
}

// ── Disconnect ────────────────────────────────────────────────────────────────
describe('disconnect', () => {
  test('lobby disconnect leaves the player in the room (they hold their seat)', () => {
    const playerDefs = makePlayers(5);
    const room = buildRoom('LOBBY', playerDefs);
    const sockets = connectAll(io, playerDefs, 'LOBBY');

    sockets[2].trigger('disconnect');

    expect(room.players).toHaveLength(5);
    expect(room.disconnected || []).toHaveLength(0);
    expect(sockets[0].received('game-paused')).toBe(false);
  });

  test('mid-game disconnect pauses the game for everyone', () => {
    const { room, sockets } = playingRoom();

    sockets[1].trigger('disconnect');

    expect(room.disconnected).toEqual(['Player2']);
    expect(sockets[0].last('game-paused')).toEqual({ disconnected: ['Player2'] });
  });

  test('disconnect after game-over does not pause', () => {
    const { room, sockets } = playingRoom();
    room.phase = 'game-over';
    room.winner = 'good';

    sockets[1].trigger('disconnect');

    expect(room.disconnected || []).toHaveLength(0);
    expect(sockets[0].received('game-paused')).toBe(false);
  });

  test('the same player disconnecting twice is only recorded once', () => {
    const { room, sockets } = playingRoom();

    sockets[1].trigger('disconnect');
    sockets[1].trigger('disconnect');

    expect(room.disconnected).toEqual(['Player2']);
  });

  test('room is deleted once every player has dropped', () => {
    const { room, sockets } = playingRoom('GONE');

    sockets.forEach(s => s.trigger('disconnect'));

    expect(rooms['GONE']).toBeUndefined();
    expect(mockDeleteRoom).toHaveBeenCalledWith('GONE');
  });

  test('disconnect from a socket in no room is a no-op', () => {
    const stray = connectSocket(io, 'nobody');
    expect(() => stray.trigger('disconnect')).not.toThrow();
  });
});

// ── Explicit leave ────────────────────────────────────────────────────────────
describe('leave-game', () => {
  test('pauses the game and records the leaver', () => {
    const { room, sockets } = playingRoom();

    sockets[3].trigger('leave-game');

    expect(room.disconnected).toEqual(['Player4']);
    expect(sockets[0].last('game-paused')).toEqual({ disconnected: ['Player4'] });
  });

  test('deletes the room when the last player leaves', () => {
    const { sockets } = playingRoom('EMPTY');

    sockets.forEach(s => s.trigger('leave-game'));

    expect(rooms['EMPTY']).toBeUndefined();
    expect(mockDeleteRoom).toHaveBeenCalledWith('EMPTY');
  });

  test('is ignored while still in the lobby', () => {
    const playerDefs = makePlayers(5);
    const room = buildRoom('INLOBBY', playerDefs);
    const sockets = connectAll(io, playerDefs, 'INLOBBY');

    sockets[0].trigger('leave-game');

    expect(room.disconnected).toEqual([]);
    expect(rooms['INLOBBY']).toBeDefined();
  });
});

describe('leave-lobby', () => {
  test('removes the player and tells the rest', () => {
    const playerDefs = makePlayers(5);
    const room = buildRoom('LEAVE', playerDefs);
    const sockets = connectAll(io, playerDefs, 'LEAVE');

    sockets[2].trigger('leave-lobby');

    expect(room.players).toHaveLength(4);
    expect(room.players.map(p => p.name)).not.toContain('Player3');
    expect(sockets[0].last('lobby-update').players).toHaveLength(4);
  });

  test('promotes a new host when the host leaves', () => {
    const playerDefs = makePlayers(5);
    const room = buildRoom('HOST', playerDefs);
    const sockets = connectAll(io, playerDefs, 'HOST');
    expect(room.hostId).toBe('s1');

    sockets[0].trigger('leave-lobby');

    expect(room.hostId).toBe('s2');
    expect(rooms['HOST']).toBeDefined();
  });

  test('is ignored once the game has started', () => {
    const { room, sockets } = playingRoom('STARTED');

    sockets[1].trigger('leave-lobby');

    expect(room.players).toHaveLength(5);
  });
});

// ── claim-slot (reclaiming a dropped seat by name) ────────────────────────────
describe('claim-slot', () => {
  // Drop Player2, then have a brand-new socket claim that seat back.
  function withDroppedPlayer() {
    const ctx = playingRoom('CLAIM');
    ctx.sockets[1].trigger('disconnect');
    ctx.fresh = connectSocket(io, 'new-socket');
    return ctx;
  }

  test('restores the seat and replays state to the new socket', () => {
    const { room, fresh } = withDroppedPlayer();

    fresh.trigger('claim-slot', { code: 'CLAIM', claimName: 'Player2', token: 'tok-new' });

    expect(fresh.last('rejoin-ok')).toEqual({ state: 'playing', claimedName: 'Player2' });
    expect(fresh.received('game-start')).toBe(true);
    expect(fresh.last('your-role')).toBeDefined();
    expect(fresh.last('phase-update')).toBeDefined();
    expect(room.players.find(p => p.name === 'Player2').id).toBe('new-socket');
    expect(room.disconnected).toHaveLength(0);
  });

  test('resumes the game for everyone when the last gap is filled', () => {
    const { sockets, fresh } = withDroppedPlayer();

    fresh.trigger('claim-slot', { code: 'CLAIM', claimName: 'Player2', token: 't' });

    expect(sockets[0].received('game-resumed')).toBe(true);
  });

  test('stays paused while another player is still missing', () => {
    const ctx = playingRoom('TWOGONE');
    ctx.sockets[1].trigger('disconnect');
    ctx.sockets[2].trigger('disconnect');
    const fresh = connectSocket(io, 'new-socket');

    fresh.trigger('claim-slot', { code: 'TWOGONE', claimName: 'Player2', token: 't' });

    expect(fresh.last('game-paused')).toEqual({ disconnected: ['Player3'] });
    expect(ctx.room.disconnected).toEqual(['Player3']);
  });

  test('carries the host role over when the host reclaims their seat', () => {
    const ctx = playingRoom('HOSTBACK');
    expect(ctx.room.hostId).toBe('s1');
    ctx.sockets[0].trigger('disconnect');
    const fresh = connectSocket(io, 'host-again');

    fresh.trigger('claim-slot', { code: 'HOSTBACK', claimName: 'Player1', token: 't' });

    expect(ctx.room.hostId).toBe('host-again');
  });

  test('moves the players existing votes onto the new socket id', () => {
    const ctx = playingRoom('VOTES');
    ctx.room.phase = 'team-vote';
    ctx.room.proposedTeam = ['s1', 's2'];
    ctx.room.teamVotes = { s2: 'approve' };
    ctx.room.questVotes = { s2: 'pass' };
    ctx.sockets[1].trigger('disconnect');
    const fresh = connectSocket(io, 'voter-again');

    fresh.trigger('claim-slot', { code: 'VOTES', claimName: 'Player2', token: 't' });

    expect(ctx.room.teamVotes['voter-again']).toBe('approve');
    expect(ctx.room.teamVotes.s2).toBeUndefined();
    expect(ctx.room.questVotes['voter-again']).toBe('pass');
    expect(ctx.room.proposedTeam).toContain('voter-again');
    expect(ctx.room.proposedTeam).not.toContain('s2');
  });

  test('rejects a claim on a room that is not playing', () => {
    const playerDefs = makePlayers(5);
    buildRoom('INLOBBY2', playerDefs);
    const fresh = connectSocket(io, 'x');

    fresh.trigger('claim-slot', { code: 'INLOBBY2', claimName: 'Player2', token: 't' });

    expect(fresh.last('join-error')).toBe('Game not in progress.');
  });

  test('rejects a claim for a player who never dropped', () => {
    playingRoom('CONNECTED');
    const fresh = connectSocket(io, 'x');

    fresh.trigger('claim-slot', { code: 'CONNECTED', claimName: 'Player2', token: 't' });

    expect(fresh.last('join-error')).toBe('That player is not disconnected.');
  });

  test('rejects a claim for an unknown room', () => {
    const fresh = connectSocket(io, 'x');

    fresh.trigger('claim-slot', { code: 'NOPE', claimName: 'Player2', token: 't' });

    expect(fresh.last('join-error')).toBe('Game not in progress.');
  });
});

// ── Rejoin round trip ─────────────────────────────────────────────────────────
describe('disconnect then rejoin round trip', () => {
  test('a refresh mid-game restores the player and resumes play', () => {
    const { room, sockets } = playingRoom('REFRESH');
    const originalRole = room.players[2].role;

    sockets[2].trigger('disconnect');
    expect(room.disconnected).toEqual(['Player3']);

    const reconnected = connectSocket(io, 'reconnected-3');
    reconnected.trigger('rejoin-room', { code: 'REFRESH', name: 'Player3', token: 'token-s3' });

    expect(reconnected.last('rejoin-ok')).toEqual({ state: 'playing' });
    expect(reconnected.last('your-role').role).toBe(originalRole);
    expect(room.disconnected).toHaveLength(0);
    expect(sockets[0].received('game-resumed')).toBe(true);
  });

  test('rejoining by token works even when the player uses a different name', () => {
    const { room } = playingRoom('TOKEN');
    room.disconnected = ['Player4'];

    const reconnected = connectSocket(io, 'tok-socket');
    reconnected.trigger('rejoin-room', { code: 'TOKEN', name: 'typo-name', token: 'token-s4' });

    expect(reconnected.last('rejoin-ok')).toBeDefined();
    expect(room.players.find(p => p.name === 'Player4').id).toBe('tok-socket');
  });

  test('a lobby rejoin gets the lobby state, not a game state', () => {
    const playerDefs = makePlayers(5);
    buildRoom('LREJOIN', playerDefs);

    const s = connectSocket(io, 'lobby-socket');
    s.trigger('rejoin-room', { code: 'LREJOIN', name: 'Player2', token: 'token-s2' });

    expect(s.last('rejoin-ok')).toEqual({ state: 'lobby' });
    expect(s.received('game-start')).toBe(false);
  });
});

// ── request-sync ──────────────────────────────────────────────────────────────
describe('request-sync', () => {
  test('returns phase-update during a game', () => {
    const { sockets } = playingRoom('SYNC');

    sockets[0].trigger('request-sync');

    expect(sockets[0].last('phase-update')).toBeDefined();
  });

  test('returns lobby-update in the lobby', () => {
    const playerDefs = makePlayers(5);
    buildRoom('SYNCL', playerDefs);
    const sockets = connectAll(io, playerDefs, 'SYNCL');

    sockets[0].trigger('request-sync');

    expect(sockets[0].last('lobby-update')).toBeDefined();
  });

  test('is a no-op for a socket in no room', () => {
    const stray = connectSocket(io, 'stray');
    expect(() => stray.trigger('request-sync')).not.toThrow();
    expect(stray.received('phase-update')).toBe(false);
  });
});
