/**
 * Presence and shot clock.
 *
 * Two behaviours that replaced the full-screen pause overlay: absence is now
 * reported inside game state rather than as an interrupting event, and a
 * stalled phase can be forced forward by a majority-called timer.
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
afterEach(() => jest.useRealTimers());

const makePlayers = n => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, name: `Player${i + 1}` }));

function playingRoom({ shotClock = false } = {}) {
  const players = makePlayers(5);
  const room = buildRoom('ROOM1', players, {
    state: 'playing',
    shotClockEnabled: shotClock,
    shotClockSeconds: 60,
    clockVotes: {},
  });
  startGame(room);
  const sockets = players.map(p => {
    const s = connectSocket(io, p.id);
    s.join('ROOM1');
    return s;
  });
  return { room, sockets, players };
}

// ── Presence ──────────────────────────────────────────────────────────────

describe('presence in game state', () => {
  test('disconnected names ride along with the phase payload', () => {
    const { room } = playingRoom();
    expect(gameState(room).disconnected).toEqual([]);
    room.disconnected = ['Player3'];
    expect(gameState(room).disconnected).toEqual(['Player3']);
  });

  test('a disconnect no longer emits a pause event to the table', () => {
    const { room, sockets } = playingRoom();
    sockets.forEach(s => { s.emitLog.length = 0; });
    sockets[2].trigger('disconnect');

    const everyEvent = sockets.flatMap(s => s.emitLog.map(e => e.event));
    expect(everyEvent).not.toContain('game-paused');
    expect(everyEvent).toContain('phase-update');   // the board just re-renders
    expect(room.disconnected).toContain('Player3');
  });

  test('the disconnected player is still named in the state everyone receives', () => {
    const { room, sockets } = playingRoom();
    sockets[2].trigger('disconnect');
    expect(gameState(room).disconnected).toEqual(['Player3']);
  });
});

describe('waitingOn names who is actually blocking', () => {
  test('team-select waits on the leader alone', () => {
    const { room } = playingRoom();
    room.phase = 'team-select';
    const s = gameState(room);
    expect(s.waitingOn).toEqual([room.players[room.currentLeaderIndex].name]);
  });

  test('team-vote waits on everyone who has not voted', () => {
    const { room } = playingRoom();
    room.phase = 'team-vote';
    room.teamVotes = { s1: 'approve', s2: 'reject' };
    expect(gameState(room).waitingOn).toEqual(['Player3', 'Player4', 'Player5']);
  });

  test('quest-vote waits only on the team, not the whole table', () => {
    const { room } = playingRoom();
    room.phase = 'quest-vote';
    room.proposedTeam = ['s1', 's2'];
    room.questVotes = { s1: 'pass' };
    expect(gameState(room).waitingOn).toEqual(['Player2']);
  });

  test('result screens block on nobody', () => {
    const { room } = playingRoom();
    room.phase = 'team-vote-result';
    expect(gameState(room).waitingOn).toEqual([]);
  });
});

// ── Shot clock ────────────────────────────────────────────────────────────

describe('shot clock', () => {
  test('is absent unless the room enabled it', () => {
    const { room, sockets } = playingRoom({ shotClock: false });
    room.phase = 'team-select';
    sockets[0].trigger('call-clock');
    expect(gameState(room).shotClock.votes).toEqual([]);
    expect(room.clockDeadline).toBeFalsy();
  });

  test('collects votes and starts only at a majority', () => {
    jest.useFakeTimers();
    const { room, sockets } = playingRoom({ shotClock: true });
    room.phase = 'team-select';

    sockets[0].trigger('call-clock');
    expect(gameState(room).shotClock.votes).toHaveLength(1);
    expect(room.clockDeadline).toBeFalsy();          // 1 of 3

    sockets[1].trigger('call-clock');
    expect(room.clockDeadline).toBeFalsy();          // 2 of 3

    sockets[2].trigger('call-clock');
    expect(room.clockDeadline).toBeTruthy();         // 3 of 3 — running
    expect(gameState(room).shotClock.threshold).toBe(3);
  });

  test('a second tap withdraws your call', () => {
    const { room, sockets } = playingRoom({ shotClock: true });
    room.phase = 'team-select';
    sockets[0].trigger('call-clock');
    sockets[0].trigger('call-clock');
    expect(gameState(room).shotClock.votes).toEqual([]);
  });

  test('expiring on team-select passes leadership and counts as a rejection', () => {
    jest.useFakeTimers();
    const { room, sockets } = playingRoom({ shotClock: true });
    room.phase = 'team-select';
    const startLeader = room.currentLeaderIndex;
    const startRejects = room.consecutiveRejections;

    ['s1', 's2', 's3'].forEach((_, i) => sockets[i].trigger('call-clock'));
    jest.advanceTimersByTime(60_000);

    expect(room.consecutiveRejections).toBe(startRejects + 1);
    expect(room.currentLeaderIndex).toBe((startLeader + 1) % 5);
    expect(room.phase).toBe('team-select');
  });

  test('a fifth clock expiry loses the game for good', () => {
    jest.useFakeTimers();
    const { room, sockets } = playingRoom({ shotClock: true });
    room.phase = 'team-select';
    room.consecutiveRejections = 4;

    ['s1', 's2', 's3'].forEach((_, i) => sockets[i].trigger('call-clock'));
    jest.advanceTimersByTime(60_000);

    expect(room.phase).toBe('game-over');
    expect(room.winner).toBe('evil');
  });

  test('expiring on team-vote fills missing votes as approve, and says so', () => {
    jest.useFakeTimers();
    const { room, sockets } = playingRoom({ shotClock: true });
    room.phase = 'team-vote';
    room.proposedTeam = ['s1', 's2'];
    room.teamVotes = { s1: 'reject' };

    ['s1', 's2', 's3'].forEach((_, i) => sockets[i].trigger('call-clock'));
    jest.advanceTimersByTime(60_000);

    // Four silent players approved; one real reject. The team carries.
    expect(room.clockFilled).toHaveLength(4);
    expect(room.lastTeamVoteResult.approved).toBe(true);
    expect(room.clockFilled).not.toContain('s1');
  });

  test('the blocked action happening cancels a running clock', () => {
    jest.useFakeTimers();
    const { room, sockets } = playingRoom({ shotClock: true });
    room.phase = 'team-select';
    ['s1', 's2', 's3'].forEach((_, i) => sockets[i].trigger('call-clock'));
    expect(room.clockDeadline).toBeTruthy();

    // The leader proposes, which moves the phase on.
    const leader = room.players[room.currentLeaderIndex];
    const leaderSocket = sockets.find(s => s.id === leader.id);
    const size = room.campaignsConfig[room.currentCampaign].teamSize;
    leaderSocket.trigger('propose-team', { team: room.players.slice(0, size).map(p => p.id) });

    expect(room.phase).toBe('team-vote');
    expect(room.clockDeadline).toBeFalsy();
  });

  test('never offered on a quest vote — there is no honest default', () => {
    jest.useFakeTimers();
    const { room, sockets } = playingRoom({ shotClock: true });
    room.phase = 'quest-vote';
    sockets.forEach(s => s.trigger('call-clock'));
    expect(room.clockDeadline).toBeFalsy();
    expect(gameState(room).shotClock.votes).toEqual([]);
  });
});

// ── The dead-button bug ───────────────────────────────────────────────────

describe('orphaned sockets', () => {
  test('an action from an unmapped socket reports a desync instead of vanishing', () => {
    playingRoom();
    const stranger = connectSocket(io, 'ghost-socket');
    stranger.trigger('propose-team', { team: ['s1', 's2'] });
    expect(stranger.received('desync')).toBe(true);
  });

  test('request-sync from an unmapped socket also reports rather than no-ops', () => {
    playingRoom();
    const stranger = connectSocket(io, 'ghost-socket-2');
    stranger.trigger('request-sync');
    expect(stranger.received('desync')).toBe(true);
  });

  test('a mapped socket can still sync normally', () => {
    const { sockets } = playingRoom();
    sockets[0].emitLog.length = 0;
    sockets[0].trigger('request-sync');
    expect(sockets[0].received('phase-update')).toBe(true);
    expect(sockets[0].received('desync')).toBe(false);
  });
});

// ── Server hardening ──────────────────────────────────────────────────────

describe('malformed input cannot take the server down', () => {
  test('create-room rejects a missing campaign table instead of storing it', () => {
    const socket = connectSocket(io, 'bad1');
    socket.trigger('create-room', {
      playerCount: 5, campaignsConfig: null, name: 'X', token: 't', orderMode: 'random',
      roleConfig: { evilCount: 2, goodSpecials: [], evilSpecials: [] },
    });
    expect(socket.received('room-created')).toBe(false);
    expect(socket.last('join-error')).toMatch(/Invalid quest configuration/);
  });

  test('propose-team on a room with no campaign table refuses rather than throwing', () => {
    const players = makePlayers(5);
    const room = buildRoom('BAD', players, { state: 'playing', campaignsConfig: null });
    startGame(room);
    const sockets = players.map(p => { const s = connectSocket(io, p.id); s.join('BAD'); return s; });
    room.phase = 'team-select';
    const leader = room.players[room.currentLeaderIndex];
    const leaderSocket = sockets.find(s => s.id === leader.id);

    expect(() => leaderSocket.trigger('propose-team', { team: ['s1', 's2'] })).not.toThrow();
    expect(room.phase).toBe('team-select');
  });
});

describe('a socket belongs to one room at a time', () => {
  test('creating a second game removes you from the first', () => {
    const socket = connectSocket(io, 'wanderer');
    const campaignsConfig = [{ teamSize: 2, failsNeeded: 1 }];
    const roleConfig = { evilCount: 2, goodSpecials: [], evilSpecials: [] };

    socket.trigger('create-room', { playerCount: 5, campaignsConfig, roleConfig, name: 'A', token: 't1', orderMode: 'random' });
    const first = socket.last('room-created').code;

    socket.trigger('create-room', { playerCount: 5, campaignsConfig, roleConfig, name: 'A', token: 't1', orderMode: 'random' });
    const second = socket.last('room-created').code;

    expect(first).not.toBe(second);
    // The first room had only them in it, so it should be gone entirely.
    expect(rooms[first]).toBeUndefined();
    expect(rooms[second].players.map(p => p.id)).toEqual(['wanderer']);
  });

  test('joining another game removes you from the one you were in', () => {
    // Four seats taken of five, so there is room to join.
    buildRoom('KEEP', makePlayers(4), { state: 'lobby', playerCount: 5 });
    const host = connectSocket(io, 'h1');
    host.trigger('create-room', {
      playerCount: 5, campaignsConfig: [{ teamSize: 2, failsNeeded: 1 }],
      roleConfig: { evilCount: 2, goodSpecials: [], evilSpecials: [] },
      name: 'Host', token: 'th', orderMode: 'random',
    });
    const own = host.last('room-created').code;

    host.trigger('join-room', { code: 'KEEP', name: 'Host', token: 'th' });

    expect(rooms['KEEP'].players.some(p => p.id === 'h1')).toBe(true);
    expect(rooms[own]).toBeUndefined();          // vacated, and empty, so removed
  });
});
