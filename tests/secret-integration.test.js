/**
 * The Secret Hitler game mode over real Socket.IO connections — the layer that
 * catches payloads that don't serialize, per-seat views sent to the wrong
 * socket, and events that were never registered. Plays whole games with
 * random choices and checks that nothing secret reaches the wrong phone.
 *
 * The database is mocked, as in the other integration suites.
 */
const http = require('http');
const { Server } = require('socket.io');
const { io: ioClient } = require('socket.io-client');
const registerSecretHandlers = require('../server/secret/handlers');
const { secRooms } = require('../server/secret/rooms');

jest.mock('../server/db', () => ({
  saveRoom:   () => Promise.resolve(),
  deleteRoom: () => Promise.resolve(),
  loadRooms:  () => Promise.resolve([]),
}));

jest.setTimeout(30000);

let httpServer, ioServer, port, clients;

beforeAll(done => {
  httpServer = http.createServer();
  ioServer = new Server(httpServer);
  registerSecretHandlers(ioServer);
  httpServer.listen(0, () => { port = httpServer.address().port; done(); });
});
afterAll(done => { ioServer.close(done); });
beforeEach(() => { Object.keys(secRooms).forEach(k => delete secRooms[k]); clients = []; });
afterEach(() => { clients.forEach(c => { c.removeAllListeners(); c.disconnect(); }); clients = []; });

function connect(token) {
  const s = ioClient(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
  s.token = token;
  s.seen = {};
  s.states = [];
  s.onAny((event, data) => { s.seen[event] = data; if (event === 'sec:state') s.states.push(data); });
  clients.push(s);
  return s;
}
const connected = s => (s.connected ? Promise.resolve() : new Promise(r => s.once('connect', r)));

function until(socket, event, predicate = () => true, ms = 6000) {
  const already = socket.seen[event];
  if (already !== undefined && predicate(already)) return Promise.resolve(already);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, h); reject(new Error(`timed out waiting for "${event}"`)); }, ms);
    function h(d) { if (!predicate(d)) return; clearTimeout(timer); socket.off(event, h); resolve(d); }
    socket.on(event, h);
  });
}
const untilState = (s, pred, ms) => until(s, 'sec:state', pred, ms);
const act = (s, event, extra = {}) => s.emit(event, { code: s.code, token: s.token, ...extra });

async function lobby(n) {
  const host = connect('tok-0');
  await connected(host);
  host.emit('sec:create-room', { name: 'Host', token: host.token });
  const { code } = await until(host, 'sec:joined');
  host.code = code;
  const all = [host];
  for (let i = 1; i < n; i++) {
    const c = connect('tok-' + i);
    await connected(c);
    c.code = code;
    c.emit('sec:join-room', { code, name: 'P' + i, token: c.token });
    await until(c, 'sec:joined');
    all.push(c);
  }
  await untilState(host, v => v.players.length === n);
  return all;
}

async function startAndReveal(all) {
  act(all[0], 'sec:start');
  await Promise.all(all.map(c => untilState(c, v => v.game?.phase === 'reveal')));
  all.forEach(c => act(c, 'sec:ready'));
  await Promise.all(all.map(c => untilState(c, v => v.game?.phase === 'nominate')));
}

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// Every seat acts on its own latest view, like the bots, until the game ends.
async function playOut(all) {
  const lastKey = new Map();
  const step = c => {
    const v = c.seen['sec:state'];
    const g = v?.game;
    if (!g) return;
    const me = v.you.seat;
    const key = `${g.round}:${g.phase}:${g.president}:${g.chancellor}:${g.vetoDenied}:${g.power?.target ?? ''}:${g.voted?.length ?? ''}`;
    if (lastKey.get(c) === key) return;
    lastKey.set(c, key);
    if (g.phase === 'nominate' && g.president === me) act(c, 'sec:nominate', { target: pick(g.eligible) });
    else if (g.phase === 'vote' && v.players[me].alive && g.yourVote === null) act(c, 'sec:vote', { ja: Math.random() < 0.7 });
    else if (g.phase === 'president-discard' && g.president === me) act(c, 'sec:discard', { index: 0 });
    else if (g.phase === 'chancellor-enact' && g.chancellor === me) {
      if (g.vetoUnlocked && !g.vetoDenied && Math.random() < 0.5) act(c, 'sec:veto');
      else act(c, 'sec:enact', { index: Math.floor(Math.random() * 2) });
    } else if (g.phase === 'veto' && g.president === me) act(c, 'sec:veto-answer', { accept: Math.random() < 0.5 });
    else if (g.phase === 'power' && g.president === me) {
      if (g.power.type === 'peek' || g.power.result) act(c, 'sec:power-done');
      else if (g.power.target === null) act(c, 'sec:power', { target: pick(g.power.targets) });
    }
  };
  all.forEach(c => { c.on('sec:state', () => step(c)); step(c); });
  await Promise.all(all.map(c => untilState(c, v => v.game?.phase === 'over', 25000)));
}

// Nothing secret in anyone's view that the rules don't allow them to see.
function checkNoLeaks(all) {
  for (const c of all) {
    for (const v of c.states) {
      const g = v.game;
      if (!g) continue;
      const me = v.you.seat;
      if (g.phase !== 'over') expect(g.roles).toBeUndefined();
      if (g.hand) {
        const holder = g.phase === 'president-discard' ? g.president : g.chancellor;
        expect(me).toBe(holder);
      }
      if (g.power && g.president !== me) {
        expect(g.power.cards).toBeNull();
        expect(g.power.result).toBeNull();
      }
      if (g.role === 'liberal') expect(g.known).toEqual([]);
    }
  }
}

test.each([5, 7, 10])('a full %i-player game plays to a result without leaking secrets', async n => {
  const all = await lobby(n);
  await startAndReveal(all);
  const roles = all.map(c => c.seen['sec:state'].game.role);
  expect(roles.filter(r => r === 'hitler')).toHaveLength(1);
  await playOut(all);
  const final = all[0].seen['sec:state'].game;
  expect(['liberal', 'fascist']).toContain(final.winner);
  expect(final.roles.map(r => r.role)).toEqual(roles);
  checkNoLeaks(all);
});

test('start needs five players', async () => {
  const all = await lobby(4);
  act(all[0], 'sec:start');
  const msg = await until(all[0], 'sec:error');
  expect(msg).toMatch(/at least 5/);
  expect(secRooms[all[0].code].state).toBe('lobby');
});

test('the host can reorder seats in the lobby; others cannot', async () => {
  const all = await lobby(5);
  act(all[2], 'sec:move-seat', { from: 0, dir: 1 });
  act(all[0], 'sec:move-seat', { from: 0, dir: 1 });
  const v = await untilState(all[0], s => s.players[1].name === 'Host');
  expect(v.players[0].name).toBe('P1');
  expect(v.you.seat).toBe(1);
});

test('a new name cannot join mid-game; a dropped player takes their seat back by token', async () => {
  const all = await lobby(5);
  await startAndReveal(all);
  const late = connect('tok-late');
  await connected(late);
  late.emit('sec:join-room', { code: all[0].code, name: 'Latecomer', token: late.token });
  expect(await until(late, 'sec:error')).toMatch(/already started/);

  const before = all[3].seen['sec:state'].game.role;
  all[3].disconnect();
  await untilState(all[0], v => !v.players[3].connected);
  const back = connect('tok-3');
  await connected(back);
  back.code = all[0].code;
  back.emit('sec:rejoin-room', { code: back.code, token: back.token });
  const v = await untilState(back, s => !!s.game);
  expect(v.you.seat).toBe(3);
  expect(v.game.role).toBe(before);
});

test('an action racing a reconnect lands on the right seat via the token', async () => {
  const all = await lobby(5);
  await startAndReveal(all);
  const v0 = all[0].seen['sec:state'];
  const pres = v0.game.president;
  const presClient = all[pres];
  const target = (await untilState(presClient, s => !!s.game.eligible)).game.eligible[0];
  presClient.disconnect();
  const fresh = connect(presClient.token);
  await connected(fresh);
  fresh.code = presClient.code;
  act(fresh, 'sec:nominate', { target });   // no rejoin first
  const v = await untilState(all[(pres + 1) % 5], s => s.game.phase === 'vote');
  expect(v.game.chancellor).toBe(target);
});

test('malformed payloads and out-of-turn actions do not crash or change the game', async () => {
  const all = await lobby(5);
  await startAndReveal(all);
  const bad = [undefined, null, 42, 'x', [], { target: 'a' }, { index: -1 }, { ja: 'yes' }, { from: 'x', dir: 9 }];
  const events = ['sec:create-room', 'sec:join-room', 'sec:rejoin-room', 'sec:request-sync', 'sec:move-seat',
    'sec:start', 'sec:ready', 'sec:begin', 'sec:nominate', 'sec:vote', 'sec:discard', 'sec:enact', 'sec:veto',
    'sec:veto-answer', 'sec:power', 'sec:power-done', 'sec:claim-host', 'sec:play-again', 'sec:end-game', 'sec:shuffle-seats'];
  const g = secRooms[all[0].code].g;
  const snapshot = JSON.stringify({ phase: g.phase, president: g.president, deck: g.deck });
  // Not the host either: ending the game is the host's call, and the host may do it.
  const notPres = all.find((_, i) => i !== g.president && i !== 0);
  for (const ev of events) for (const p of bad) notPres.emit(ev, p);
  act(notPres, 'sec:nominate', { target: 0 });
  await new Promise(r => setTimeout(r, 300));
  expect(secRooms[all[0].code].g).toBe(g);
  expect(JSON.stringify({ phase: g.phase, president: g.president, deck: g.deck })).toBe(snapshot);
  // Still serving.
  act(all[0], 'sec:request-sync');
  await untilState(all[0], v => v.game?.phase === 'nominate');
});

test('play again returns everyone to the lobby with the same seats', async () => {
  const all = await lobby(5);
  await startAndReveal(all);
  await playOut(all);
  all.forEach(c => c.removeAllListeners('sec:state'));
  all.forEach(c => c.on('sec:state', d => { c.seen['sec:state'] = d; }));
  act(all[0], 'sec:play-again');
  const v = await untilState(all[4], s => s.state === 'lobby');
  expect(v.players.map(p => p.name)).toEqual(['Host', 'P1', 'P2', 'P3', 'P4']);
  expect(v.game).toBeUndefined();
});
