// Clocktower game engine — the server is the Storyteller.
//
// ── How lying works ───────────────────────────────────────────────────────
// A naive false answer ("pick a random wrong number") is detectable: it can
// name a character that cannot be in play, or contradict the board's shape.
// Instead, when a player's ability malfunctions we build them a *fake board* —
// a reshuffle of the same character multiset across the same players — and then
// answer their questions completely truthfully from it.
//
// That buys three things at once:
//   • the lie is structurally indistinguishable from truth, because it is
//     produced by the same generator;
//   • it stays coherent across nights, because the fake board is cached for the
//     whole game rather than resampled;
//   • every ability gets false-info support for free, with no per-character
//     lying code.
//
// This is the seam an LLM would slot into later: it would pick *which* fake
// board is most interesting, rather than replacing any of this machinery.

const {
  CHARACTERS, BY_TEAM, COUNTS, FIRST_NIGHT, OTHER_NIGHT, isEvil, isDemon, teamOf,
} = require('./characters');
const { shuffle } = require('./rooms');

// ── Small helpers ─────────────────────────────────────────────────────────

const living  = room => room.players.filter(p => p.alive);
const byId    = (room, id) => room.players.find(p => p.id === id);
const seated  = room => [...room.players].sort((a, b) => a.seat - b.seat);
const holders = (room, c) => room.players.filter(p => p.character === c);
const withChar    = (room, c) => room.players.find(p => p.character === c);
const demonPlayer = room => room.players.find(p => isDemon(p.character));
const pick        = arr => arr[Math.floor(Math.random() * arr.length)];

function addInfo(room, playerId, text) {
  room.info[playerId] = room.info[playerId] || [];
  room.info[playerId].push({ night: room.nightNumber, text });
}

// ── Setup ─────────────────────────────────────────────────────────────────

function buildCharacterList(playerCount) {
  let [tf, out, min, dem] = COUNTS[playerCount];

  const minions = shuffle(BY_TEAM('minion')).slice(0, min);
  // The Baron swaps two Townsfolk for two Outsiders, so it has to be resolved
  // before the other pools are drawn.
  if (minions.includes('Baron')) {
    const shift = Math.min(2, tf);
    out += shift; tf -= shift;
  }
  const outsiders = shuffle(BY_TEAM('outsider')).slice(0, out);
  const townsfolk = shuffle(BY_TEAM('townsfolk')).slice(0, tf);
  const demons    = shuffle(BY_TEAM('demon')).slice(0, dem);

  return [...townsfolk, ...outsiders, ...minions, ...demons];
}

function setupGame(room) {
  const characters = shuffle(buildCharacterList(room.players.length));

  room.players.forEach((p, i) => {
    p.seat          = i;
    p.character     = characters[i];
    p.alignment     = CHARACTERS[characters[i]].alignment;
    p.alive         = true;
    p.ghostVoteUsed = false;
    p.statuses      = {};
    p.usedDayAction = false;
    // What the client is told. Only the Drunk ever differs from the truth.
    p.believedCharacter = characters[i];
  });

  const inPlay = new Set(characters);

  // The Drunk believes they are a Townsfolk who isn't in play, and is never
  // told otherwise — not at setup, not at the reveal on their own screen.
  const drunk = withChar(room, 'Drunk');
  if (drunk) {
    const candidates = BY_TEAM('townsfolk').filter(c => !inPlay.has(c));
    drunk.believedCharacter = pick(candidates) || 'Soldier';
  }

  // One good player registers as the Demon to the Fortune Teller all game.
  room.redHerring = null;
  if (inPlay.has('Fortune Teller')) {
    const good = room.players.filter(p => p.alignment === 'good');
    room.redHerring = good.length ? pick(good).id : null;
  }

  // The Recluse and Spy "might" misregister. Automating the Storyteller means
  // committing once per game rather than per question — a Recluse that pings
  // one player and not another is far more confusing than the real game is.
  room.registration = {
    recluseMisregisters: Math.random() < 0.5,
    recluseAs: pick(['Imp', 'Poisoner', 'Baron', 'Scarlet Woman', 'Spy']),
    spyMisregisters: Math.random() < 0.5,
    spyAs: pick(BY_TEAM('townsfolk').concat(BY_TEAM('outsider'))),
  };

  room.bluffs = shuffle(Object.keys(CHARACTERS).filter(c => !inPlay.has(c))).slice(0, 3);

  room.info          = {};
  room.fakeBoards    = {};
  room.nightNumber   = 0;
  room.lastExecuted  = null;
  room.executedToday = null;
  room.virginUsed    = false;
  room.winner        = null;
  room.winReason     = null;
  room.state         = 'playing';
}

// ── Boards, registration, and impairment ──────────────────────────────────

// An ability malfunctions if its holder is poisoned, or is the Drunk.
function abilityWorking(room, player) {
  if (!player) return false;
  if (player.character === 'Drunk') return false;
  return !player.statuses.poisoned;
}

const trueBoard = room =>
  Object.fromEntries(room.players.map(p => [p.id, p.character]));

// A reshuffle of the same character multiset — same shape, different truth.
// Cached per player so their wrong story stays consistent all game.
function fakeBoard(room, player) {
  if (room.fakeBoards[player.id]) return room.fakeBoards[player.id];

  const ids = room.players.map(p => p.id);

  // The pool is the real character multiset with one substitution: this player
  // holds what they *believe* they are. For everyone but the Drunk that's a
  // no-op; for the Drunk it builds the world they think they're living in —
  // one where they really are the Washerwoman and no Drunk exists.
  const pool = room.players.map(p =>
    p.id === player.id ? player.believedCharacter : p.character);

  let board;
  for (let attempt = 0; attempt < 12; attempt++) {
    const shuffled = shuffle(pool);
    board = Object.fromEntries(ids.map((id, i) => [id, shuffled[i]]));
    // A fake board identical to the truth isn't a lie; reroll it.
    if (ids.some(id => board[id] !== room.players.find(p => p.id === id).character)) break;
  }

  // Put the player's believed character in their own seat by *swapping*, never
  // overwriting — overwriting would duplicate one character and delete another,
  // producing a board whose composition is impossible and therefore detectable.
  if (board[player.id] !== player.believedCharacter) {
    const holderId = ids.find(id => board[id] === player.believedCharacter);
    if (holderId) {
      board[holderId]   = board[player.id];
      board[player.id]  = player.believedCharacter;
    }
  }

  room.fakeBoards[player.id] = board;
  return board;
}

function boardFor(room, player) {
  return abilityWorking(room, player)
    ? { map: trueBoard(room), real: true }
    : { map: fakeBoard(room, player), real: false };
}

// What a target *appears* to be. Recluse and Spy misregistration only applies
// on the real board — on a fake board the fake character is already the answer.
function registeredCharacter(room, targetId, board) {
  const c = board.map[targetId];
  if (!board.real) return c;
  const r = room.registration;
  if (c === 'Recluse' && r.recluseMisregisters) return r.recluseAs;
  if (c === 'Spy'     && r.spyMisregisters)     return r.spyAs;
  return c;
}

const registeredTeam  = (room, id, board) => teamOf(registeredCharacter(room, id, board));
const registeredEvil  = (room, id, board) => isEvil(registeredCharacter(room, id, board));
const registeredDemon = (room, id, board) => isDemon(registeredCharacter(room, id, board));

// Nearest living player each way around the circle.
function livingNeighbours(room, player) {
  const seats = seated(room);
  const n = seats.length;
  const idx = seats.findIndex(p => p.id === player.id);
  const step = dir => {
    for (let i = 1; i < n; i++) {
      const cand = seats[((idx + dir * i) % n + n) % n];
      if (cand.alive && cand.id !== player.id) return cand;
    }
    return null;
  };
  return [step(1), step(-1)].filter(Boolean);
}

// ── Night ─────────────────────────────────────────────────────────────────

function beginNight(room) {
  room.nightNumber++;
  room.phase = 'night';
  room.players.forEach(p => {
    p.statuses.protected = false;
    p.statuses.poisoned  = false;   // poison lasts one night and the next day
  });

  const order = room.nightNumber === 1 ? FIRST_NIGHT : OTHER_NIGHT;
  room.night = { order, step: 0, awaiting: null, deaths: [], ravenkeeperPending: null };
}

// Walks the night order until it needs input, or the night is over.
function advanceNight(room) {
  const n = room.night;

  while (n.step < n.order.length) {
    const entry = n.order[n.step];
    n.step++;

    if (entry === 'MINION_INFO') { giveMinionInfo(room); continue; }
    if (entry === 'DEMON_INFO')  { giveDemonInfo(room);  continue; }

    const player = withChar(room, entry);
    if (!player) continue;
    const def = CHARACTERS[entry];

    if (entry === 'Ravenkeeper') {
      if (!n.ravenkeeperPending) continue;
    } else if (!player.alive) {
      continue;
    }

    // An impaired player still gets woken and still chooses — their ability
    // simply doesn't do what they think it does.
    if (def.choice) {
      n.awaiting = { playerId: player.id, character: entry, type: def.choice, picks: def.picks || 1 };
      return 'awaiting';
    }
    if (def.info) resolveInfoAbility(room, player, def.info);
  }

  n.awaiting = null;
  return 'done';
}

function giveMinionInfo(room) {
  const minions = room.players.filter(p => teamOf(p.character) === 'minion');
  const demon   = demonPlayer(room);
  if (!demon) return;
  minions.forEach(m => {
    const others = minions.filter(o => o.id !== m.id).map(o => o.name);
    addInfo(room, m.id,
      `The Demon is ${demon.name}.` +
      (others.length ? ` Your fellow Minions: ${others.join(', ')}.` : ''));
  });
}

function giveDemonInfo(room) {
  const demon = demonPlayer(room);
  if (!demon) return;
  const minions = room.players.filter(p => teamOf(p.character) === 'minion').map(p => p.name);
  addInfo(room, demon.id,
    `Your Minions: ${minions.join(', ') || 'none'}. ` +
    `Characters NOT in play — safe to bluff as: ${room.bluffs.join(', ')}.`);
}

// Every info ability reads through boardFor(), so the same code produces both
// true and false information depending on whether the ability is working.
function resolveInfoAbility(room, player, kind, extra) {
  const board = boardFor(room, player);

  switch (kind) {
    case 'detectTownsfolk': return detectInfo(room, player, board, 'townsfolk', 'Townsfolk');
    case 'detectOutsider':  return detectInfo(room, player, board, 'outsider',  'Outsider');
    case 'detectMinion':    return detectInfo(room, player, board, 'minion',    'Minion');

    case 'chef': {
      const seats = seated(room);
      let pairs = 0;
      for (let i = 0; i < seats.length; i++) {
        const a = seats[i], b = seats[(i + 1) % seats.length];
        if (registeredEvil(room, a.id, board) && registeredEvil(room, b.id, board)) pairs++;
      }
      return addInfo(room, player.id, `Pairs of evil players sitting next to each other: ${pairs}.`);
    }

    case 'empath': {
      const n = livingNeighbours(room, player).filter(p => registeredEvil(room, p.id, board)).length;
      return addInfo(room, player.id, `Living neighbours who are evil: ${n}.`);
    }

    case 'undertaker': {
      if (!room.lastExecuted) return;
      const c = registeredCharacter(room, room.lastExecuted.id, board);
      return addInfo(room, player.id,
        `${room.lastExecuted.name} was executed yesterday. They were the ${c}.`);
    }

    case 'ravenkeeper': {
      const t = byId(room, extra);
      if (!t) return;
      return addInfo(room, player.id, `${t.name} is the ${registeredCharacter(room, t.id, board)}.`);
    }

    case 'fortune': {
      const [a, b] = extra;
      const hit = [a, b].some(id =>
        registeredDemon(room, id, board) || (board.real && id === room.redHerring));
      const names = [a, b].map(id => byId(room, id)?.name).join(' and ');
      return addInfo(room, player.id,
        `You chose ${names}. ${hit ? 'One of them is the Demon.' : 'Neither is the Demon.'}`);
    }

    case 'spy': {
      const lines = seated(room)
        .map(p => `${p.name}: ${board.map[p.id]}${p.alive ? '' : ' (dead)'}`)
        .join(' · ');
      return addInfo(room, player.id, `The Grimoire — ${lines}`);
    }
  }
}

// Washerwoman / Librarian / Investigator share a shape: two players, one of
// whom is a named character of the given team.
function detectInfo(room, player, board, team, label) {
  const targets = room.players.filter(p =>
    p.id !== player.id && registeredTeam(room, p.id, board) === team);

  if (!targets.length) {
    return addInfo(room, player.id, `There are no ${label}s among the other players.`);
  }
  const real  = pick(targets);
  const decoy = pick(room.players.filter(p => p.id !== player.id && p.id !== real.id));
  const pairNames = shuffle([real, decoy].filter(Boolean)).map(p => p.name);
  addInfo(room, player.id,
    `${pairNames.join(' or ')} — one of them is the ${registeredCharacter(room, real.id, board)}.`);
}

// Returns true if the choice was accepted.
function applyNightChoice(room, playerId, targetIds) {
  const n = room.night;
  if (!n?.awaiting || n.awaiting.playerId !== playerId) return false;

  const ids   = Array.isArray(targetIds) ? targetIds : [targetIds];
  const actor = byId(room, playerId);
  const first = byId(room, ids[0]);
  if (!first) return false;
  if (n.awaiting.picks === 2 && (ids.length !== 2 || ids[0] === ids[1])) return false;

  switch (n.awaiting.type) {
    case 'protect':
      if (first.id === actor.id) return false;
      if (abilityWorking(room, actor)) first.statuses.protected = true;
      break;

    case 'poison':
      // The Poisoner is evil; their own ability is never impaired by the Drunk
      // or by poison, so this always lands.
      first.statuses.poisoned = true;
      break;

    case 'master':
      if (first.id === actor.id) return false;
      actor.statuses.master = abilityWorking(room, actor) ? first.id : null;
      break;

    case 'fortune':
      resolveInfoAbility(room, actor, 'fortune', ids);
      break;

    case 'kill':
      attemptDemonKill(room, first);
      break;

    case 'ravenkeeper':
      resolveInfoAbility(room, actor, 'ravenkeeper', first.id);
      n.ravenkeeperPending = null;
      break;
  }

  n.awaiting = null;
  return true;
}

function attemptDemonKill(room, target) {
  const demon = demonPlayer(room);
  if (demon && target.id === demon.id) {
    killPlayer(room, target, 'night');
    starPass(room);
    return;
  }
  // Soldier and Monk only save you if their abilities are actually working.
  if (target.character === 'Soldier' && abilityWorking(room, target)) return;
  if (target.statuses.protected) return;

  // The Mayor may bounce the kill onto someone else.
  if (target.character === 'Mayor' && abilityWorking(room, target) && Math.random() < 0.5) {
    const others = living(room).filter(p => p.id !== target.id && !isDemon(p.character));
    if (others.length) return killPlayer(room, pick(others), 'night');
  }

  killPlayer(room, target, 'night');
}

function starPass(room) {
  const minion = pick(room.players.filter(p => p.alive && teamOf(p.character) === 'minion'));
  if (!minion) return;
  minion.character = 'Imp';
  minion.believedCharacter = 'Imp';
  minion.alignment = 'evil';
  addInfo(room, minion.id, 'The Imp died by its own hand. You are now the Imp.');
}

function killPlayer(room, player, cause) {
  if (!player.alive) return;

  // The Scarlet Woman's threshold counts the Demon that is dying, so it must be
  // measured before the death lands.
  const aliveAtMomentOfDeath = living(room).length;

  player.alive = false;
  if (cause === 'night') {
    room.night.deaths.push(player.id);
    if (player.character === 'Ravenkeeper') room.night.ravenkeeperPending = player.id;
  }

  if (isDemon(player.character) && aliveAtMomentOfDeath >= 5) {
    const sw = room.players.find(p => p.alive && p.character === 'Scarlet Woman');
    if (sw) {
      sw.character = 'Imp';
      sw.believedCharacter = 'Imp';
      sw.alignment = 'evil';
      addInfo(room, sw.id, 'The Demon has died. You are now the Imp.');
    }
  }
}

// ── Day ───────────────────────────────────────────────────────────────────

function beginDay(room) {
  room.phase = 'day';
  room.executedToday = null;
  room.onTheBlock    = null;
  room.nominations   = { nominators: [], nominated: [], current: null };
  room.dayEvents     = [];
}

function nominate(room, nominatorId, nomineeId) {
  const nom = room.nominations;
  const nominator = byId(room, nominatorId);
  const nominee   = byId(room, nomineeId);
  if (!nominator?.alive)                    return 'Only living players may nominate.';
  if (!nominee)                             return 'That player is not in this game.';
  if (nom.current)                          return 'A nomination is already being voted on.';
  if (nom.nominators.includes(nominatorId)) return 'You have already nominated today.';
  if (nom.nominated.includes(nomineeId))    return 'That player has already been nominated today.';

  nom.nominators.push(nominatorId);
  nom.nominated.push(nomineeId);

  // The Virgin fires before any vote happens.
  if (nominee.character === 'Virgin' && !room.virginUsed) {
    room.virginUsed = true;
    if (abilityWorking(room, nominee)) {
      const board = { map: trueBoard(room), real: true };
      if (registeredTeam(room, nominatorId, board) === 'townsfolk') {
        killPlayer(room, nominator, 'execution');
        room.dayEvents.push(`${nominator.name} nominated the Virgin and was executed on the spot.`);
        return null;
      }
    }
  }

  nom.current = { nominatorId, nomineeId, votes: {} };
  room.phase  = 'nomination';
  return null;
}

// The Slayer's one public shot.
function slay(room, slayerId, targetId) {
  const slayer = byId(room, slayerId);
  const target = byId(room, targetId);
  if (!slayer?.alive)                    return 'Only living players may use this.';
  if (slayer.character !== 'Slayer')     return 'You are not the Slayer.';
  if (slayer.usedDayAction)              return 'You have already used your ability.';
  if (!target?.alive)                    return 'Choose a living player.';
  slayer.usedDayAction = true;

  const board = { map: trueBoard(room), real: true };
  if (abilityWorking(room, slayer) && registeredDemon(room, targetId, board)) {
    killPlayer(room, target, 'slay');
    room.dayEvents.push(`${slayer.name} claimed the Slayer and shot ${target.name} — they died.`);
  } else {
    room.dayEvents.push(`${slayer.name} claimed the Slayer and shot ${target.name} — nothing happened.`);
  }
  return null;
}

function canVote(room, player) {
  return player.alive || !player.ghostVoteUsed;
}

function castNominationVote(room, voterId, vote) {
  const cur = room.nominations?.current;
  if (!cur) return false;
  const voter = byId(room, voterId);
  if (!voter || cur.votes[voterId] !== undefined) return false;
  if (!canVote(room, voter)) return false;

  // A working Butler may only raise their hand alongside their master.
  if (voter.alive && voter.character === 'Butler' && vote === true && abilityWorking(room, voter)) {
    const master = voter.statuses.master;
    if (master && cur.votes[master] !== true) return false;
  }

  cur.votes[voterId] = vote;
  if (vote === true && !voter.alive) voter.ghostVoteUsed = true;
  return true;
}

function allVotesIn(room) {
  const cur = room.nominations.current;
  return room.players.filter(p => canVote(room, p)).every(p => cur.votes[p.id] !== undefined);
}

function resolveNomination(room) {
  const cur       = room.nominations.current;
  const yes       = Object.values(cur.votes).filter(v => v === true).length;
  const threshold = Math.ceil(living(room).length / 2);
  const nominee   = byId(room, cur.nomineeId);

  let outcome = 'not enough votes';
  if (yes >= threshold) {
    if (!room.onTheBlock || yes > room.onTheBlock.votes) {
      room.onTheBlock = { playerId: nominee.id, name: nominee.name, votes: yes };
      outcome = 'on the block';
    } else if (yes === room.onTheBlock.votes) {
      room.onTheBlock = null;
      outcome = 'tied — nobody is on the block';
    } else {
      outcome = 'not enough to replace the current nominee';
    }
  }

  const result = { nomineeName: nominee.name, yes, threshold, outcome };
  room.nominations.current = null;
  room.lastNominationResult = result;
  room.phase = 'day';
  return result;
}

function endDay(room) {
  if (room.onTheBlock) {
    const victim = byId(room, room.onTheBlock.playerId);
    if (victim?.alive) {
      // Captured before the kill so the Undertaker sees who they actually were.
      room.executedToday = { id: victim.id, name: victim.name, character: victim.character };
      room.lastExecuted  = room.executedToday;
      killPlayer(room, victim, 'execution');
    }
  } else {
    room.lastExecuted = null;
  }
  room.onTheBlock = null;
}

// ── Win conditions ────────────────────────────────────────────────────────

function checkWin(room) {
  const alive = living(room);

  if (room.executedToday?.character === 'Saint') {
    return win(room, 'evil', 'The Saint was executed.');
  }

  if (!alive.some(p => isDemon(p.character))) {
    return win(room, 'good', 'The Demon is dead.');
  }

  // The Mayor wins on a day that ends with nobody executed and three alive.
  const mayor = alive.find(p => p.character === 'Mayor');
  if (mayor && abilityWorking(room, mayor) && alive.length === 3 && !room.executedToday) {
    return win(room, 'good', 'Three players remained and nobody was executed — the Mayor wins.');
  }

  if (alive.length <= 2) {
    return win(room, 'evil', 'Only two players remain alive.');
  }

  return false;
}

function win(room, winner, reason) {
  room.winner = winner;
  room.winReason = reason;
  room.phase = 'game-over';
  return true;
}

module.exports = {
  setupGame, beginNight, advanceNight, applyNightChoice,
  beginDay, nominate, slay, castNominationVote, allVotesIn, resolveNomination,
  endDay, checkWin, canVote, living, byId, abilityWorking,
  trueBoard, fakeBoard, boardFor, registeredCharacter,
};
