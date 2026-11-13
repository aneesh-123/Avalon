/**
 * Head to Head over real Socket.IO connections — catches payloads that don't
 * serialize, an answer leaked before the reveal, and events never registered.
 * Option order is random: the right answer is read from the reveal.
 */
const http = require('http');
const { Server } = require('socket.io');
const { io: ioClient } = require('socket.io-client');
const registerH2hHandlers = require('../server/h2h/handlers');
const { h2hRooms } = require('../server/h2h/rooms');
const E = require('../server/h2h/engine');

// Shorter pauses between questions; the answer clock stays real.
E.T.INTRO_MS = 300;
E.T.REVEAL_MS = 300;

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
  registerH2hHandlers(ioServer);
  httpServer.listen(0, () => { port = httpServer.address().port; done(); });
});
afterAll(done => { ioServer.close(done); });
beforeEach(() => { Object.keys(h2hRooms).forEach(k => delete h2hRooms[k]); clients = []; });
afterEach(() => { clients.forEach(c => { c.removeAllListeners(); c.disconnect(); }); clients = []; });

function connect(token) {
  const s = ioClient(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
  s.token = token;
  s.seen = {};
  s.onAny((event, data) => { s.seen[event] = data; });
  clients.push(s);
  return s;
}
const connected = s => (s.connected ? Promise.resolve() : new Promise(r => s.once('connect', r)));

function until(socket, event, predicate = () => true, ms = 8000) {
  const already = socket.seen[event];
  if (already !== undefined && predicate(already)) return Promise.resolve(already);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, h); reject(new Error(`timed out waiting for "${event}"`)); }, ms);
    function h(d) { if (!predicate(d)) return; clearTimeout(timer); socket.off(event, h); resolve(d); }
    socket.on(event, h);
  });
}
const untilState = (s, pred, ms) => until(s, 'h2h:state', pred, ms);
const act = (s, event, extra = {}) => s.emit(event, { code: s.code, token: s.token, ...extra });

async function pair() {
  const a = connect('tok-a');
  await connected(a);
  a.emit('h2h:create-room', { name: 'Ana', token: a.token });
  const { code } = await until(a, 'h2h:joined');
  a.code = code;
  const b = connect('tok-b');
  b.code = code;
  await connected(b);
  b.emit('h2h:join-room', { code, name: 'Ben', token: b.token });
  await until(b, 'h2h:joined');
  await untilState(a, v => v.players.length === 2);
  return [a, b];
}

test('two players pick a category and play a whole match', async () => {
  const [a, b] = await pair();

  act(b, 'h2h:category', { category: 'flags' });
  await untilState(a, v => v.category?.id === 'flags');

  act(a, 'h2h:start');
  await untilState(b, v => v.phase === 'intro');

  for (let n = 0; n < 7; n++) {
    const q = await untilState(a, v => v.phase === 'question' && v.index === n, 10000);
    expect(q.question.options).toHaveLength(4);
    expect(q.reveal).toBeUndefined();
    expect(JSON.stringify(q)).not.toMatch(/"answer"/);       // no answer key before the reveal
    act(a, 'h2h:answer', { choice: 0, index: n, ms: 500 });
    // Ben sees that Ana answered, but not what.
    const seen = await untilState(b, v => v.phase === 'question' && v.index === n && v.answered.length === 1);
    expect(seen.yourChoice).toBe(null);
    act(b, 'h2h:answer', { choice: 1, index: n, ms: 900 });
    const rev = await untilState(a, v => v.phase === 'reveal' && v.index === n);
    expect(Object.keys(rev.reveal.picks)).toHaveLength(2);
  }

  const end = await untilState(a, v => v.phase === 'game-over', 10000);
  expect(end.recap).toHaveLength(7);
  const [pa, pb] = end.players;
  const expected = pa.score === pb.score ? 'tie' : (pa.score > pb.score ? pa.pid : pb.pid);
  expect(end.winner).toBe(expected);

  // Rematch: straight back into a new match in the same category.
  act(b, 'h2h:again', { mode: 'rematch' });
  const again = await untilState(a, v => v.phase === 'intro');
  expect(again.category.id).toBe('flags');
  expect(again.players.every(p => p.score === 0)).toBe(true);
});

test('a third player cannot join a full match', async () => {
  const [a] = await pair();
  const c = connect('tok-c');
  await connected(c);
  c.emit('h2h:join-room', { code: a.code, name: 'Cal', token: c.token });
  const err = await until(c, 'h2h:error');
  expect(err).toMatch(/two players/);
});

test('a player who reconnects gets their seat and the match back', async () => {
  const [a, b] = await pair();
  act(a, 'h2h:start');
  await untilState(b, v => v.phase === 'intro');
  b.disconnect();
  const b2 = connect('tok-b');
  b2.code = a.code;
  await connected(b2);
  b2.emit('h2h:rejoin-room', { code: a.code, token: 'tok-b' });
  const v = await untilState(b2, v => v.state === 'playing');
  expect(v.you.name).toBe('Ben');
  expect(v.players).toHaveLength(2);
});

test('bad payloads do not crash the server', async () => {
  const s = connect('tok-x');
  await connected(s);
  ['h2h:create-room', 'h2h:join-room', 'h2h:answer', 'h2h:start', 'h2h:category', 'h2h:again', 'h2h:leave', 'h2h:rejoin-room']
    .forEach(e => { s.emit(e); s.emit(e, null); s.emit(e, 'junk'); s.emit(e, { code: 42, choice: 'x', ms: 'y' }); });
  s.emit('h2h:create-room', { name: 'Still here', token: 'tok-x' });
  await until(s, 'h2h:joined');
});
