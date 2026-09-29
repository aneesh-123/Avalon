// Trivia Night game logic. Pure functions over a room object: every function
// that depends on the clock takes `now` (server epoch ms) so tests can drive
// time explicitly. The handlers own sockets, timers and persistence.
//
// Two modes:
//   host — a quizmaster reads each question aloud and runs a buzzer. The app
//          supplies the questions, the buzzer and the scoreboard; the host
//          judges spoken answers.
//   auto — no host. Every team sees the question and four choices on their
//          phones, locks in one answer before the clock runs out, and the app
//          scores it.
const { questionsIn, questionById, isCategory, categoryList } = require('./questions');
const { shuffle } = require('./rooms');

const MODES = ['host', 'auto'];
const MIN_ROUNDS = 1, MAX_ROUNDS = 8;
const MIN_PER_ROUND = 3, MAX_PER_ROUND = 15;
const SECONDS_CHOICES = [10, 15, 20, 30, 45];
const MAX_TEAMS = 8;
const MAX_TEAM_NAME = 24;

const POINTS = 100;           // a correct answer, in either mode
const SPEED_BONUS = 50;       // auto mode: up to this much extra for answering fast

// ── Buzzer timing ──
// A buzz is ranked by when the player tapped, not when the packet arrived, so
// a phone on slow wifi does not lose a race it won in the room. The client
// stamps the tap on its own clock, converted to server time with an offset it
// measures against the server (see `triv:clock`). The server then:
//   • never ranks a stamp before the moment the buzzers opened — the one
//     forgery that matters. A buzz also has to carry the id of the current
//     opening, which a phone only learns when the buzzers open, so a tap made
//     before the host released them can never count;
//   • never lets a stamp be later than its own arrival;
//   • never trusts a stamp more than MAX_TRUSTED_LAG_MS older than arrival, so
//     a tampered client can gain at most that much;
//   • waits BUZZ_WINDOW_MS after the first buzz arrives before deciding, so a
//     faster tap on a slower connection still gets counted.
const BUZZ_WINDOW_MS = 350;
const MAX_TRUSTED_LAG_MS = 600;

// ── Auto-mode pacing ──
const ROUND_INTRO_MS = 5000;
const REVEAL_MS = 7000;
const ROUND_END_MS = 15000;
const ANSWER_GRACE_MS = 400;  // an answer tapped at 0.0s may still be in flight

const TEAM_STYLES = [
  { crest: '🦉', color: '#c9a96e', suggest: 'The Owls' },
  { crest: '🐉', color: '#d9776b', suggest: 'The Dragons' },
  { crest: '🦊', color: '#e0a458', suggest: 'The Foxes' },
  { crest: '🐺', color: '#6fa8dc', suggest: 'The Wolves' },
  { crest: '🦁', color: '#8fc97a', suggest: 'The Lions' },
  { crest: '🦄', color: '#a58fd6', suggest: 'The Unicorns' },
  { crest: '🐙', color: '#5fb3a8', suggest: 'The Krakens' },
  { crest: '🦅', color: '#d98bb0', suggest: 'The Eagles' },
];

// ── Config ────────────────────────────────────────────────────────────────

function clampInt(v, lo, hi, dflt) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

function sanitizeConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const cats = (Array.isArray(c.categories) ? c.categories : [])
    .filter(id => typeof id === 'string' && isCategory(id))
    .filter((id, i, arr) => arr.indexOf(id) === i);
  const seconds = parseInt(c.seconds, 10);
  return {
    mode: MODES.includes(c.mode) ? c.mode : 'host',
    categories: cats.length ? cats : categoryList().map(x => x.id),
    rounds: clampInt(c.rounds, MIN_ROUNDS, MAX_ROUNDS, 3),
    perRound: clampInt(c.perRound, MIN_PER_ROUND, MAX_PER_ROUND, 6),
    seconds: SECONDS_CHOICES.includes(seconds) ? seconds : 20,
    // themed: each round is one category, cycling through the picks.
    // mixed:  every round draws from all the picked categories.
    roundStyle: c.roundStyle === 'mixed' ? 'mixed' : 'themed',
    // Host mode only: whether players see the question text on their phones
    // while the host reads it. Off turns phones into pure buzzers.
    showOnPhones: c.showOnPhones !== false,
  };
}

// ── Plan ──────────────────────────────────────────────────────────────────
// Every question for the whole game is picked up front, with no repeats, so a
// reconnect or a server restart replays exactly the same game.
function buildPlan(config) {
  const used = new Set();
  const take = (pool, n) => {
    const out = [];
    for (const q of shuffle(pool)) {
      if (out.length >= n) break;
      if (used.has(q.id)) continue;
      used.add(q.id);
      out.push(q.id);
    }
    return out;
  };
  const selectedPool = () => config.categories.flatMap(id => questionsIn(id));
  const everything   = () => categoryList().flatMap(c => questionsIn(c.id));

  const plan = [];
  for (let r = 0; r < config.rounds; r++) {
    const category = config.roundStyle === 'mixed'
      ? 'mixed'
      : config.categories[r % config.categories.length];
    let ids = category === 'mixed' ? take(selectedPool(), config.perRound) : take(questionsIn(category), config.perRound);
    // A themed category can run dry when it comes round a second time; top up
    // from the other picks, then from anything, rather than shortening the round.
    if (ids.length < config.perRound) ids = ids.concat(take(selectedPool(), config.perRound - ids.length));
    if (ids.length < config.perRound) ids = ids.concat(take(everything(), config.perRound - ids.length));
    plan.push({ category, questionIds: ids });
  }
  return plan;
}

// ── Teams ─────────────────────────────────────────────────────────────────

function cleanTeamName(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_TEAM_NAME);
}

function nextTeamStyle(room) {
  const taken = new Set(room.teams.map(t => t.crest));
  return TEAM_STYLES.find(s => !taken.has(s.crest)) || TEAM_STYLES[room.teams.length % TEAM_STYLES.length];
}

function suggestTeamName(room) { return nextTeamStyle(room).suggest; }

function createTeam(room, rawName) {
  if (room.teams.length >= MAX_TEAMS) return { error: `At most ${MAX_TEAMS} teams.` };
  const style = nextTeamStyle(room);
  const name = cleanTeamName(rawName) || style.suggest;
  if (room.teams.some(t => t.name.toLowerCase() === name.toLowerCase())) return { error: 'That team name is taken.' };
  room.teamSeq = (room.teamSeq || 0) + 1;
  const team = { id: 't' + room.teamSeq, name, crest: style.crest, color: style.color, score: 0 };
  room.teams.push(team);
  return { team };
}

// Empty teams are tidied away in the lobby only; once the game starts a team
// keeps its place and its score even if everyone on it steps out.
function pruneEmptyTeams(room) {
  if (room.state !== 'lobby') return;
  room.teams = room.teams.filter(t => room.players.some(p => p.teamId === t.id));
}

function setPlayerTeam(room, player, teamId) {
  if (teamId !== null && !room.teams.some(t => t.id === teamId)) return false;
  player.teamId = teamId;
  pruneEmptyTeams(room);
  return true;
}

// Teams that could still answer: anyone is on them.
function activeTeams(room) {
  return room.teams.filter(t => room.players.some(p => p.teamId === t.id));
}

// ── Game flow ─────────────────────────────────────────────────────────────

function currentRound(room) { return room.plan?.[room.roundIndex] || null; }

function startGame(room, now) {
  room.plan = buildPlan(room.config);
  room.state = 'playing';
  room.roundIndex = 0;
  room.qIndex = 0;
  room.teams.forEach(t => { t.score = 0; });
  room.roundScores = room.plan.map(() => ({}));
  room.current = null;
  room.result = null;
  room.buzz = null;
  room.answers = null;
  enterPhase(room, 'round-intro', now);
}

// Sets the phase and, in auto mode, when it ends. Host mode has no clock:
// the host moves everything on.
function enterPhase(room, phase, now) {
  room.phase = phase;
  const auto = room.config.mode === 'auto';
  const ms = {
    'round-intro': ROUND_INTRO_MS,
    'question':    room.config.seconds * 1000,
    'reveal':      REVEAL_MS,
    'round-end':   ROUND_END_MS,
  }[phase];
  room.phaseEndsAt = auto && ms ? now + ms : null;
  room.phaseStartedAt = now;
}

function phaseDuration(room) {
  if (room.config.mode !== 'auto') return null;
  return {
    'round-intro': ROUND_INTRO_MS,
    'question':    room.config.seconds * 1000,
    'reveal':      REVEAL_MS,
    'round-end':   ROUND_END_MS,
  }[room.phase] || null;
}

function loadQuestion(room, qIndex, now) {
  const round = currentRound(room);
  const q = questionById(round.questionIds[qIndex]);
  room.qIndex = qIndex;
  const choices = shuffle([q.a, ...q.wrong]);
  room.current = {
    id: q.id, category: q.category, q: q.q, a: q.a,
    hostQ: q.hostQ || null, phoneHostQ: q.phoneHostQ || null,
    choices, correctIndex: choices.indexOf(q.a),
  };
  room.result = null;
  if (room.config.mode === 'host') {
    room.buzz = { open: false, openId: room.buzzSeq || 0, openedAt: null, windowEndsAt: null,
                  candidates: [], order: [], lockedOut: [], wrong: [], answeringTeamId: null };
  } else {
    room.answers = {};
  }
  enterPhase(room, 'question', now);
}

// The single "move on" action. What it means depends on where the game is.
function advance(room, now) {
  if (room.state !== 'playing') return false;
  switch (room.phase) {
    case 'round-intro':
      loadQuestion(room, 0, now);
      return true;
    case 'question':
      // Skipping a question reveals it first — nobody should wonder what the
      // answer was.
      if (room.config.mode === 'auto') resolveAutoQuestion(room, now);
      else revealNoWinner(room, now);
      return true;
    case 'reveal': {
      const round = currentRound(room);
      if (room.qIndex + 1 < round.questionIds.length) { loadQuestion(room, room.qIndex + 1, now); return true; }
      if (room.roundIndex + 1 < room.plan.length) { enterPhase(room, 'round-end', now); return true; }
      finishGame(room, now);
      return true;
    }
    case 'round-end':
      room.roundIndex += 1;
      room.qIndex = 0;
      room.current = null;
      room.result = null;
      enterPhase(room, 'round-intro', now);
      return true;
    default:
      return false;
  }
}

function finishGame(room, now) {
  room.current = room.current || null;
  enterPhase(room, 'game-over', now);
  room.phaseEndsAt = null;
}

function endGameEarly(room, now) {
  if (room.state !== 'playing' || room.phase === 'game-over') return false;
  if (room.buzz) { room.buzz.open = false; room.buzz.windowEndsAt = null; }
  finishGame(room, now);
  return true;
}

// Back to the lobby with the same teams, scores cleared, for another game.
function resetToLobby(room) {
  room.state = 'lobby';
  room.phase = null;
  room.phaseEndsAt = null;
  room.plan = null;
  room.current = null;
  room.result = null;
  room.buzz = null;
  room.answers = null;
  room.roundScores = null;
  room.teams.forEach(t => { t.score = 0; });
  pruneEmptyTeams(room);
}

function award(room, teamId, points) {
  const team = room.teams.find(t => t.id === teamId);
  if (!team) return;
  team.score += points;
  const rs = room.roundScores?.[room.roundIndex];
  if (rs) rs[teamId] = (rs[teamId] || 0) + points;
}

// ── Host mode: buzzer ─────────────────────────────────────────────────────

function openBuzzers(room, now) {
  if (room.config.mode !== 'host' || room.phase !== 'question') return false;
  const b = room.buzz;
  if (b.open || b.answeringTeamId) return false;
  if (!eligibleBuzzTeams(room).length) return false;
  room.buzzSeq = (room.buzzSeq || 0) + 1;
  b.open = true;
  b.openId = room.buzzSeq;
  b.openedAt = now;
  b.windowEndsAt = null;
  b.candidates = [];
  b.order = [];
  return true;
}

function eligibleBuzzTeams(room) {
  const locked = room.buzz?.lockedOut || [];
  return activeTeams(room).filter(t => !locked.includes(t.id));
}

// Returns { ok, first, reason }. `first` means this buzz opened the window and
// the caller must schedule closeBuzzWindow at buzz.windowEndsAt.
function registerBuzz(room, player, { openId, at } = {}, now) {
  if (room.config.mode !== 'host' || room.phase !== 'question') return { ok: false, reason: 'closed' };
  const b = room.buzz;
  if (!b.open || openId !== b.openId) return { ok: false, reason: 'closed' };
  if (!player.teamId) return { ok: false, reason: 'no-team' };
  if (b.lockedOut.includes(player.teamId)) return { ok: false, reason: 'locked-out' };
  if (b.candidates.some(c => c.teamId === player.teamId)) return { ok: false, reason: 'already' };
  if (b.windowEndsAt !== null && now > b.windowEndsAt) return { ok: false, reason: 'too-late' };

  let t = typeof at === 'number' && Number.isFinite(at) ? at : now;
  if (t < b.openedAt) {
    // A phone only learns the openId when the buzzers open, so a genuine tap
    // can only land before openedAt through clock-estimate error; those are
    // pinned to the opening instant. Far earlier than any estimate could be
    // off by is not a tap on this question at all.
    if (b.openedAt - t > 1000) return { ok: false, reason: 'early' };
    t = b.openedAt;
  }
  t = Math.min(t, now);
  t = Math.max(t, now - MAX_TRUSTED_LAG_MS);

  b.candidates.push({ teamId: player.teamId, playerId: player.id, name: player.name, t, arrival: now });
  const first = b.candidates.length === 1;
  if (first) b.windowEndsAt = now + BUZZ_WINDOW_MS;
  // Nobody left who could still buzz: no reason to make everyone wait out the window.
  const allIn = eligibleBuzzTeams(room).every(team => b.candidates.some(c => c.teamId === team.id));
  return { ok: true, first, allIn };
}

function closeBuzzWindow(room) {
  const b = room.buzz;
  if (!b || !b.open || !b.candidates.length) return false;
  const sorted = [...b.candidates].sort((x, y) => (x.t - y.t) || (x.arrival - y.arrival));
  const t0 = sorted[0].t;
  b.order = sorted.map(c => ({ teamId: c.teamId, name: c.name, delta: Math.round(c.t - t0) }));
  b.open = false;
  b.windowEndsAt = null;
  b.answeringTeamId = sorted[0].teamId;
  b.answeringName = sorted[0].name;
  return true;
}

// The host rules on the team that buzzed first.
function judge(room, correct, now) {
  if (room.config.mode !== 'host' || room.phase !== 'question') return false;
  const b = room.buzz;
  const teamId = b.answeringTeamId;
  if (!teamId) return false;
  if (correct) {
    award(room, teamId, POINTS);
    room.result = { correctTeamIds: [teamId], gained: { [teamId]: POINTS }, answeredBy: b.answeringName || null, wrongTeamIds: [...b.wrong] };
    enterPhase(room, 'reveal', now);
    return true;
  }
  b.lockedOut.push(teamId);
  b.wrong.push(teamId);
  b.answeringTeamId = null;
  b.answeringName = null;
  // Straight back open for everyone else — the question has already been read.
  if (!openBuzzers(room, now)) revealNoWinner(room, now);
  return true;
}

function revealNoWinner(room, now) {
  if (room.phase !== 'question') return false;
  if (room.buzz) { room.buzz.open = false; room.buzz.windowEndsAt = null; }
  room.result = { correctTeamIds: [], gained: {}, answeredBy: null, wrongTeamIds: [...(room.buzz?.wrong || [])] };
  enterPhase(room, 'reveal', now);
  return true;
}

// Host's manual correction, for anything the buttons do not cover.
function adjustScore(room, teamId, delta) {
  const d = parseInt(delta, 10);
  if (!Number.isFinite(d) || d === 0 || Math.abs(d) > 1000) return false;
  const team = room.teams.find(t => t.id === teamId);
  if (!team) return false;
  team.score = Math.max(-9999, Math.min(99999, team.score + d));
  const rs = room.roundScores?.[room.roundIndex];
  if (rs) rs[teamId] = (rs[teamId] || 0) + d;
  return true;
}

// ── Auto mode: multiple choice ────────────────────────────────────────────

// One answer per team, and the first tap from anyone on the team is it. Teams
// share phones or talk it over; letting a teammate overwrite it invites fights.
function submitAnswer(room, player, choice, now) {
  if (room.config.mode !== 'auto' || room.phase !== 'question') return { ok: false, reason: 'closed' };
  if (!player.teamId) return { ok: false, reason: 'no-team' };
  const c = parseInt(choice, 10);
  if (!Number.isInteger(c) || c < 0 || c >= room.current.choices.length) return { ok: false, reason: 'bad-choice' };
  if (room.answers[player.teamId]) return { ok: false, reason: 'already' };
  if (room.phaseEndsAt && now > room.phaseEndsAt + ANSWER_GRACE_MS) return { ok: false, reason: 'too-late' };
  room.answers[player.teamId] = { choice: c, by: player.name, at: Math.min(now, room.phaseEndsAt || now) };
  const allIn = activeTeams(room).every(t => room.answers[t.id]);
  return { ok: true, allIn };
}

function resolveAutoQuestion(room, now) {
  if (room.config.mode !== 'auto' || room.phase !== 'question') return false;
  const total = room.config.seconds * 1000;
  const byTeam = {};
  const gained = {};
  const correctTeamIds = [];
  for (const [teamId, ans] of Object.entries(room.answers || {})) {
    const correct = ans.choice === room.current.correctIndex;
    let points = 0;
    if (correct) {
      const left = Math.max(0, Math.min(1, ((room.phaseEndsAt ?? now) - ans.at) / total));
      points = POINTS + Math.round((SPEED_BONUS * left) / 5) * 5;
      correctTeamIds.push(teamId);
      award(room, teamId, points);
      gained[teamId] = points;
    }
    byTeam[teamId] = { choice: ans.choice, by: ans.by, correct, points };
  }
  room.result = { correctTeamIds, gained, byTeam };
  enterPhase(room, 'reveal', now);
  return true;
}

module.exports = {
  // constants
  MODES, MIN_ROUNDS, MAX_ROUNDS, MIN_PER_ROUND, MAX_PER_ROUND, SECONDS_CHOICES, MAX_TEAMS,
  POINTS, SPEED_BONUS, BUZZ_WINDOW_MS, MAX_TRUSTED_LAG_MS, TEAM_STYLES,
  ROUND_INTRO_MS, REVEAL_MS, ROUND_END_MS,
  // config & plan
  sanitizeConfig, buildPlan,
  // teams
  cleanTeamName, createTeam, setPlayerTeam, suggestTeamName, activeTeams, pruneEmptyTeams,
  // flow
  startGame, advance, endGameEarly, resetToLobby, phaseDuration, currentRound, enterPhase,
  // host mode
  openBuzzers, registerBuzz, closeBuzzWindow, judge, revealNoWinner, adjustScore, eligibleBuzzTeams,
  // auto mode
  submitAnswer, resolveAutoQuestion,
};
