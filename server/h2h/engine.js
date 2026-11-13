// Head to Head: a 1 vs 1 quiz. Two players, one category, seven questions,
// both answering the same question at once against a ten-second clock.
//
// Scoring: a right answer is worth 10 points plus up to 10 more for speed
// (20 for an instant answer, 10 at the buzzer). The last question counts
// double, so a match is never over until it's over.
//
// Speed is measured on the phone, from the moment the question appeared on
// that phone to the tap, so a slow network doesn't cost points. The server
// trusts it only within what it saw itself: never more than the time that
// actually passed, and never more than LAG_ALLOWANCE_MS less.
//
// Every phase change is driven by `phaseEnds` (a timestamp saved with the
// room). `tick` moves a room on once that time has passed, so a server restart
// mid-match picks up where it left off.
const Q = require('./questions');

const QUESTIONS = 7;
// Phase lengths. An object so the socket tests can shorten the pauses.
const T = { INTRO_MS: 3500, ANSWER_MS: 10000, REVEAL_MS: 3200 };
const GRACE_MS = 600;            // a tap sent just before the buzzer still counts
const LAG_ALLOWANCE_MS = 1500;
const BASE_POINTS = 10;
const SPEED_POINTS = 10;
const MAX_PLAYERS = 2;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const seatOf = (room, pid) => room.players.find(p => p.pid === pid) || null;

function setCategory(room, id) {
  if (room.state !== 'lobby' || !Q.isCategory(id)) return false;
  room.category = id;
  return true;
}

// Questions not seen in this room's last matches come first, so a rematch in
// the same category doesn't repeat itself until the pack runs out.
function pickQuestions(room) {
  const pool = Q.questionsIn(room.category);
  const seen = new Set(room.seen || []);
  const fresh = shuffle(pool.filter(q => !seen.has(q.id)));
  const stale = shuffle(pool.filter(q => seen.has(q.id)));
  const picked = [...fresh, ...stale].slice(0, QUESTIONS);
  room.seen = [...(room.seen || []).filter(id => !picked.some(q => q.id === id)), ...picked.map(q => q.id)]
    .slice(-Math.max(pool.length - QUESTIONS, 0));
  return picked.map(q => {
    const options = shuffle([q.a, ...q.wrong]);
    return { id: q.id, q: q.q, art: q.art || null, options, answer: options.indexOf(q.a) };
  });
}

function startMatch(room, now = Date.now()) {
  if (room.state !== 'lobby') return { error: 'The match has already started.' };
  if (room.players.length < MAX_PLAYERS) return { error: 'Waiting for a challenger.' };
  if (!Q.isCategory(room.category)) return { error: 'Pick a category first.' };
  room.players.forEach(p => { p.score = 0; });
  room.state = 'playing';
  room.phase = 'intro';
  room.game = { questions: pickQuestions(room), index: 0, answers: {}, history: [],
    startedAt: now, phaseEnds: now + T.INTRO_MS, winner: null };
  return { ok: true };
}

const isLast = g => g.index === g.questions.length - 1;

function pointsFor(ms, double) {
  const left = Math.max(0, Math.min(1, 1 - ms / T.ANSWER_MS));
  return (BASE_POINTS + Math.round(SPEED_POINTS * left)) * (double ? 2 : 1);
}

function beginQuestion(room, now) {
  const g = room.game;
  room.phase = 'question';
  g.answers = {};
  g.startedAt = now;
  g.phaseEnds = now + T.ANSWER_MS;
}

// A player's tap. `clientMs` is how long the question had been on their
// screen; see the comment at the top for how far it is trusted.
function answer(room, pid, choice, clientMs, now = Date.now()) {
  const g = room.game;
  if (room.state !== 'playing' || room.phase !== 'question' || !seatOf(room, pid)) return false;
  if (pid in g.answers || now > g.phaseEnds + GRACE_MS) return false;
  const q = g.questions[g.index];
  if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) return false;
  const elapsed = Math.min(now - g.startedAt, T.ANSWER_MS);
  const claimed = Number.isFinite(clientMs) ? clientMs : elapsed;
  const ms = Math.round(Math.max(Math.max(0, elapsed - LAG_ALLOWANCE_MS), Math.min(claimed, elapsed)));
  const correct = choice === q.answer;
  g.answers[pid] = { choice, ms, correct, points: correct ? pointsFor(ms, isLast(g)) : 0 };
  return true;
}

const allAnswered = room => room.players.every(p => p.pid in room.game.answers);

function reveal(room, now) {
  const g = room.game;
  room.players.forEach(p => {
    if (!(p.pid in g.answers)) g.answers[p.pid] = { choice: null, ms: null, correct: false, points: 0 };
    p.score = (p.score || 0) + g.answers[p.pid].points;
  });
  g.history.push({ answer: g.questions[g.index].answer, picks: g.answers });
  room.phase = 'reveal';
  g.phaseEnds = now + T.REVEAL_MS;
}

function finish(room) {
  const g = room.game;
  const [a, b] = room.players;
  g.winner = !b || a.score === b.score ? 'tie' : (a.score > b.score ? a.pid : b.pid);
  room.phase = 'game-over';
  g.phaseEnds = null;
}

// Move the room on if its current phase has run out. Returns whether anything
// changed. Call it in a loop to catch up after a long gap.
function tick(room, now = Date.now()) {
  const g = room.game;
  if (room.state !== 'playing' || !g || g.phaseEnds == null || now < g.phaseEnds) return false;
  if (room.phase === 'intro') beginQuestion(room, now);
  else if (room.phase === 'question') reveal(room, now);
  else if (room.phase === 'reveal') {
    if (isLast(g)) finish(room);
    else { g.index++; beginQuestion(room, now); }
  } else return false;
  return true;
}

// Both have answered: no need to sit out the clock.
function settle(room, now = Date.now()) {
  if (room.state === 'playing' && room.phase === 'question' && allAnswered(room)) { reveal(room, now); return true; }
  return false;
}

function resetToLobby(room) {
  room.state = 'lobby';
  room.phase = null;
  room.game = null;
  room.players.forEach(p => { p.score = 0; });
}

module.exports = {
  QUESTIONS, T, MAX_PLAYERS, BASE_POINTS, SPEED_POINTS,
  seatOf, setCategory, startMatch, answer, allAnswered, tick, settle, resetToLobby, pointsFor, isLast,
};
