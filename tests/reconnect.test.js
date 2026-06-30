/**
 * Reconnect tests — verifies that all socket-ID references in room state
 * are correctly patched when a player disconnects and rejoins with a new
 * socket ID.
 */

const registerHandlers = require('../server/socketHandlers');
const { rooms }        = require('../server/rooms');
const { gameState }    = require('../server/state');
const { makeIo, connectSocket, buildRoom, startGame, advanceToLadyPhase, clearRooms } = require('./helpers');

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

// ── Helper: simulate a name-based rejoin ─────────────────────────────────────
function rejoin(newSocketId, code, name) {
  const socket = connectSocket(io, newSocketId);
  socket.trigger('join-room', { code, name, token: null });
  return socket;
}

// ── 1. All ID references are patched on rejoin ────────────────────────────────
describe('socket ID swap completeness', () => {
  test('player.id, hostId, proposedTeam, teamVotes updated after rejoin', () => {
    const room = buildRoom('AAAAA', [
      { id: 's1', name: 'Alice' },
      { id: 's2', name: 'Bob' },
      { id: 's3', name: 'Carol' },
      { id: 's4', name: 'Dave' },
      { id: 's5', name: 'Eve' },
    ]);
    startGame(room);

    // Set up some state using Alice's original ID
    room.proposedTeam = ['s1', 's2'];
    room.teamVotes    = { s1: 'approve', s2: 'reject', s3: 'approve' };
    room.disconnected = ['Alice'];

    const newSocket = rejoin('s1-new', 'AAAAA', 'Alice');

    expect(newSocket.last('rejoin-ok')).toBeDefined();
    const alice = room.players.find(p => p.name === 'Alice');
    expect(alice.id).toBe('s1-new');
    expect(room.proposedTeam).toContain('s1-new');
    expect(room.proposedTeam).not.toContain('s1');
    expect(room.teamVotes['s1-new']).toBe('approve');
    expect(room.teamVotes['s1']).toBeUndefined();
  });

  test('questVotes updated after rejoin', () => {
    const room = buildRoom('BBBBB', [
      { id: 's1', name: 'Alice' },
      { id: 's2', name: 'Bob' },
      { id: 's3', name: 'Carol' },
      { id: 's4', name: 'Dave' },
      { id: 's5', name: 'Eve' },
    ]);
    startGame(room);
    room.phase        = 'quest-vote';
    room.proposedTeam = ['s1', 's2'];
    room.questVotes   = { s1: 'pass' };
    room.disconnected = ['Alice'];

    rejoin('s1-new', 'BBBBB', 'Alice');

    expect(room.questVotes['s1-new']).toBe('pass');
    expect(room.questVotes['s1']).toBeUndefined();
  });

  test('hostId updated when host rejoins', () => {
    const room = buildRoom('CCCCC', [
      { id: 'host', name: 'Alice' },
      { id: 's2',   name: 'Bob' },
      { id: 's3',   name: 'Carol' },
      { id: 's4',   name: 'Dave' },
      { id: 's5',   name: 'Eve' },
    ]);
    startGame(room);
    room.disconnected = ['Alice'];

    rejoin('host-new', 'CCCCC', 'Alice');

    expect(room.hostId).toBe('host-new');
  });
});

// ── 2. Lady of the Lake ────────────────────────────────────────────────────────
describe('lady of the lake after reconnect', () => {
  function buildLadyRoom() {
    const room = buildRoom('LADY1', [
      { id: 's1', name: 'Alice' },
      { id: 's2', name: 'Bob' },
      { id: 's3', name: 'Carol' },
      { id: 's4', name: 'Dave' },
      { id: 's5', name: 'Eve' },
    ], { roleConfig: { evilCount: 2, goodSpecials: [], evilSpecials: [], ladyOfLake: true } });
    startGame(room);
    advanceToLadyPhase(room);
    return room;
  }

  test('ladyHolderName resolves correctly before any disconnect', () => {
    const room = buildLadyRoom();
    const state = gameState(room);
    expect(state.ladyHolderName).toBeTruthy();
    expect(state.ladyHolderName).not.toBe('?');
    expect(typeof state.ladyHolderName).toBe('string');
  });

  test('ladyHolder socket ID updated after lady holder reconnects', () => {
    const room = buildLadyRoom();
    const oldHolderId  = room.ladyHolder;
    const holderPlayer = room.players.find(p => p.id === oldHolderId);

    room.disconnected = [holderPlayer.name];
    rejoin(oldHolderId + '-new', 'LADY1', holderPlayer.name);

    expect(room.ladyHolder).toBe(oldHolderId + '-new');
  });

  test('ladyHolderName is not null after lady holder reconnects', () => {
    const room = buildLadyRoom();
    const oldHolderId  = room.ladyHolder;
    const holderPlayer = room.players.find(p => p.id === oldHolderId);

    room.disconnected = [holderPlayer.name];
    rejoin(oldHolderId + '-new', 'LADY1', holderPlayer.name);

    const state = gameState(room);
    expect(state.ladyHolderName).toBe(holderPlayer.name);
  });

  test('ladyUsed updated so reconnected player cannot be re-investigated', () => {
    const room = buildLadyRoom();
    // The initial lady holder is already in ladyUsed — find someone else who was investigated
    const holder = room.players.find(p => p.id === room.ladyHolder);
    const target = room.players.find(p => p.id !== room.ladyHolder);

    // Manually mark target as used
    room.ladyUsed.push(target.id);
    const oldTargetId = target.id;

    // Target disconnects and reconnects
    room.disconnected = [target.name];
    rejoin(oldTargetId + '-new', 'LADY1', target.name);

    // ladyUsed should reference new ID
    expect(room.ladyUsed).toContain(oldTargetId + '-new');
    expect(room.ladyUsed).not.toContain(oldTargetId);
  });

  test('lady-investigate is blocked if target already used (after reconnect)', () => {
    const room = buildLadyRoom();
    const holder = room.players.find(p => p.id === room.ladyHolder);
    const target = room.players.find(p => p.id !== room.ladyHolder);

    room.ladyUsed.push(target.id);
    const oldTargetId = target.id;

    room.disconnected = [target.name];
    rejoin(oldTargetId + '-new', 'LADY1', target.name);

    // Connect holder socket and try to investigate the reconnected player
    const holderSocket = connectSocket(io, holder.id);
    room.ladyPendingResult = null;

    holderSocket.trigger('lady-investigate', { targetId: oldTargetId + '-new' });

    // Should be blocked — ladyPendingResult must remain null
    expect(room.ladyPendingResult).toBeNull();
  });
});

// ── 3. Assassin ───────────────────────────────────────────────────────────────
describe('assassin after reconnect', () => {
  test('assassinId updated when assassin reconnects', () => {
    const room = buildRoom('ASSAS', [
      { id: 's1', name: 'Alice' },
      { id: 's2', name: 'Bob' },
      { id: 's3', name: 'Carol' },
      { id: 's4', name: 'Dave' },
      { id: 's5', name: 'Eve' },
    ]);
    startGame(room);

    const oldAssassinId = room.assassinId;
    const assassin      = room.players.find(p => p.id === oldAssassinId);

    room.disconnected = [assassin.name];
    rejoin(oldAssassinId + '-new', 'ASSAS', assassin.name);

    expect(room.assassinId).toBe(oldAssassinId + '-new');
  });

  test('assassinate event accepted from reconnected assassin', () => {
    const room = buildRoom('ASSB', [
      { id: 's1', name: 'Alice' },
      { id: 's2', name: 'Bob' },
      { id: 's3', name: 'Carol' },
      { id: 's4', name: 'Dave' },
      { id: 's5', name: 'Eve' },
    ]);
    startGame(room);
    room.phase = 'assassination';

    const oldAssassinId = room.assassinId;
    const assassin      = room.players.find(p => p.id === oldAssassinId);
    const target        = room.players.find(p => p.id !== oldAssassinId);

    room.disconnected = [assassin.name];
    const newSocket = rejoin(oldAssassinId + '-new', 'ASSB', assassin.name);

    newSocket.trigger('assassinate', { targetId: target.id });

    expect(room.phase).toBe('game-over');
    expect(room.winner).toBeTruthy();
  });
});

// ── 4. Rejoin error when room doesn't exist ───────────────────────────────────
describe('rejoin error cases', () => {
  test('join-room returns join-error for unknown room code', () => {
    const socket = connectSocket(io, 'sx');
    socket.trigger('join-room', { code: 'ZZZZZ', name: 'Alice', token: null });
    expect(socket.last('join-error')).toBe('Room not found.');
  });

  test('join-room returns join-error when name not in disconnected list', () => {
    const room = buildRoom('NDCON', [
      { id: 's1', name: 'Alice' },
      { id: 's2', name: 'Bob' },
      { id: 's3', name: 'Carol' },
      { id: 's4', name: 'Dave' },
      { id: 's5', name: 'Eve' },
    ]);
    startGame(room);
    // Alice is NOT in disconnected list
    const socket = connectSocket(io, 'sx');
    socket.trigger('join-room', { code: 'NDCON', name: 'Alice', token: null });
    expect(socket.last('join-error')).toBe('That player is already connected to this game.');
  });

  test('join-room returns game-in-progress when name unrecognised', () => {
    const room = buildRoom('UNREC', [
      { id: 's1', name: 'Alice' },
      { id: 's2', name: 'Bob' },
      { id: 's3', name: 'Carol' },
      { id: 's4', name: 'Dave' },
      { id: 's5', name: 'Eve' },
    ]);
    startGame(room);
    const socket = connectSocket(io, 'sx');
    socket.trigger('join-room', { code: 'UNREC', name: 'Unknown', token: null });
    expect(socket.last('game-in-progress')).toBeDefined();
  });
});
