/**
 * The Council over real Socket.IO connections — catches payloads that don't
 * serialize, secrets sent to the wrong socket, and events never registered.
 * Roles, the leader and the trap are random: every step reads them from the
 * views the server sends, never from assumptions.
 */
const http = require('http');
const { Server } = require('socket.io');
const { io: ioClient } = require('socket.io-client');
const registerCouncilHandlers = require('../server/council/handlers');
const { councilRooms } = require('../server/council/rooms');

jest.mock('../server/db', () => ({
  saveRoom:   () => Promise.resolve(),
  deleteRoom: () => Promise.resolve(),
  loadRooms:  () => Promise.resolve([]),
}));

jest.setTimeout(20000);

let httpServer, ioServer, port, clients;

beforeAll(done => {
  httpServer = http.createServer();
  ioServer = new Server(httpServer);
  registerCouncilHandlers(ioServer);
  httpServer.listen(0, () => { port = httpServer.address().port; done(); });
});
afterAll(done => { ioServer.close(done); });
beforeEach(() => { Object.keys(councilRooms).forEach(k => delete councilRooms[k]); clients = []; });
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

function until(socket, event, predicate = () => true, ms = 6000) {
  const already = socket.seen[event];
  if (already !== undefined && predicate(already)) return Promise.resolve(already);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, h); reject(new Error(`timed out waiting for "${event}"`)); }, ms);
    function h(d) { if (!predicate(d)) return; clearTimeout(timer); socket.off(event, h); resolve(d); }
    socket.on(event, h);
  });
}
const untilState = (s, pred, ms) => until(s, 'cn:state', pred, ms);
const act = (s, event, extra = {}) => s.emit(event, { code: s.code, token: s.token, ...extra });
const all = (socks, pred) => Promise.all(socks.map(s => untilState(s, pred)));

async function table(n = 5) {
  const host = connect('tok-0');
  await connected(host);
  host.emit('cn:create-room', { name: 'Host', token: host.token });
  const { code } = await until(host, 'cn:joined');
  host.code = code;
  const socks = [host];
  for (let i = 1; i < n; i++) {
    const s = connect('tok-' + i);
    s.code = code;
    await connected(s);
    s.emit('cn:join-room', { code, name: 'P' + i, token: s.token });
    await until(s, 'cn:joined');
    socks.push(s);
  }
  await untilState(host, v => v.players.length === n);
  return { host, socks, code };
}

const pidOf = s => s.seen['cn:state'].you.pid;
const bySocket = (socks, pid) => socks.find(s => pidOf(s) === pid);

// Play one round through the sockets: the leader proposes the given side
// with the first other player, everyone approves, both help (or a traitor
// sabotages when asked to).
async function playRound(socks, { side, sabotage = false } = {}) {
  const v = socks[0].seen['cn:state'];
  const round = v.round;
  const leader = bySocket(socks, v.leader);
  const partnerSock = socks.find(s => s !== leader);
  const option = side || (socks.find(s => s.seen['cn:state'].whisper)?.seen['cn:state'].whisper.trap === 'gold' ? 'people' : 'gold');
  act(leader, 'cn:propose', { option, partner: pidOf(partnerSock) });
  await all(socks, s => s.phase === 'vote' && s.round === round);
  socks.forEach(s => act(s, 'cn:vote', { approve: true }));
  await all(socks, s => s.phase === 'act' && s.round === round);
  for (const s of [leader, partnerSock]) {
    const traitor = s.seen['cn:state'].you.role === 'traitor';
    act(s, 'cn:act', { choice: sabotage && traitor ? 'sabotage' : 'help' });
  }
  return untilState(socks[0], s => s.phase === 'result' && s.round === round);
}

test('lobby: start needs five, and only the host can start', async () => {
  const { host, socks } = await table(4);
  act(host, 'cn:start');
  const err = await until(host, 'cn:error');
  expect(err).toMatch(/at least 5/);
  const late = connect('tok-late');
  late.code = host.code;
  await connected(late);
  late.emit('cn:join-room', { code: host.code, name: 'Late', token: late.token });
  await until(late, 'cn:joined');
  act(socks[1], 'cn:start');                        // not the host: ignored
  await new Promise(r => setTimeout(r, 150));
  expect(host.seen['cn:state'].state).toBe('lobby');
  act(host, 'cn:start');
  await untilState(late, v => v.phase === 'roles');
});

test('a full game: secrets stay private, and five clean rounds win for the loyal side', async () => {
  const { host, socks } = await table(5);
  act(host, 'cn:start');
  await all(socks, v => v.phase === 'roles');

  const views = socks.map(s => s.seen['cn:state']);
  const traitors = views.filter(v => v.you.role === 'traitor');
  expect(traitors).toHaveLength(2);
  traitors.forEach(v => expect(v.you.allies).toHaveLength(1));
  views.filter(v => v.you.role === 'loyal').forEach(v => expect(v.you.allies).toBeUndefined());
  views.forEach(v => expect(v.players.every(p => p.role === null)).toBe(true));

  socks.forEach(s => act(s, 'cn:ready'));
  await all(socks, v => v.phase === 'propose' && v.round === 1);

  // Exactly two phones carry a whisper, and they agree.
  const whispers = socks.map(s => s.seen['cn:state'].whisper).filter(Boolean);
  expect(whispers).toHaveLength(2);
  expect(whispers[0].trap).toBe(whispers[1].trap);

  for (let round = 1; round <= 5; round++) {
    const k = socks[0].seen['cn:state'].kingdom;
    const trap = socks.map(s => s.seen['cn:state'].whisper).find(Boolean).trap;
    let side = trap === 'gold' ? 'people' : 'gold';
    if (k[side] <= 1) side = trap;                   // never run a side dry
    const res = await playRound(socks, { side });
    expect(res.result.sabotages).toBe(0);
    act(socks[round % 5], 'cn:next', { round });
    if (round < 5) await all(socks, v => v.phase === 'propose' && v.round === round + 1);
  }
  const end = await untilState(host, v => v.phase === 'game-over');
  expect(end.winner).toBe('loyal');
  expect(end.roleList).toHaveLength(5);

  act(host, 'cn:play-again');
  await all(socks, v => v.state === 'lobby');
});

test('a sabotage is counted, not named, and costs 2 extra', async () => {
  const { host, socks } = await table(5);
  act(host, 'cn:start');
  await all(socks, v => v.phase === 'roles');
  socks.forEach(s => act(s, 'cn:ready'));
  await all(socks, v => v.phase === 'propose');

  // Walk the lead around until a traitor holds it (votes down otherwise).
  for (let guard = 0; guard < 5; guard++) {
    const v = socks[0].seen['cn:state'];
    const leader = bySocket(socks, v.leader);
    if (leader.seen['cn:state'].you.role === 'traitor') break;
    const round = v.round, rejects = v.rejects;
    act(leader, 'cn:propose', { option: 'gold', partner: pidOf(socks.find(s => s !== leader)) });
    await all(socks, s => s.phase === 'vote');
    socks.forEach(s => act(s, 'cn:vote', { approve: false }));
    await untilState(socks[0], s => s.round !== round || s.rejects !== rejects || s.phase === 'result');
    if (socks[0].seen['cn:state'].phase === 'result') {       // panic after 3
      act(socks[0], 'cn:next', { round });
      await all(socks, s => s.phase === 'propose');
    }
  }
  const before = socks[0].seen['cn:state'].kingdom;
  const res = await playRound(socks, { side: 'people', sabotage: true });
  expect(res.result.sabotages).toBeGreaterThanOrEqual(1);
  expect(res.result.amount).toBe(1 + (res.result.trapped ? 1 : 0) + 2);
  expect(res.kingdom.people).toBe(Math.max(0, before.people - res.result.amount));
  // Nothing in anyone's view says who sabotaged.
  socks.forEach(s => expect(JSON.stringify(s.seen['cn:state'])).not.toMatch(/sabotage"/));
});

test('a dropped phone rejoins its seat with its role', async () => {
  const { host, socks } = await table(5);
  act(host, 'cn:start');
  await all(socks, v => v.phase === 'roles');
  const victim = socks[2];
  const role = victim.seen['cn:state'].you.role;
  victim.disconnect();
  const back = connect(victim.token);
  await connected(back);
  back.emit('cn:rejoin-room', { code: host.code, token: victim.token });
  const v = await untilState(back, s => s.phase === 'roles');
  expect(v.you.role).toBe(role);
  expect(v.you.name).toBe('P2');
});

test('the host can move on without a phone that is not coming back', async () => {
  const { host, socks } = await table(5);
  act(host, 'cn:start');
  await all(socks, v => v.phase === 'roles');
  socks.slice(0, 4).forEach(s => act(s, 'cn:ready'));
  await untilState(host, v => v.ready.length === 4);
  act(host, 'cn:skip', { phase: 'roles' });
  await untilState(host, v => v.phase === 'propose' && v.round === 1);
});

describe('bots', () => {
  const bots = require('../server/council/bots');
  const saved = { ...bots.timing };
  beforeAll(() => { bots.timing.min = 5; bots.timing.max = 15; });
  afterAll(() => { Object.assign(bots.timing, saved); });

  test('a practice table: one person and four bots play a whole game', async () => {
    const host = connect('tok-solo');
    await connected(host);
    host.emit('cn:create-room', { name: 'Solo', token: host.token, bots: 4 });
    host.code = (await until(host, 'cn:joined')).code;
    const lobby = await untilState(host, v => v.players.length === 5);
    expect(lobby.players.filter(p => p.bot)).toHaveLength(4);
    expect(lobby.players.every(p => p.connected)).toBe(true);
    expect(lobby.you.isHost).toBe(true);

    act(host, 'cn:start');
    await untilState(host, v => v.phase === 'roles');
    act(host, 'cn:ready');
    let v, last = '';
    for (let step = 0; step < 200; step++) {
      v = await untilState(host, s => `${s.phase}|${s.round}|${s.rejects}|${s.yourVote}|${s.yourAction}` !== last || s.phase === 'game-over', 8000);
      last = `${v.phase}|${v.round}|${v.rejects}|${v.yourVote}|${v.yourAction}`;
      if (v.phase === 'game-over') break;
      const me = v.you.pid;
      if (v.phase === 'propose' && v.leader === me) {
        act(host, 'cn:propose', { option: v.kingdom.gold >= v.kingdom.people ? 'gold' : 'people', partner: v.players.find(p => p.pid !== me).pid });
      } else if (v.phase === 'vote' && v.yourVote === null) {
        act(host, 'cn:vote', { approve: true });
      } else if (v.phase === 'act' && !v.yourAction && (v.proposal.leader === me || v.proposal.partner === me)) {
        act(host, 'cn:act', { choice: 'help' });
      } else if (v.phase === 'result') {
        act(host, 'cn:next', { round: v.round });
      }
    }
    expect(v.phase).toBe('game-over');
    expect(['loyal', 'traitors']).toContain(v.winner);
  });

  test('a bot seat cannot be taken by name, and bots are capped at 9', async () => {
    const host = connect('tok-cap');
    await connected(host);
    host.emit('cn:create-room', { name: 'Cap', token: host.token, bots: 50 });
    host.code = (await until(host, 'cn:joined')).code;
    const v = await untilState(host, s => s.players.length > 1);
    expect(v.players).toHaveLength(10);
    const thief = connect('tok-thief');
    await connected(thief);
    thief.emit('cn:join-room', { code: host.code, name: v.players.find(p => p.bot).name, token: thief.token });
    expect(await until(thief, 'cn:error')).toMatch(/taken/);
  });
});
