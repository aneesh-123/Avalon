// Bots for The Council: computer players that fill empty seats so one person
// can try the game. A bot is an ordinary seat with `bot: true` and no socket;
// it decides from the same secrets a phone would see (its role, its allies,
// what it scouted) plus the public record, and never from anything else.
// (A traitor bot knows both traps, exactly as a traitor's phone does.)
//
// nextMove(room) returns the single next thing some bot wants to do, or null.
// The handlers play one move at a time with a short pause, so the table sees
// votes and choices land one by one, the way people's would.
const E = require('./engine');

const BOT_NAMES = ['Ada', 'Bram', 'Cleo', 'Dex', 'Esme', 'Finn', 'Greta', 'Hugo', 'Iris', 'Jules'];

// Pause before each bot move, in ms. Tests shrink it.
const timing = { min: 700, max: 1600 };

function botName(room) {
  const taken = new Set(room.players.map(p => p.name.toLowerCase()));
  const free = BOT_NAMES.find(n => !taken.has(n.toLowerCase()));
  if (free) return free;
  let i = 2;
  while (taken.has(`bot ${i}`)) i++;
  return `Bot ${i}`;
}

const isBot = p => !!p?.bot;
const other = side => (side === 'gold' ? 'people' : 'gold');
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

// What a bot believes about each player, from public evidence only: a scout
// whose report the result proved wrong is a liar; voting for a choice that
// turned out to be a trap is a little suspicious.
function suspicion(room, self) {
  const s = Object.fromEntries(room.players.map(p => [p.pid, 0]));
  room.game.history.forEach(h => {
    if (h.caught) s[h.caught] += 10;
    if (h.trapped) (h.votes[h.choice] || []).forEach(pid => { s[pid] += 1; });
  });
  delete s[self.pid];
  return s;
}

// A scout's report. Loyal bots tell the truth. A traitor lies when the lie is
// likely to steer the table into a trap without being proven.
function chooseReport(room, bot, rng) {
  const g = room.game;
  const side = E.scoutSide(room, bot.pid);
  const truth = g.traps[side] ? 'trap' : 'safe';
  if (bot.role !== 'traitor') return { side, says: truth };
  const otherTrapped = g.traps[other(side)];
  // Mine is safe and the other is a trap: call mine a trap too, so the table
  // may walk into the other one. If they pick mine instead, the lie is caught.
  if (truth === 'safe' && otherTrapped && rng() < 0.6) return { side, says: 'trap' };
  // Mine is a trap: call it safe. Bold, because it is proven if they pick it.
  if (truth === 'trap' && rng() < 0.3) return { side, says: 'safe' };
  return { side, says: truth };
}

// Which choice the bot believes is cheaper for the kingdom.
function bestGuess(room, bot, rng) {
  const g = room.game;
  const sus = suspicion(room, bot);
  const looksTrapped = side => {
    const says = g.reports[side];
    if (!says) return 0.5;
    const liar = (sus[g.scouts[side]] || 0) >= 10;
    if (bot.pid === g.scouts[side]) return g.traps[side] ? 1 : 0;
    const p = says === 'trap' ? 0.9 : 0.1;
    return liar ? 1 - p : p;
  };
  // Expected cost, plus how dangerous it is to spend from a low meter.
  const score = side => 1 + looksTrapped(side) * E.TRAP_EXTRA + (g[side] <= 2 ? 1.5 : 0) - g[side] * 0.05;
  const a = score('gold'), b = score('people');
  if (Math.abs(a - b) < 0.01) return pick(E.SIDES, rng);
  return a < b ? 'gold' : 'people';
}

function chooseVote(room, bot, rng) {
  const g = room.game;
  if (bot.role === 'traitor') {
    const trapped = E.SIDES.filter(s => g.traps[s]);
    // Push for the trap now and then; otherwise blend in with the table.
    if (trapped.length === 1 && rng() < 0.45) return trapped[0];
    if (trapped.length === 2) return g.gold < g.people ? 'gold' : 'people';
  }
  const guess = bestGuess(room, bot, rng);
  return rng() < 0.9 ? guess : other(guess);
}

function chooseAccusation(room, bot, rng) {
  const sus = suspicion(room, bot);
  let pool = Object.keys(sus);
  if (bot.role === 'traitor') pool = pool.filter(pid => E.seatOf(room, pid)?.role !== 'traitor');
  const top = Math.max(...pool.map(pid => sus[pid]));
  return pick(pool.filter(pid => sus[pid] === top), rng);
}

function nextMove(room, rng = Math.random) {
  if (room.state !== 'playing' || !room.game) return null;
  const g = room.game;
  const bots = room.players.filter(isBot);
  if (!bots.length) return null;

  if (room.phase === 'roles') {
    const b = bots.find(p => !g.ready.includes(p.pid));
    return b ? { type: 'ready', pid: b.pid } : null;
  }
  if (room.phase === 'scout') {
    const b = bots.find(p => E.isScout(room, p.pid) && !g.reports[E.scoutSide(room, p.pid)]);
    return b ? { type: 'report', pid: b.pid, ...chooseReport(room, b, rng) } : null;
  }
  if (room.phase === 'vote') {
    const b = bots.find(p => !(p.pid in g.votes));
    return b ? { type: 'vote', pid: b.pid, choice: chooseVote(room, b, rng) } : null;
  }
  if (room.phase === 'accuse') {
    const b = bots.find(p => !(p.pid in g.accusations));
    return b ? { type: 'accuse', pid: b.pid, target: chooseAccusation(room, b, rng) } : null;
  }
  // On the result screen bots wait: a person taps "Next round" when ready.
  return null;
}

// Apply a move through the engine. Returns true when the room changed.
function apply(room, move) {
  switch (move.type) {
    case 'ready':  return E.markReady(room, move.pid);
    case 'report': return E.report(room, move.pid, move.side, move.says);
    case 'vote':   return E.castVote(room, move.pid, move.choice);
    case 'accuse': return E.accuse(room, move.pid, move.target);
    default:       return false;
  }
}

const delay = (rng = Math.random) => timing.min + Math.floor(rng() * Math.max(0, timing.max - timing.min));

module.exports = { nextMove, apply, botName, isBot, delay, timing, BOT_NAMES };
