/**
 * End-to-end tests over a real Socket.IO connection.
 *
 * Every other suite drives the handlers through mock sockets, which means they
 * cannot catch anything that breaks on the wire: a payload that does not
 * serialize, a room-broadcast that reaches the wrong sockets, or an event the
 * server never actually registers. This suite boots a real HTTP + Socket.IO
 * server and plays complete games through real clients.
 *
 * The database is mocked — persistence is not what is under test here, and the
 * real db.js requires Supabase credentials that CI does not have.
 */

const http     = require('http');
const { Server } = require('socket.io');
const { io: ioClient } = require('socket.io-client');
const registerHandlers = require('../server/socketHandlers');
const { rooms } = require('../server/rooms');
const { clearRooms } = require('./helpers');

jest.mock('../server/db', () => ({
  saveRoom:   () => Promise.resolve(),
  deleteRoom: () => Promise.resolve(),
  loadRooms:  () => Promise.resolve([]),
}));

jest.setTimeout(20000);

const ROLE_CONFIG = { evilCount: 2, goodSpecials: ['Merlin'], evilSpecials: ['Assassin'], ladyOfLake: false };
const CAMPAIGNS = [
  { teamSize: 2, failsNeeded: 1 },
  { teamSize: 3, failsNeeded: 1 },
  { teamSize: 2, failsNeeded: 1 },
  { teamSize: 3, failsNeeded: 1 },
  { teamSize: 3, failsNeeded: 1 },
];

let httpServer, ioServer, port, clients;

beforeAll(done => {
  httpServer = http.createServer();
  ioServer = new Server(httpServer);
  registerHandlers(ioServer);
  httpServer.listen(0, () => { port = httpServer.address().port; done(); });
});

// io.close() tears down the HTTP server it was attached to, so closing
// httpServer again afterwards throws ERR_SERVER_NOT_RUNNING.
afterAll(done => { ioServer.close(done); });

beforeEach(() => { clearRooms(); clients = []; });

afterEach(() => {
  clients.forEach(c => { c.removeAllListeners(); c.disconnect(); });
  clients = [];
});

// ── Client plumbing ───────────────────────────────────────────────────────────

/** Connect a real socket.io client and remember every event it receives. */
function connect() {
  const socket = ioClient(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    forceNew: true,
  });
  socket.seen = {};
  socket.onAny((event, data) => { socket.seen[event] = data; });
  clients.push(socket);
  return socket;
}

/** Resolve on the next occurrence of `event`, or reject after `ms`. */
function next(socket, event, ms = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for "${event}" on ${socket.id || 'unconnected socket'}`));
    }, ms);
    function handler(data) { clearTimeout(timer); socket.off(event, handler); resolve(data); }
    socket.on(event, handler);
  });
}

/**
 * Resolve once `predicate` holds for `event` — checking what the socket has
 * already seen first, so a payload that landed before this call is not missed.
 */
function until(socket, event, predicate, ms = 8000) {
  const already = socket.seen[event];
  if (already !== undefined && predicate(already)) return Promise.resolve(already);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for a matching "${event}"`));
    }, ms);
    function handler(data) {
      if (!predicate(data)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(data);
    }
    socket.on(event, handler);
  });
}

const untilPhase = (socket, predicate, ms) => until(socket, 'phase-update', predicate, ms);

function connected(socket) {
  return socket.connected ? Promise.resolve() : next(socket, 'connect');
}

/** Stand up a full lobby of `n` players and return their clients + room code. */
async function seatPlayers(n = 5) {
  const host = connect();
  await connected(host);
  host.emit('create-room', {
    playerCount: n, name: 'Player1', token: 'tok-1',
    roleConfig: ROLE_CONFIG, campaignsConfig: CAMPAIGNS,
  });
  const { code } = await next(host, 'room-created');

  const others = [];
  for (let i = 2; i <= n; i++) {
    const c = connect();
    await connected(c);
    c.emit('join-room', { code, name: `Player${i}`, token: `tok-${i}` });
    await next(c, 'room-joined');
    others.push(c);
  }
  const players = [host, ...others];
  // The final lobby-update fans out to everyone a beat after the last join
  // resolves — settle before returning so assertions see the full roster.
  await Promise.all(players.map(p => until(p, 'lobby-update', s => s.players.length === n)));
  return { code, host, players };
}

/** Ready everyone up and collect each player's private role card. */
async function startGame(players) {
  const roleCards = players.map(p => next(p, 'your-role'));
  const firstState = untilPhase(players[0], s => s.phase === 'team-select');
  players.forEach(p => p.emit('toggle-ready'));
  const roles = await Promise.all(roleCards);
  const state = await firstState;
  players.forEach((p, i) => { p.role = roles[i].role; p.isEvil = roles[i].isEvil; });
  return state;
}

const byId = (players, id) => players.find(p => p.id === id);

/** Play one full quest with a unanimous approve and the given fail count. */
async function playQuest(players, state, { fails = 0 } = {}) {
  const leader = byId(players, state.leaderId);
  const teamSize = state.campaignsConfig[state.currentCampaign].teamSize;

  // The leader must be able to seat enough fail-capable players when asked.
  const evils = players.filter(p => p.isEvil);
  const goods = players.filter(p => !p.isEvil);
  const team = [...evils.slice(0, fails), ...goods, ...evils].slice(0, teamSize);
  const teamIds = team.map(p => p.id);

  const voteResolved = untilPhase(players[0], s => s.phase === 'team-vote-result');
  leader.emit('propose-team', { team: teamIds });
  await untilPhase(players[0], s => s.phase === 'team-vote');
  players.filter(p => p.id !== leader.id).forEach(p => p.emit('team-vote', { vote: 'approve' }));
  await voteResolved;

  const onQuest = untilPhase(players[0], s => s.phase === 'quest-vote');
  players.forEach(p => p.emit('continue-game'));
  await onQuest;

  let failsLeft = fails;
  team.forEach(p => {
    const vote = (p.isEvil && failsLeft-- > 0) ? 'fail' : 'pass';
    p.emit('quest-vote', { vote });
  });
  await untilPhase(players[0], s => s.phase === 'quest-vote-ready');

  const resultShown = untilPhase(players[0], s => s.phase === 'quest-result');
  leader.emit('reveal-quest');
  const result = await resultShown;

  const advanced = untilPhase(players[0], s => s.phase !== 'quest-result');
  players.forEach(p => p.emit('continue-game'));
  return { result, next: await advanced };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('lobby over a real socket', () => {
  test('five players can create and join a room', async () => {
    const { code, players } = await seatPlayers(5);

    expect(code).toMatch(/^[A-Z0-9]+$/);
    expect(rooms[code].players).toHaveLength(5);
    expect(players[4].seen['lobby-update'].players.map(p => p.name))
      .toEqual(['Player1', 'Player2', 'Player3', 'Player4', 'Player5']);
  });

  test('every player is told the lobby filled up', async () => {
    const { players } = await seatPlayers(5);

    players.forEach(p => expect(p.seen['lobby-update'].players).toHaveLength(5));
  });

  test('a duplicate name is rejected over the wire', async () => {
    const { code } = await seatPlayers(5);
    const late = connect();
    await connected(late);

    late.emit('join-room', { code, name: 'player1', token: 'tok-late' });

    expect(await next(late, 'join-error')).toBe('Room is full.');
  });
});

describe('role dealing over a real socket', () => {
  test('each player receives exactly one private role card', async () => {
    const { players } = await seatPlayers(5);
    await startGame(players);

    const roles = players.map(p => p.role);
    expect(roles.filter(Boolean)).toHaveLength(5);
    expect(roles).toContain('Merlin');
    expect(roles).toContain('Assassin');
    expect(players.filter(p => p.isEvil)).toHaveLength(2);
  });

  test('a player never receives another players role card', async () => {
    const { players } = await seatPlayers(5);
    await startGame(players);

    // 'your-role' is a targeted emit; each client should hold only its own.
    players.forEach(p => expect(p.seen['your-role'].role).toBe(p.role));
  });
});

describe('a complete game over a real socket', () => {
  test('three passed quests take the game to assassination and a good win', async () => {
    const { players } = await seatPlayers(5);
    let state = await startGame(players);

    for (let quest = 0; quest < 3; quest++) {
      const { result, next: after } = await playQuest(players, state, { fails: 0 });
      expect(result.lastQuestResult.passed).toBe(true);
      state = after;
    }

    expect(state.phase).toBe('assassination');

    const assassin = byId(players, state.assassinId);
    const notMerlin = players.find(p => p.role !== 'Merlin');
    const over = untilPhase(players[0], s => s.phase === 'game-over');
    assassin.emit('assassinate', { targetId: notMerlin.id });
    const final = await over;

    expect(final.winner).toBe('good');
    expect(final.revealedRoles).toHaveLength(5);
  });

  test('the assassin finding Merlin flips the win to evil', async () => {
    const { players } = await seatPlayers(5);
    let state = await startGame(players);

    for (let quest = 0; quest < 3; quest++) {
      ({ next: state } = await playQuest(players, state, { fails: 0 }));
    }
    expect(state.phase).toBe('assassination');

    const assassin = byId(players, state.assassinId);
    const merlin = players.find(p => p.role === 'Merlin');
    const over = untilPhase(players[0], s => s.phase === 'game-over');
    assassin.emit('assassinate', { targetId: merlin.id });
    const final = await over;

    expect(final.winner).toBe('evil');
  });

  test('three failed quests end the game for evil with no assassination', async () => {
    const { players } = await seatPlayers(5);
    let state = await startGame(players);

    for (let quest = 0; quest < 3; quest++) {
      const { result, next: after } = await playQuest(players, state, { fails: 1 });
      expect(result.lastQuestResult.passed).toBe(false);
      state = after;
    }

    expect(state.phase).toBe('game-over');
    expect(state.winner).toBe('evil');
  });
});

describe('connection churn over a real socket', () => {
  test('a mid-game drop pauses the game for the remaining players', async () => {
    const { players } = await seatPlayers(5);
    await startGame(players);

    const paused = next(players[0], 'game-paused');
    players[3].disconnect();
    const payload = await paused;

    expect(payload.disconnected).toEqual(['Player4']);
  });

  test('reconnecting with the same token restores the role and resumes play', async () => {
    const { code, players } = await seatPlayers(5);
    await startGame(players);
    const originalRole = players[3].role;

    const paused = next(players[0], 'game-paused');
    players[3].disconnect();
    await paused;

    const resumed = next(players[0], 'game-resumed');
    const back = connect();
    await connected(back);
    back.emit('rejoin-room', { code, name: 'Player4', token: 'tok-4' });

    const card = await next(back, 'your-role');
    await resumed;

    expect(card.role).toBe(originalRole);
    expect(rooms[code].disconnected).toHaveLength(0);
  });

  test('a reconnected player can still act on their turn', async () => {
    const { code, players } = await seatPlayers(5);
    let state = await startGame(players);

    // Drop and restore whoever currently holds the leader token. The leader is
    // chosen at random, so watch from someone who is definitely staying put —
    // watching from the socket being disconnected would wait forever.
    const leaderIndex = players.findIndex(p => p.id === state.leaderId);
    const leaderName = `Player${leaderIndex + 1}`;
    const observer = players[(leaderIndex + 1) % players.length];
    const paused = next(observer, 'game-paused');
    players[leaderIndex].disconnect();
    await paused;

    const back = connect();
    await connected(back);
    back.emit('rejoin-room', { code, name: leaderName, token: `tok-${leaderIndex + 1}` });
    await next(back, 'your-role');
    // doRejoin emits your-role and phase-update back to back, so the update may
    // already be in `seen` by the time the await above resolves.
    state = await until(back, 'phase-update', () => true);

    expect(state.leaderId).toBe(back.id);

    const teamSize = state.campaignsConfig[state.currentCampaign].teamSize;
    const teamIds = state.players.slice(0, teamSize).map(p => p.id);
    const voting = untilPhase(observer, s => s.phase === 'team-vote');
    back.emit('propose-team', { team: teamIds });

    expect((await voting).proposedTeam).toEqual(teamIds);
  });
});
