// Rules engine for the Secret Hitler game mode, as published by its authors
// (secrethitler.com, CC BY-NC-SA 4.0). Pure functions over a JSON-friendly
// room object, so a room survives a trip through the database unchanged.
//
// Internal ids are neutral ('liberal', 'fascist', 'hitler', 'president',
// 'chancellor'); every word a player reads comes from public/secret-theme.js,
// so the game can be renamed and rethemed without touching the rules.
//
// Players are addressed by seat: their index in room.players. Seats never
// move once a game starts (nobody is removed mid-game), and the seat order is
// the table order the presidency rotates through.

const MIN_PLAYERS = 5;
const MAX_PLAYERS = 10;

// Liberals / Fascists (not counting Hitler), by player count.
const TEAMS = {
  5: [3, 1], 6: [4, 1], 7: [4, 2], 8: [5, 2], 9: [5, 3], 10: [6, 3],
};

// Presidential power unlocked by each Fascist policy, index 0 = first policy.
// The sixth Fascist policy ends the game, so it has no power.
function powerTrack(n) {
  if (n <= 6) return [null, null, 'peek', 'execute', 'execute'];
  if (n <= 8) return [null, 'investigate', 'special', 'execute', 'execute'];
  return ['investigate', 'investigate', 'special', 'execute', 'execute'];
}

const LIBERAL_TO_WIN = 5;
const FASCIST_TO_WIN = 6;
const HITLER_ZONE = 3;       // Fascist policies before electing Hitler wins
const VETO_AT = 5;           // Fascist policies that unlock the veto
const CHAOS_AT = 3;          // failed governments in a row before the top policy is forced
const LOG_LIMIT = 60;

function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const partyOf = role => (role === 'liberal' ? 'liberal' : 'fascist');
const alive = (room, seat) => !!room.players[seat] && room.players[seat].alive !== false;
const aliveSeats = room => room.players.map((_, i) => i).filter(i => alive(room, i));

function log(g, entry) {
  g.log.push(entry);
  if (g.log.length > LOG_LIMIT) g.log.splice(0, g.log.length - LOG_LIMIT);
}

// ── Setup ────────────────────────────────────────────────────────────────

function startGame(room, rng = Math.random) {
  const n = room.players.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) return false;
  const [libs, fascists] = TEAMS[n];
  const roles = shuffle([
    ...Array(libs).fill('liberal'),
    ...Array(fascists).fill('fascist'),
    'hitler',
  ], rng);
  room.players.forEach((p, i) => { p.role = roles[i]; p.alive = true; });

  const first = Math.floor(rng() * n);
  room.state = 'playing';
  room.g = {
    phase: 'reveal',
    ready: [],
    rotation: first,          // the seat the regular rotation last reached
    president: first,
    chancellor: null,         // the nominee during a vote, then the chancellor
    specialNext: null,        // seat named by a Special Election
    lastElected: null,        // { president, chancellor } — the term limits
    votes: {},
    lastVote: null,
    liberal: 0,
    fascist: 0,
    tracker: 0,
    deck: shuffle([...Array(6).fill('liberal'), ...Array(11).fill('fascist')], rng),
    discard: [],
    hand: [],
    vetoDenied: false,
    power: null,
    investigated: [],         // seats already investigated (once each)
    investigations: [],       // { by, target, party } — each shown only to `by`
    lastEvent: null,
    winner: null,
    winReason: null,
    round: 1,
    log: [],
  };
  return true;
}

// ── Reveal ───────────────────────────────────────────────────────────────

function markReady(room, seat) {
  const g = room.g;
  if (!g || g.phase !== 'reveal') return false;
  if (!g.ready.includes(seat)) g.ready.push(seat);
  if (g.ready.length >= room.players.length) beginPlay(room);
  return true;
}

// The table can start without a phone that never opened its role.
function beginPlay(room) {
  const g = room.g;
  if (!g || g.phase !== 'reveal') return false;
  g.phase = 'nominate';
  log(g, { t: 'round', round: g.round, president: g.president });
  return true;
}

// ── Nomination & election ────────────────────────────────────────────────

function eligibleChancellors(room) {
  const g = room.g;
  const count = aliveSeats(room).length;
  return aliveSeats(room).filter(s => {
    if (s === g.president) return false;
    if (!g.lastElected) return true;
    if (s === g.lastElected.chancellor) return false;
    // With five or fewer players left, only the last Chancellor is barred.
    if (count > 5 && s === g.lastElected.president) return false;
    return true;
  });
}

function nominate(room, seat, target) {
  const g = room.g;
  if (!g || g.phase !== 'nominate' || seat !== g.president) return false;
  if (!Number.isInteger(target) || !eligibleChancellors(room).includes(target)) return false;
  g.chancellor = target;
  g.votes = {};
  g.phase = 'vote';
  g.lastEvent = null;
  return true;
}

function castVote(room, seat, ja) {
  const g = room.g;
  if (!g || g.phase !== 'vote' || !alive(room, seat)) return false;
  if (typeof ja !== 'boolean') return false;
  g.votes[seat] = ja;
  if (aliveSeats(room).every(s => typeof g.votes[s] === 'boolean')) resolveElection(room);
  return true;
}

function resolveElection(room) {
  const g = room.g;
  const seats = aliveSeats(room);
  const ja = seats.filter(s => g.votes[s] === true).length;
  const passed = ja > seats.length / 2;
  g.lastVote = {
    president: g.president, chancellor: g.chancellor, passed,
    votes: seats.map(s => ({ seat: s, ja: g.votes[s] })),
  };
  log(g, { t: 'election', president: g.president, chancellor: g.chancellor, passed, ja, nein: seats.length - ja });
  g.votes = {};

  if (!passed) {
    g.lastEvent = { t: 'failed', tracker: g.tracker + 1 };
    failGovernment(room);
    return;
  }

  g.lastElected = { president: g.president, chancellor: g.chancellor };
  if (g.fascist >= HITLER_ZONE && room.players[g.chancellor].role === 'hitler') {
    endGame(room, 'fascist', 'hitler-elected');
    return;
  }
  g.lastEvent = { t: 'elected' };
  refillDeck(room);
  g.hand = g.deck.splice(0, 3);
  g.vetoDenied = false;
  g.phase = 'president-discard';
}

// A failed vote or an accepted veto: the tracker moves, and on the third the
// top policy is enacted with no power, and term limits are forgotten.
function failGovernment(room) {
  const g = room.g;
  g.tracker += 1;
  if (g.tracker >= CHAOS_AT) {
    refillDeck(room);
    const policy = g.deck.shift();
    g.lastElected = null;
    log(g, { t: 'chaos', policy });
    enact(room, policy, { chaos: true });
    return;
  }
  nextPresident(room);
}

// ── Legislative session ──────────────────────────────────────────────────

function presidentDiscard(room, seat, index) {
  const g = room.g;
  if (!g || g.phase !== 'president-discard' || seat !== g.president) return false;
  if (!Number.isInteger(index) || index < 0 || index >= g.hand.length) return false;
  g.discard.push(...g.hand.splice(index, 1));
  g.phase = 'chancellor-enact';
  return true;
}

function chancellorEnact(room, seat, index) {
  const g = room.g;
  if (!g || g.phase !== 'chancellor-enact' || seat !== g.chancellor) return false;
  if (!Number.isInteger(index) || index < 0 || index >= g.hand.length) return false;
  const [policy] = g.hand.splice(index, 1);
  g.discard.push(...g.hand);
  g.hand = [];
  log(g, { t: 'enact', policy, president: g.president, chancellor: g.chancellor });
  enact(room, policy, { chaos: false });
  return true;
}

const vetoUnlocked = room => !!room.g && room.g.fascist >= VETO_AT;

function proposeVeto(room, seat) {
  const g = room.g;
  if (!g || g.phase !== 'chancellor-enact' || seat !== g.chancellor) return false;
  if (!vetoUnlocked(room) || g.vetoDenied) return false;
  g.phase = 'veto';
  return true;
}

function answerVeto(room, seat, accept) {
  const g = room.g;
  if (!g || g.phase !== 'veto' || seat !== g.president) return false;
  if (typeof accept !== 'boolean') return false;
  if (!accept) {
    g.vetoDenied = true;
    g.phase = 'chancellor-enact';
    log(g, { t: 'veto-denied', president: g.president });
    return true;
  }
  g.discard.push(...g.hand);
  g.hand = [];
  log(g, { t: 'veto', president: g.president, chancellor: g.chancellor });
  g.lastEvent = { t: 'veto', tracker: g.tracker + 1 };
  failGovernment(room);
  return true;
}

function enact(room, policy, { chaos }) {
  const g = room.g;
  g.tracker = 0;
  if (policy === 'liberal') g.liberal += 1; else g.fascist += 1;
  g.lastEvent = { t: 'enacted', policy, chaos };
  refillDeck(room);

  if (g.liberal >= LIBERAL_TO_WIN) { endGame(room, 'liberal', 'policies'); return; }
  if (g.fascist >= FASCIST_TO_WIN) { endGame(room, 'fascist', 'policies'); return; }

  const power = policy === 'fascist' && !chaos ? powerTrack(room.players.length)[g.fascist - 1] : null;
  if (power) {
    g.power = { type: power, target: null, result: null, cards: null };
    if (power === 'peek') g.power.cards = g.deck.slice(0, 3);
    g.phase = 'power';
    return;
  }
  nextPresident(room);
}

// At the end of any session, fewer than three cards left means the discard
// pile is shuffled back in, so the next draw and any peek see three.
function refillDeck(room, rng = Math.random) {
  const g = room.g;
  if (g.deck.length >= 3) return;
  g.deck = shuffle([...g.deck, ...g.discard], rng);
  g.discard = [];
  log(g, { t: 'reshuffle' });
}

// ── Presidential powers ──────────────────────────────────────────────────

function powerTargets(room) {
  const g = room.g;
  if (!g?.power) return [];
  if (g.power.type === 'peek') return [];
  return aliveSeats(room).filter(s => s !== g.president
    && !(g.power.type === 'investigate' && g.investigated.includes(s)));
}

function usePower(room, seat, target) {
  const g = room.g;
  if (!g || g.phase !== 'power' || seat !== g.president || !g.power) return false;
  if (g.power.target !== null || g.power.type === 'peek') return false;
  if (!Number.isInteger(target) || !powerTargets(room).includes(target)) return false;
  const type = g.power.type;
  g.power.target = target;
  log(g, { t: 'power', power: type, president: g.president, target });

  if (type === 'investigate') {
    const party = partyOf(room.players[target].role);
    g.investigated.push(target);
    g.investigations.push({ by: seat, target, party });
    g.power.result = party;
    return true;                 // the President reads it, then taps Done
  }
  if (type === 'special') {
    g.specialNext = target;
    finishPower(room);
    return true;
  }
  if (type === 'execute') {
    room.players[target].alive = false;
    g.lastEvent = { t: 'executed', target };
    if (room.players[target].role === 'hitler') { endGame(room, 'liberal', 'hitler-executed'); return true; }
    finishPower(room);
    return true;
  }
  return false;
}

// Peek and Investigate show the President something; they tap Done to move on.
function powerDone(room, seat) {
  const g = room.g;
  if (!g || g.phase !== 'power' || seat !== g.president || !g.power) return false;
  if (g.power.type === 'peek') { log(g, { t: 'power', power: 'peek', president: g.president }); finishPower(room); return true; }
  if (g.power.type === 'investigate' && g.power.target !== null) { finishPower(room); return true; }
  return false;
}

function finishPower(room) {
  room.g.power = null;
  nextPresident(room);
}

// ── Rotation ─────────────────────────────────────────────────────────────

function nextAliveAfter(room, seat) {
  const n = room.players.length;
  for (let k = 1; k <= n; k++) {
    const s = (seat + k) % n;
    if (alive(room, s)) return s;
  }
  return seat;
}

function nextPresident(room) {
  const g = room.g;
  if (g.specialNext !== null && alive(room, g.specialNext)) {
    // The rotation pointer stays on the President who called the Special
    // Election, so the seat to their left is next after this one term.
    g.president = g.specialNext;
  } else {
    g.rotation = nextAliveAfter(room, g.rotation);
    g.president = g.rotation;
  }
  g.specialNext = null;
  g.chancellor = null;
  g.hand = [];
  g.vetoDenied = false;
  g.round += 1;
  g.phase = 'nominate';
  log(g, { t: 'round', round: g.round, president: g.president });
}

// ── End ──────────────────────────────────────────────────────────────────

function endGame(room, winner, reason) {
  const g = room.g;
  g.phase = 'over';
  g.winner = winner;
  g.winReason = reason;
  g.power = null;
  g.hand = [];
  log(g, { t: 'over', winner, reason });
}

function resetToLobby(room) {
  room.state = 'lobby';
  delete room.g;
  room.players.forEach(p => { delete p.role; delete p.alive; });
}

// Who each role sees at the start. Fascists know each other and Hitler;
// Hitler knows the Fascists only in a five or six player game.
function knownTo(room, seat) {
  const me = room.players[seat];
  if (!me?.role || me.role === 'liberal') return [];
  const n = room.players.length;
  if (me.role === 'hitler' && n > 6) return [];
  return room.players
    .map((p, i) => ({ seat: i, role: p.role }))
    .filter(x => x.seat !== seat && x.role !== 'liberal');
}

module.exports = {
  MIN_PLAYERS, MAX_PLAYERS, TEAMS, LIBERAL_TO_WIN, FASCIST_TO_WIN, HITLER_ZONE, VETO_AT, CHAOS_AT,
  shuffle, partyOf, alive, aliveSeats, powerTrack,
  startGame, markReady, beginPlay, eligibleChancellors, nominate, castVote,
  presidentDiscard, chancellorEnact, vetoUnlocked, proposeVeto, answerVeto,
  powerTargets, usePower, powerDone, nextPresident, refillDeck, knownTo, resetToLobby,
};
