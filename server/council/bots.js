// Bots for The Council: computer players that fill empty seats so one person
// can try the game. A bot is an ordinary seat with `bot: true` and no socket;
// it decides from the same secrets a phone would see (its role, its allies,
// its whisper) and never from anything else in the room.
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

function choosePlan(room, bot, rng) {
  const g = room.game;
  const heard = g.whispers.includes(bot.pid) ? g.trap : null;
  const traitor = bot.role === 'traitor';
  let option;
  if (heard) option = traitor && rng() < 0.6 ? heard : other(heard);
  else if (g.gold !== g.people) option = g.gold > g.people ? 'gold' : 'people';
  else option = pick(E.SIDES, rng);
  // A loyal bot never spends the last point of a side if it can help it.
  if (!traitor && g[option] <= 1 && g[other(option)] > 1) option = other(option);

  const others = room.players.filter(p => p.pid !== bot.pid);
  const allies = others.filter(p => p.role === 'traitor');
  const partner = traitor && allies.length && rng() < 0.5 ? pick(allies, rng) : pick(others, rng);
  return { option, partner: partner.pid };
}

function chooseVote(room, bot, rng) {
  const g = room.game;
  const p = g.proposal;
  if (p.leader === bot.pid || p.partner === bot.pid) return true;
  if (g.rejects >= E.MAX_REJECTS - 1) return true;             // don't panic the kingdom
  if (bot.role === 'traitor') {
    const onPlan = [p.leader, p.partner].some(pid => E.seatOf(room, pid)?.role === 'traitor');
    return onPlan || rng() < 0.5;
  }
  if (g.whispers.includes(bot.pid) && p.option === g.trap) return false;
  return rng() < 0.8;
}

function chooseAct(room, bot, rng) {
  if (bot.role !== 'traitor') return 'help';
  const p = room.game.proposal;
  // Two traitors on one plan: only the leader sabotages, so the count says 1.
  const mate = E.seatOf(room, p.leader === bot.pid ? p.partner : p.leader);
  if (mate?.role === 'traitor' && p.partner === bot.pid) return 'help';
  return rng() < 0.75 ? 'sabotage' : 'help';
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
  if (room.phase === 'propose') {
    const leader = E.seatOf(room, E.leaderPid(room));
    return isBot(leader) ? { type: 'propose', pid: leader.pid, ...choosePlan(room, leader, rng) } : null;
  }
  if (room.phase === 'vote') {
    const b = bots.find(p => !(p.pid in g.votes));
    return b ? { type: 'vote', pid: b.pid, approve: chooseVote(room, b, rng) } : null;
  }
  if (room.phase === 'act') {
    const b = bots.find(p => (p.pid === g.proposal.leader || p.pid === g.proposal.partner) && !(p.pid in g.actions));
    return b ? { type: 'act', pid: b.pid, choice: chooseAct(room, b, rng) } : null;
  }
  // On the result screen bots wait: a person taps "Next round" when ready,
  // unless nobody at the table is a person.
  return null;
}

// Apply a move through the engine. Returns true when the room changed.
function apply(room, move) {
  switch (move.type) {
    case 'ready':   return E.markReady(room, move.pid);
    case 'propose': return !!E.propose(room, move.pid, { option: move.option, partner: move.partner }).ok;
    case 'vote':    return E.castVote(room, move.pid, move.approve);
    case 'act':     return E.act(room, move.pid, move.choice);
    default:        return false;
  }
}

const delay = (rng = Math.random) => timing.min + Math.floor(rng() * Math.max(0, timing.max - timing.min));

module.exports = { nextMove, apply, botName, isBot, delay, timing, BOT_NAMES };
