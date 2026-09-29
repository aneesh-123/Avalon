/**
 * Trivia Night over real Socket.IO connections — the only layer that catches
 * wire-level breakage: payloads that don't serialize, per-player views sent to
 * the wrong socket, events that were never registered.
 *
 * The database is mocked, as in the Avalon integration suite.
 */
const http = require('http');
const { Server } = require('socket.io');
const { io: ioClient } = require('socket.io-client');
const registerTriviaHandlers = require('../server/trivia/handlers');
const { trivRooms } = require('../server/trivia/rooms');
const E = require('../server/trivia/engine');

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
  registerTriviaHandlers(ioServer);
  httpServer.listen(0, () => { port = httpServer.address().port; done(); });
});
afterAll(done => { ioServer.close(done); });
beforeEach(() => { Object.keys(trivRooms).forEach(k => delete trivRooms[k]); clients = []; });
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
const untilState = (s, pred, ms) => until(s, 'triv:state', pred, ms);

// Every action carries the room code and the seat's token, as the client does.
const act = (s, event, extra = {}) => s.emit(event, { code: s.code, token: s.token, ...extra });

async function setup(mode, extraConfig = {}) {
  const host = connect('tok-host');
  await connected(host);
  host.emit('triv:create-room', {
    name: 'Quizmaster', token: host.token,
    config: { mode, categories: ['geography'], rounds: 1, perRound: 3, ...extraConfig },
  });
  const { code } = await until(host, 'triv:joined');
  host.code = code;

  const players = [];
  for (const [name, token] of [['Ana', 'tok-a'], ['Ben', 'tok-b']]) {
    const s = connect(token);
    s.code = code;
    await connected(s);
    s.emit('triv:join-room', { code, name, token });
    await until(s, 'triv:joined');
    act(s, 'triv:create-team', { name: `${name}'s team` });
    await untilState(s, v => !!v.you.teamId);
    players.push(s);
  }
  return { host, players, code };
}

describe('hosted game over real sockets', () => {
  test('lobby → buzz with skewed clocks → judge → reveal, with the answer shown only to the host', async () => {
    const { host, players: [ana, ben] } = await setup('host');
    await untilState(host, v => v.teams.length === 2);

    act(host, 'triv:start');
    await untilState(ana, v => v.phase === 'round-intro');
    act(host, 'triv:next', { phase: 'round-intro' });

    const hostQ = await untilState(host, v => v.phase === 'question');
    const anaQ  = await untilState(ana, v => v.phase === 'question');
    expect(hostQ.question.answer).toBeTruthy();
    expect(anaQ.question.answer).toBeNull();          // players never get the key early
    expect(anaQ.question.text).toBeTruthy();          // but do read along
    expect(anaQ.buzz.open).toBe(false);

    // A buzz before the host opens the buzzers does nothing.
    act(ana, 'triv:buzz', { openId: 1, at: Date.now() });
    const early = await until(ana, 'triv:buzz-ack');
    expect(early.ok).toBe(false);

    act(host, 'triv:open-buzzers');
    const open = await untilState(ben, v => v.buzz?.open);
    const opened = trivRooms[host.code].buzz.openedAt;

    // Both tapped a moment ago. Ben's packet goes first, but Ana's phone says
    // she tapped 80ms before he did (her connection was just slower).
    await new Promise(r => setTimeout(r, Math.max(0, opened + 200 - Date.now())));
    act(ben, 'triv:buzz', { openId: open.buzz.openId, at: opened + 150 });
    await new Promise(r => setTimeout(r, 60));
    act(ana, 'triv:buzz', { openId: open.buzz.openId, at: opened + 70 });

    const ruled = await untilState(host, v => !!v.buzz?.answeringTeamId);
    const anaTeam = ruled.teams.find(t => t.members.some(m => m.name === 'Ana'));
    expect(ruled.buzz.answeringTeamId).toBe(anaTeam.id);
    expect(ruled.buzz.answeringName).toBe('Ana');
    expect(ruled.buzz.order).toHaveLength(2);

    act(host, 'triv:judge', { correct: true, teamId: anaTeam.id });
    const reveal = await untilState(ana, v => v.phase === 'reveal');
    expect(reveal.question.answer).toBeTruthy();
    expect(reveal.teams.find(t => t.id === anaTeam.id).score).toBe(E.POINTS);
  });

  test('a buzz sent on a fresh socket after a reconnect still lands on the right seat', async () => {
    const { host, players: [ana] } = await setup('host');
    act(host, 'triv:start');
    await untilState(host, v => v.phase === 'round-intro');
    act(host, 'triv:next', { phase: 'round-intro' });
    await untilState(host, v => v.phase === 'question');
    act(host, 'triv:open-buzzers');
    const open = await untilState(ana, v => v.buzz?.open);

    // Ana's wifi drops. Her phone reconnects with a new socket and buzzes
    // before it has had a chance to rejoin.
    ana.disconnect();
    const again = connect('tok-a');
    again.code = ana.code;
    await connected(again);
    act(again, 'triv:buzz', { openId: open.buzz.openId, at: null });

    const ack = await until(again, 'triv:buzz-ack');
    expect(ack.ok).toBe(true);
    const ruled = await untilState(host, v => !!v.buzz?.answeringTeamId);
    expect(ruled.buzz.answeringName).toBe('Ana');
  });

  test('a player who drops and rejoins gets the current question back', async () => {
    const { host, players: [ana] } = await setup('host');
    act(host, 'triv:start');
    await untilState(host, v => v.phase === 'round-intro');
    act(host, 'triv:next', { phase: 'round-intro' });
    await untilState(host, v => v.phase === 'question');

    ana.disconnect();
    const dropped = await untilState(host, v => v.teams.some(t => t.members.some(m => m.name === 'Ana' && !m.connected)));
    expect(dropped.phase).toBe('question');           // the game does not pause for one player

    const back = connect('tok-a');
    await connected(back);
    back.emit('triv:rejoin-room', { code: host.code, token: 'tok-a' });
    const v = await untilState(back, s => s.phase === 'question');
    expect(v.you.name).toBe('Ana');
    expect(v.you.teamId).toBeTruthy();
  });

  test('a stale double-tap on Next does not skip a question', async () => {
    const { host } = await setup('host');
    act(host, 'triv:start');
    await untilState(host, v => v.phase === 'round-intro');
    act(host, 'triv:next', { phase: 'round-intro' });
    act(host, 'triv:next', { phase: 'round-intro' });
    const v = await untilState(host, s => s.phase === 'question');
    await new Promise(r => setTimeout(r, 100));
    expect(trivRooms[host.code].phase).toBe('question');
    expect(v.round.qIndex).toBe(0);
  });

  test('only the host can open buzzers and judge', async () => {
    const { host, players: [ana] } = await setup('host');
    act(host, 'triv:start');
    await untilState(host, v => v.phase === 'round-intro');
    act(ana, 'triv:next', { phase: 'round-intro' });   // not the host: ignored
    await new Promise(r => setTimeout(r, 100));
    expect(trivRooms[host.code].phase).toBe('round-intro');
    act(host, 'triv:next', { phase: 'round-intro' });
    await untilState(host, v => v.phase === 'question');
    act(ana, 'triv:open-buzzers');
    await new Promise(r => setTimeout(r, 100));
    expect(trivRooms[host.code].buzz.open).toBe(false);
  });

  test('malformed payloads do not take the server down', async () => {
    const s = connect('tok-x');
    await connected(s);
    for (const ev of ['triv:create-room', 'triv:join-room', 'triv:rejoin-room', 'triv:buzz', 'triv:answer',
                      'triv:next', 'triv:judge', 'triv:create-team', 'triv:join-team', 'triv:adjust-score']) {
      s.emit(ev);
      s.emit(ev, null);
      s.emit(ev, 'junk');
      s.emit(ev, { code: 12, token: {}, name: ['x'], config: 'x', openId: 'x', at: 'x', choice: {} });
    }
    s.emit('triv:clock', {}, () => {});
    const pong = await new Promise(r => s.emit('triv:clock', {}, r));
    expect(typeof pong.now).toBe('number');
  });
});

describe('no-host game over real sockets', () => {
  test('everyone answers → early reveal with points → next', async () => {
    const { host, players: [ana, ben] } = await setup('auto', { seconds: 30 });
    // In no-host mode the creator plays too.
    act(host, 'triv:create-team', { name: 'Hosts' });
    await untilState(host, v => !!v.you.teamId);

    act(host, 'triv:start');
    await untilState(ana, v => v.phase === 'round-intro' && !!v.phaseEndsAt);
    act(ana, 'triv:next', { phase: 'round-intro' });   // not the controller: ignored
    act(host, 'triv:next', { phase: 'round-intro' });
    const q = await untilState(ana, v => v.phase === 'question');
    expect(q.question.choices).toHaveLength(4);
    expect(q.question.correctIndex).toBeNull();

    const right = trivRooms[host.code].current.correctIndex;
    act(ana, 'triv:answer', { choice: right });
    const mine = await untilState(ana, v => !!v.answers?.yours);
    expect(mine.answers.yours.choice).toBe(right);
    // Ben's phone shows that a team has answered, but not what.
    const benView = await untilState(ben, v => v.answers?.answeredTeamIds.length === 1);
    expect(benView.answers.yours).toBeNull();

    act(ben, 'triv:answer', { choice: (right + 1) % 4 });
    act(host, 'triv:answer', { choice: (right + 2) % 4 });
    const reveal = await untilState(ana, v => v.phase === 'reveal');
    expect(reveal.question.correctIndex).toBe(right);
    const anaTeam = reveal.teams.find(t => t.members.some(m => m.name === 'Ana'));
    expect(anaTeam.score).toBeGreaterThanOrEqual(E.POINTS);
    expect(reveal.result.correctTeamIds).toEqual([anaTeam.id]);

    act(host, 'triv:next', { phase: 'reveal', qIndex: 0 });
    const q2 = await untilState(ana, v => v.phase === 'question' && v.round.qIndex === 1);
    expect(q2.answers.yours).toBeNull();
  });
});
