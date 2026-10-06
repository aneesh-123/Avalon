// The Council — rules. Pure functions over a room object; the handlers do the
// sockets and persistence. Everything is keyed by a seat's `pid`, which never
// changes, so a reconnect (new socket id) never loses a vote or an action.
//
// The whole game in a few lines:
//   The kingdom has Gold and People, 5 each. Five rounds. Each round a problem
//   comes up with two answers: spend 1 Gold, or lose 1 People. One of the two
//   is secretly a trap and costs 1 extra; a few players get a whisper saying
//   which (in this version the whisper is always true). The leader picks an
//   answer and one partner; everyone votes. If it passes, the two secretly
//   Help or Sabotage, and any sabotage costs 2 extra. Hit 0 on either and the
//   traitors win; get through round 5 and the loyal council wins.

const { CARDS, cardById } = require('./cards');

const START = 5;              // Gold and People each start here
const ROUNDS = 5;
const MAX_REJECTS = 3;        // this many failed votes in one round = panic
const TRAP_EXTRA = 1;
const SABOTAGE_EXTRA = 2;
const MIN_PLAYERS = 5;
const MAX_PLAYERS = 10;
const SIDES = ['gold', 'people'];

// Same split as Avalon, which players already know.
function traitorCount(n) { return n >= 10 ? 4 : n >= 7 ? 3 : 2; }
// Whispers per round: enough that the table has something to argue about,
// few enough that claiming one is still worth a lie.
function whisperCount(n) { return n >= 8 ? 3 : 2; }

function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const seatOf = (room, pid) => room.players.find(p => p.pid === pid) || null;
const leaderPid = room => room.game ? room.game.order[room.game.leaderIndex % room.game.order.length] : null;
const traitors = room => room.players.filter(p => p.role === 'traitor');

function startGame(room, rng = Math.random) {
  const n = room.players.length;
  if (n < MIN_PLAYERS) return { error: `You need at least ${MIN_PLAYERS} players.` };
  if (n > MAX_PLAYERS) return { error: `At most ${MAX_PLAYERS} players.` };
  const evil = new Set(shuffle(room.players.map(p => p.pid), rng).slice(0, traitorCount(n)));
  room.players.forEach(p => { p.role = evil.has(p.pid) ? 'traitor' : 'loyal'; });
  const order = room.players.map(p => p.pid);
  room.state = 'playing';
  room.phase = 'roles';
  room.game = {
    gold: START, people: START,
    round: 0,
    order,
    leaderIndex: Math.floor(rng() * order.length),
    deck: shuffle(CARDS.map(c => c.id), rng).slice(0, ROUNDS),
    ready: [],
    history: [],
    winner: null,
  };
  return { ok: true };
}

function markReady(room, pid) {
  if (room.phase !== 'roles') return false;
  const g = room.game;
  if (!g.ready.includes(pid)) g.ready.push(pid);
  return true;
}

const allReady = room => room.phase === 'roles' && room.players.every(p => room.game.ready.includes(p.pid));

// Deal the next problem. Called once everyone has seen their role, and after
// each round's result.
function beginRound(room, rng = Math.random) {
  const g = room.game;
  g.round += 1;
  g.card = g.deck[g.round - 1];
  g.trap = SIDES[Math.floor(rng() * 2)];
  g.whispers = shuffle(room.players.map(p => p.pid), rng).slice(0, whisperCount(room.players.length));
  g.rejects = 0;
  g.proposal = null;
  g.votes = {};
  g.lastVote = null;
  g.actions = {};
  g.result = null;
  room.phase = 'propose';
}

function propose(room, pid, { option, partner }) {
  if (room.phase !== 'propose') return { error: 'Not proposing right now.' };
  if (leaderPid(room) !== pid) return { error: 'Only the leader proposes.' };
  if (!SIDES.includes(option)) return { error: 'Pick Gold or People.' };
  if (partner === pid || !seatOf(room, partner)) return { error: 'Pick a partner.' };
  const g = room.game;
  g.proposal = { option, leader: pid, partner };
  g.votes = {};
  room.phase = 'vote';
  return { ok: true };
}

// The leader changed their mind before anyone voted.
function withdraw(room, pid) {
  const g = room.game;
  if (room.phase !== 'vote' || g.proposal?.leader !== pid || Object.keys(g.votes).length) return false;
  g.proposal = null;
  room.phase = 'propose';
  return true;
}

function castVote(room, pid, approve) {
  if (room.phase !== 'vote' || !seatOf(room, pid)) return false;
  room.game.votes[pid] = approve === true;
  return true;
}

// `voters` is who the table is waiting on: everyone seated, or (when a phone
// has died) just the live ones, so one dark screen cannot freeze the game.
function voteComplete(room, voters) {
  if (room.phase !== 'vote') return false;
  const v = room.game.votes;
  return voters.length > 0 && voters.every(pid => pid in v);
}

function resolveVote(room) {
  const g = room.game;
  const yes = Object.values(g.votes).filter(Boolean).length;
  const no = Object.values(g.votes).length - yes;
  const passed = yes > no;   // a tie fails, as in Avalon
  g.lastVote = {
    passed,
    proposal: g.proposal,
    approve: Object.keys(g.votes).filter(k => g.votes[k]),
    reject: Object.keys(g.votes).filter(k => !g.votes[k]),
  };
  if (passed) {
    g.actions = {};
    room.phase = 'act';
    return { passed };
  }
  g.rejects += 1;
  g.leaderIndex += 1;
  g.proposal = null;
  g.votes = {};
  if (g.rejects >= MAX_REJECTS) { panic(room); return { passed, panic: true }; }
  room.phase = 'propose';
  return { passed };
}

// Loyal players can only help. The server enforces it, so a tampered client
// gains nothing.
function act(room, pid, choice) {
  const g = room.game;
  if (room.phase !== 'act' || !g.proposal) return false;
  if (pid !== g.proposal.leader && pid !== g.proposal.partner) return false;
  if (pid in g.actions) return false;
  const seat = seatOf(room, pid);
  g.actions[pid] = choice === 'sabotage' && seat?.role === 'traitor' ? 'sabotage' : 'help';
  return true;
}

const actsComplete = room => room.phase === 'act'
  && [room.game.proposal.leader, room.game.proposal.partner].every(pid => pid in room.game.actions);

function settle(room, result) {
  const g = room.game;
  g.gold = Math.max(0, g.gold - result.cost.gold);
  g.people = Math.max(0, g.people - result.cost.people);
  result.after = { gold: g.gold, people: g.people };
  g.result = result;
  g.history.push({ round: g.round, card: g.card, ...result });
  if (g.gold <= 0 || g.people <= 0) { g.winner = 'traitors'; g.endReason = g.gold <= 0 ? 'gold' : 'people'; }
  else if (g.round >= ROUNDS) { g.winner = 'loyal'; g.endReason = 'survived'; }
  room.phase = 'result';
}

function resolveActs(room) {
  const g = room.game;
  const sabotages = Object.values(g.actions).filter(a => a === 'sabotage').length;
  const option = g.proposal.option;
  const trapped = g.trap === option;
  const amount = 1 + (trapped ? TRAP_EXTRA : 0) + (sabotages ? SABOTAGE_EXTRA : 0);
  settle(room, {
    kind: 'plan', option, trapped, sabotages, amount,
    leader: g.proposal.leader, partner: g.proposal.partner,
    cost: { gold: option === 'gold' ? amount : 0, people: option === 'people' ? amount : 0 },
  });
  g.leaderIndex += 1;
}

// Three plans voted down in one round: the kingdom loses its nerve and both
// sides pay.
function panic(room) {
  settle(room, { kind: 'panic', option: null, trapped: false, sabotages: 0, amount: 1, cost: { gold: 1, people: 1 } });
}

// After the result screen: the next round, or the end.
function nextRound(room, rng = Math.random) {
  if (room.phase !== 'result') return false;
  if (room.game.winner) { room.phase = 'game-over'; return true; }
  beginRound(room, rng);
  return true;
}

function resetToLobby(room) {
  room.state = 'lobby';
  room.phase = null;
  room.game = null;
  room.players.forEach(p => { p.role = null; });
}

module.exports = {
  START, ROUNDS, MAX_REJECTS, TRAP_EXTRA, SABOTAGE_EXTRA, MIN_PLAYERS, MAX_PLAYERS, SIDES,
  traitorCount, whisperCount, shuffle, seatOf, leaderPid, traitors, cardById,
  startGame, markReady, allReady, beginRound, propose, withdraw, castVote, voteComplete,
  resolveVote, act, actsComplete, resolveActs, nextRound, resetToLobby,
};
