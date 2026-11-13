// The Council — rules. Pure functions over a room object; the handlers do the
// sockets and persistence. Everything is keyed by a seat's `pid`, which never
// changes, so a reconnect (new socket id) never loses a vote or a report.
//
// The whole game in a few lines:
//   The kingdom has Gold and People, 5 each. Five rounds. Each round a problem
//   comes up with two choices: spend 1 Gold, or lose 1 People. Either choice
//   (or both, or neither) may secretly be a TRAP that costs 1 extra.
//   Two players are this round's SCOUTS, and everyone knows who: one checks
//   the Gold choice, the other checks the People choice. Each scout reports
//   to the table "safe" or "trap" (a traitor scout may lie). The traitors
//   know about both choices. Everyone argues, then everyone votes Gold or
//   People; the votes are shown. A tie goes the Speaker's way (one player a
//   round, rotating). Only the chosen choice is revealed, so a lie about the
//   other choice is never proven.
//   Gold or People at 0: the traitors win at once. Survive all five rounds and
//   everyone names the traitor: name one and the loyal side wins; miss and
//   the traitors steal it.
//   The next problem follows from what the table chose (see cards.js).

const { SEEDS, STORY_SEEDS, cardById } = require('./cards');

const START = 5;              // Gold and People each start here
const ROUNDS = 5;
const BASE_COST = 1;
const TRAP_EXTRA = 1;
const TRAP_CHANCE = 0.5;      // each choice, independently
const MIN_PLAYERS = 4;
const MAX_PLAYERS = 10;
const SIDES = ['gold', 'people'];

function traitorCount(n) { return n >= 7 ? 2 : 1; }

function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const seatOf = (room, pid) => room.players.find(p => p.pid === pid) || null;
const traitors = room => room.players.filter(p => p.role === 'traitor');
const speakerPid = room => room.game ? room.game.order[(room.game.round - 1 + room.game.order.length) % room.game.order.length] : null;
const isScout = (room, pid) => !!room.game?.scouts && SIDES.some(s => room.game.scouts[s] === pid);
const scoutSide = (room, pid) => SIDES.find(s => room.game?.scouts?.[s] === pid) || null;

function startGame(room, rng = Math.random) {
  const n = room.players.length;
  if (n < MIN_PLAYERS) return { error: `You need at least ${MIN_PLAYERS} players.` };
  if (n > MAX_PLAYERS) return { error: `At most ${MAX_PLAYERS} players.` };
  const evil = new Set(shuffle(room.players.map(p => p.pid), rng).slice(0, traitorCount(n)));
  room.players.forEach(p => { p.role = evil.has(p.pid) ? 'traitor' : 'loyal'; });
  room.state = 'playing';
  room.phase = 'roles';
  room.game = {
    gold: START, people: START,
    round: 0,
    order: shuffle(room.players.map(p => p.pid), rng),   // Speaker rotation
    scouted: Object.fromEntries(room.players.map(p => [p.pid, 0])),
    used: [],
    ready: [],
    history: [],
    winner: null,
  };
  return { ok: true };
}

function markReady(room, pid) {
  if (room.phase !== 'roles' || !seatOf(room, pid)) return false;
  const g = room.game;
  if (!g.ready.includes(pid)) g.ready.push(pid);
  return true;
}

const allReady = room => room.phase === 'roles' && room.players.every(p => room.game.ready.includes(p.pid));

// The next problem: the follow-up to last round's choice when there is one,
// otherwise a fresh problem (a story problem when any are left).
function nextCard(room, rng) {
  const g = room.game;
  const last = g.history[g.history.length - 1];
  const follow = last?.choice && cardById(last.card)?.next?.[last.choice];
  if (follow && !g.used.includes(follow)) return follow;
  const fresh = ids => ids.filter(id => !g.used.includes(id));
  const pool = fresh(STORY_SEEDS).length && rng() < 0.75 ? fresh(STORY_SEEDS) : fresh(SEEDS);
  return pool.length ? pool[Math.floor(rng() * pool.length)] : SEEDS[Math.floor(rng() * SEEDS.length)];
}

// Two scouts who have scouted least so far, never the same pair twice in a
// row when the table is big enough. Which of the two checks which choice is
// random.
function pickScouts(room, rng) {
  const g = room.game;
  const prev = new Set(SIDES.map(s => g.scouts?.[s]).filter(Boolean));
  const ranked = shuffle(room.players.map(p => p.pid), rng)
    .sort((a, b) => (g.scouted[a] - g.scouted[b]) || ((prev.has(a) ? 1 : 0) - (prev.has(b) ? 1 : 0)));
  const pair = shuffle(ranked.slice(0, 2), rng);
  pair.forEach(pid => { g.scouted[pid] = (g.scouted[pid] || 0) + 1; });
  return { gold: pair[0], people: pair[1] };
}

// Deal the next problem. Called once everyone has seen their role, and after
// each round's result.
function beginRound(room, rng = Math.random) {
  const g = room.game;
  g.round += 1;
  g.card = nextCard(room, rng);
  g.used.push(g.card);
  g.traps = { gold: rng() < TRAP_CHANCE, people: rng() < TRAP_CHANCE };
  g.scouts = pickScouts(room, rng);
  g.reports = { gold: null, people: null };
  g.votes = {};
  g.result = null;
  room.phase = 'scout';
}

// A scout tells the table what they found. A traitor may say anything; the
// server only checks that it is this scout's choice to report on.
function report(room, pid, side, says) {
  const g = room.game;
  if (room.phase !== 'scout') return false;
  if (!SIDES.includes(side) || g.scouts[side] !== pid) return false;
  if (says !== 'safe' && says !== 'trap') return false;
  g.reports[side] = says;
  return true;
}

const reportsComplete = room => room.phase === 'scout' && SIDES.every(s => room.game.reports[s]);

// Everyone has heard both scouts: open the vote. The host can also open it
// without a scout whose phone has gone dark.
function openVote(room) {
  if (room.phase !== 'scout') return false;
  room.phase = 'vote';
  room.game.votes = {};
  return true;
}

function castVote(room, pid, choice) {
  if (room.phase !== 'vote' || !seatOf(room, pid) || !SIDES.includes(choice)) return false;
  room.game.votes[pid] = choice;
  return true;
}

// `voters` is who the table is waiting on.
function voteComplete(room, voters) {
  if (room.phase !== 'vote') return false;
  const v = room.game.votes;
  return voters.length > 0 && voters.every(pid => pid in v);
}

function tally(votes) {
  const t = { gold: [], people: [] };
  Object.entries(votes).forEach(([pid, c]) => t[c]?.push(pid));
  return t;
}

function resolveVote(room, rng = Math.random) {
  const g = room.game;
  const t = tally(g.votes);
  const speaker = speakerPid(room);
  let choice, tieBreak = false;
  if (t.gold.length !== t.people.length) choice = t.gold.length > t.people.length ? 'gold' : 'people';
  else {
    tieBreak = true;
    choice = g.votes[speaker] || SIDES[Math.floor(rng() * 2)];
  }
  const trapped = g.traps[choice];
  const amount = BASE_COST + (trapped ? TRAP_EXTRA : 0);
  g[choice] = Math.max(0, g[choice] - amount);
  // Did the scout who checked the chosen side tell the truth? That is the
  // only thing the result can prove; the other side stays secret.
  const said = g.reports[choice];
  const truth = trapped ? 'trap' : 'safe';
  const result = {
    round: g.round, card: g.card, choice, trapped, amount, tieBreak, speaker,
    scouts: { ...g.scouts }, reports: { ...g.reports },
    caught: said && said !== truth ? g.scouts[choice] : null,
    votes: t,
    after: { gold: g.gold, people: g.people },
  };
  g.result = result;
  g.history.push(result);
  if (g.gold <= 0 || g.people <= 0) { g.winner = 'traitors'; g.endReason = g.gold <= 0 ? 'gold' : 'people'; }
  room.phase = 'result';
  return result;
}

// After the result screen: the next round, the accusation, or the end.
function nextRound(room, rng = Math.random) {
  if (room.phase !== 'result') return false;
  const g = room.game;
  if (g.winner) { room.phase = 'game-over'; return true; }
  if (g.round >= ROUNDS) { room.phase = 'accuse'; g.accusations = {}; return true; }
  beginRound(room, rng);
  return true;
}

// ── The last vote: name the traitor ────────────────────────────────────────
function accuse(room, pid, target) {
  if (room.phase !== 'accuse' || !seatOf(room, pid) || !seatOf(room, target) || pid === target) return false;
  room.game.accusations[pid] = target;
  return true;
}

function accuseComplete(room, voters) {
  if (room.phase !== 'accuse') return false;
  const a = room.game.accusations;
  return voters.length > 0 && voters.every(pid => pid in a);
}

// Most votes is named. A tie names nobody, and the traitors slip away.
function resolveAccusation(room) {
  const g = room.game;
  const count = {};
  Object.values(g.accusations).forEach(t => { count[t] = (count[t] || 0) + 1; });
  const top = Math.max(0, ...Object.values(count));
  const leaders = Object.keys(count).filter(k => count[k] === top);
  const named = leaders.length === 1 ? leaders[0] : null;
  const caught = !!named && seatOf(room, named)?.role === 'traitor';
  g.verdict = { named, tie: leaders.length > 1, count, caught, votes: { ...g.accusations } };
  g.winner = caught ? 'loyal' : 'traitors';
  g.endReason = caught ? 'caught' : (named ? 'wrong' : 'tie');
  room.phase = 'game-over';
}

function resetToLobby(room) {
  room.state = 'lobby';
  room.phase = null;
  room.game = null;
  room.players.forEach(p => { p.role = null; });
}

module.exports = {
  START, ROUNDS, BASE_COST, TRAP_EXTRA, TRAP_CHANCE, MIN_PLAYERS, MAX_PLAYERS, SIDES,
  traitorCount, shuffle, seatOf, traitors, speakerPid, isScout, scoutSide, cardById, tally,
  startGame, markReady, allReady, beginRound, report, reportsComplete, openVote,
  castVote, voteComplete, resolveVote, nextRound,
  accuse, accuseComplete, resolveAccusation, resetToLobby,
};
