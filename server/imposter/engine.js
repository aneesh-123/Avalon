// Pure Imposter game logic — NO socket/io references. Mutates room only.
const { pickWord } = require('./words');
const { shuffle } = require('./rooms');

const IMPOSTER_TEAM = new Set(['Imposter', 'Double Agent', 'Accomplice']);
const REGULAR_TEAM  = new Set(['Regular', 'Detective', 'Confused']);
// Jester is independent.

function isImposterTeam(role) { return IMPOSTER_TEAM.has(role); }

// Roles that do NOT know the exact secret word (eligible for a final guess when caught)
function isWordIgnorant(role) { return role === 'Imposter' || role === 'Double Agent'; }

/**
 * Validate a role configuration for n players.
 * Returns an error string, or null if valid.
 */
/**
 * Which side each role counts towards. The Double Agent and Accomplice are the
 * surprising ones — both are chosen from the "special roles" list but play for
 * the imposters, so enabling either grows the imposter team by one.
 */
function teamBreakdown(n, config) {
  const imposters = config.imposterCount || 1;
  const specials  = config.specialRoles || {};
  const imposterParts = [`${imposters} Imposter${imposters === 1 ? '' : 's'}`];
  if (specials.doubleAgent) imposterParts.push('Double Agent');
  if (specials.accomplice)  imposterParts.push('Accomplice');

  const imposterSide = imposters + (specials.doubleAgent ? 1 : 0) + (specials.accomplice ? 1 : 0);
  // The Jester plays for nobody, so they take a seat off the table entirely.
  const regularSide  = n - imposterSide - (specials.jester ? 1 : 0);

  const regularParts = [];
  if (specials.detective) regularParts.push('Detective');
  if (specials.confused)  regularParts.push('Confused Player');
  const plain = regularSide - regularParts.length;
  if (plain > 0) regularParts.push(`${plain} Regular${plain === 1 ? '' : 's'}`);

  return { imposters, imposterSide, regularSide, imposterParts, regularParts,
           jester: !!specials.jester };
}

function validateConfig(n, config) {
  const b = teamBreakdown(n, config);
  if (b.imposters < 1) return 'At least one Imposter is required.';
  if (b.regularSide <= b.imposterSide) {
    // Spell out the arithmetic — "the regular team must outnumber the imposter
    // team" is not actionable when the reason is a special role quietly
    // sitting on the imposter side.
    const jesterNote = b.jester ? ' The Jester takes a seat but plays for neither side.' : '';
    return `That is ${b.imposterSide} on the Imposter team (${b.imposterParts.join(' + ')}) `
         + `against ${Math.max(0, b.regularSide)} Regular player${b.regularSide === 1 ? '' : 's'}`
         + `${b.regularParts.length ? ` (${b.regularParts.join(' + ')})` : ''}.`
         + `${jesterNote} The Regular team has to outnumber the Imposter team — `
         + `add players, lower the imposter count, or turn off Double Agent / Accomplice.`;
  }
  if (b.regularSide < 1) return 'Not enough players for that many special roles.';
  return null;
}

/**
 * Assign roles + secret word. Sets room.secret and player.role / player.info.
 */
function assignRoles(room) {
  const config = room.config;

  // Secret word: custom (host-entered) or picked from the bank
  if (config.customWord) {
    room.secret = {
      category: config.customCategory || 'Custom',
      word:     config.customWord,
      related:  config.customRelated || null,
      hint:     config.customHint || config.customCategory || 'Custom',
    };
  } else {
    room.secret = pickWord(config.categories, config.customWords);
  }

  // Build the role deck
  const specials = config.specialRoles || {};
  const deck = [];
  for (let i = 0; i < config.imposterCount; i++) deck.push('Imposter');
  if (specials.doubleAgent) deck.push('Double Agent');
  if (specials.accomplice)  deck.push('Accomplice');
  if (specials.jester)      deck.push('Jester');
  if (specials.detective)   deck.push('Detective');
  if (specials.confused)    deck.push('Confused');
  while (deck.length < room.players.length) deck.push('Regular');

  const shuffled = shuffle(deck);
  room.players.forEach((p, i) => { p.role = shuffled[i]; });
}

// What the Imposter (or Double Agent) is told, per the hint setting
function imposterHint(room) {
  const s = room.secret;
  switch (room.config.hintLevel) {
    case 'none':         return null;
    case 'category':     return `Category: ${s.category}`;
    case 'vague':        return `Category: ${s.category} — Hint: ${s.hint}`;
    case 'related':      return `Category: ${s.category} — Related word: ${s.related || s.hint}`;
    case 'first-letter': return `Category: ${s.category} — The word starts with "${s.word[0].toUpperCase()}"`;
    case 'letter-count': return `Category: ${s.category} — The word has ${s.word.replace(/ /g, '').length} letters`;
    default:             return `Category: ${s.category}`;
  }
}

/**
 * Build the private card for one player. This is the ONLY place role
 * knowledge is decided; everything here goes to that player's socket only.
 *
 * The Confused player is deliberately lied to: their card says "Regular"
 * and shows the related word — they must not know they're confused.
 */
function buildPrivateInfo(room, player) {
  const s = room.secret;
  const showCategory = room.config.categoryVisible !== false;
  const imposterNames = room.players
    .filter(p => p.role === 'Imposter' && p.id !== player.id)
    .map(p => p.name);

  switch (player.role) {
    case 'Regular':
      return { displayRole: 'Regular Player', team: 'regular', word: s.word,
               category: showCategory ? s.category : null, extra: null };
    case 'Confused':
      return { displayRole: 'Regular Player', team: 'regular', word: s.related || s.word,
               category: showCategory ? s.category : null, extra: null };
    case 'Detective': {
      const confirmable = room.players.filter(p => p.id !== player.id && p.role === 'Regular');
      const confirmed = confirmable.length
        ? confirmable[Math.floor(Math.random() * confirmable.length)].name
        : null;
      return { displayRole: 'Detective', team: 'regular', word: s.word,
               category: showCategory ? s.category : null,
               extra: confirmed ? `You know for certain: ${confirmed} is a Regular Player.`
                                : 'No extra intel this round.' };
    }
    case 'Jester':
      return { displayRole: 'Jester', team: 'jester', word: s.word,
               category: showCategory ? s.category : null,
               extra: 'You win ONLY if the group votes YOU out. Act suspicious — but not too obvious.' };
    // `teammates` is the same information as the prose above, but structured so
    // the client can keep a live panel in step with who has since been caught.
    // The role card is dealt once at game start, so on its own it goes stale
    // the moment a teammate is voted out.
    case 'Accomplice':
      return { displayRole: 'Accomplice', team: 'imposter', word: s.word,
               category: showCategory ? s.category : null,
               // The Accomplice always learns who to help — that is the role.
               teammates: imposterNames,
               extra: imposterNames.length
                 ? `You know the word. Secretly help the Imposter${imposterNames.length > 1 ? 's' : ''}: ${imposterNames.join(', ')}.`
                 : 'You know the word. Secretly help the Imposter team.' };
    case 'Double Agent': {
      const partial = s.related ? `Your partial info: "${s.related}"` : `Your partial info: "${s.hint}"`;
      const knows = room.config.impostersKnowEachOther && imposterNames.length
        ? ` Imposter${imposterNames.length > 1 ? 's' : ''}: ${imposterNames.join(', ')}.` : '';
      return { displayRole: 'Double Agent', team: 'imposter', word: null,
               category: showCategory ? s.category : null,
               teammates: room.config.impostersKnowEachOther ? imposterNames : [],
               extra: `You do NOT know the exact word. ${partial}.${knows}` };
    }
    case 'Imposter': {
      const hint = imposterHint(room);
      const knows = room.config.impostersKnowEachOther && imposterNames.length
        ? ` Fellow Imposter${imposterNames.length > 1 ? 's' : ''}: ${imposterNames.join(', ')}.` : '';
      return { displayRole: 'Imposter', team: 'imposter', word: null,
               category: showCategory ? s.category : null,
               teammates: room.config.impostersKnowEachOther ? imposterNames : [],
               extra: `${hint ? hint + '. ' : ''}Blend in — listen to the clues and act like you know the word.${knows}` };
    }
    default:
      return { displayRole: player.role, team: 'regular', word: s.word, category: s.category, extra: null };
  }
}

// ── Active-player helpers ─────────────────────────────────────────────────
// Elimination is by id: a player stays in room.players forever (they keep
// their socket, their card, and the final reveal) but drops out of clueing,
// voting, and every count that decides the game.

function isEliminated(room, id) { return (room.eliminated || []).includes(id); }
function activePlayers(room)    { return room.players.filter(p => !isEliminated(room, p.id)); }
function activeImposters(room)  { return activePlayers(room).filter(p => isImposterTeam(p.role)); }
// The Jester is on nobody's side, so they count towards neither total when
// deciding whether the imposters have taken over.
function activeCrew(room) {
  return activePlayers(room).filter(p => !isImposterTeam(p.role) && p.role !== 'Jester');
}

function beginGame(room) {
  room.state = 'playing';
  room.phase = 'clue';
  room.eliminated = [];       // player ids, in elimination order
  room.eliminationLog = [];   // [{ id, name, role, wasImposter, round, guess, guessCorrect }]
  room.guessUsed = [];        // ids of imposters who have spent their one guess
  room.round = 1;             // elimination round, distinct from clueRound
  room.clueOrder = shuffle(room.players.map(p => p.id));
  room.clueIndex = 0;
  room.clueRound = 1;
  room.clues = [];           // [{ playerId, name, text, round }]
  room.votes = {};           // voterId -> targetId
  room.voteRound = 1;
  room.voteCandidates = null; // limited candidate ids on a revote, else null
  room.voteHistory = [];      // [{ round, tallies: [{name, votes, voters:[names]}] }]
  room.accusedId = null;
  room.winner = null;
  room.winReason = null;
  room.disconnected = room.disconnected || [];
}

/**
 * Win check run after every elimination and every failed guess.
 * Returns true if the game ended.
 *
 * Crew win is only declared here — a caught imposter's guess is resolved
 * before this runs, so the last imposter always gets their shot first.
 */
function checkWinConditions(room) {
  const imposters = activeImposters(room).length;
  const crew = activeCrew(room).length;

  if (imposters === 0) {
    room.winner = 'regular';
    room.winReason = 'Every Imposter has been found. The Regular Players win!';
    room.phase = 'game-over';
    return true;
  }
  if (imposters >= crew) {
    room.winner = 'imposter';
    room.winReason = imposters === 1
      ? 'The last Imposter is no longer outnumbered. The Imposters win!'
      : `${imposters} Imposters against ${crew} Regular Player${crew === 1 ? '' : 's'} — the Imposters win!`;
    room.phase = 'game-over';
    return true;
  }
  return false;
}

/**
 * Send the survivors into a fresh clue round. Clues reset so the board shows
 * the current round only; who was eliminated and what they were is kept in
 * eliminationLog, which the client renders instead.
 */
function startNextRound(room) {
  room.round++;
  room.phase = 'clue';
  room.clueOrder = shuffle(activePlayers(room).map(p => p.id));
  room.clueIndex = 0;
  room.clueRound = 1;
  room.clues = [];
  room.votes = {};
  room.voteRound = 1;
  room.voteCandidates = null;
  room.accusedId = null;
}

/**
 * Eliminate a player and decide what happens next: a caught imposter who does
 * not know the word gets one private guess before anything else resolves,
 * otherwise the win conditions are checked and play continues.
 */
function eliminatePlayer(room, player) {
  room.eliminated.push(player.id);
  room.eliminationLog.push({
    id: player.id, name: player.name, role: player.role,
    wasImposter: isImposterTeam(player.role), round: room.round,
    guess: null, guessCorrect: null,
  });
  room.accusedId = player.id;

  // The Jester wins by getting themselves voted out — that ends everything.
  if (player.role === 'Jester') {
    room.winner = 'jester';
    room.winReason = `${player.name} was the Jester — and just wanted to get voted out. The Jester wins alone!`;
    room.phase = 'game-over';
    return { action: 'game-over' };
  }

  // Only imposters who do not already know the word get a guess. An Accomplice
  // is on the imposter team but knows it, so a guess would be a free win.
  if (isImposterTeam(player.role)
      && room.config.allowImposterGuess !== false
      && isWordIgnorant(player.role)
      && !room.guessUsed.includes(player.id)) {
    room.phase = 'imposter-guess';
    return { action: 'imposter-guess', accusedId: player.id };
  }

  if (checkWinConditions(room)) return { action: 'game-over' };
  startNextRound(room);
  return { action: 'next-round' };
}

/**
 * Record a clue from the player whose turn it is, and advance the turn.
 * Returns false if it wasn't their turn.
 */
function submitClue(room, playerId, text) {
  if (room.phase !== 'clue') return false;
  if (room.clueOrder[room.clueIndex] !== playerId) return false;
  const player = room.players.find(p => p.id === playerId);
  if (!player) return false;

  room.clues.push({ playerId, name: player.name, text, round: room.clueRound });
  room.clueIndex++;

  if (room.clueIndex >= room.clueOrder.length) {
    if (room.clueRound < (room.config.clueRounds || 1)) {
      room.clueRound++;
      room.clueIndex = 0;
      room.clueOrder = shuffle(activePlayers(room).map(p => p.id));
    } else {
      room.phase = 'discussion';
    }
  }
  return true;
}

/**
 * Resolve votes once everyone has voted. Handles ties with one revote,
 * then a deadlock rules in the Imposters' favor (they blended in).
 */
// A player is only ejected on a true majority — more than half the table.
// Anything less sends it to another round with a narrowed field.
function majorityNeeded(playerCount) { return Math.floor(playerCount / 2) + 1; }

/**
 * Who stays on the ballot for the next round: the top vote-getters, widened
 * to the next tier down if the top tier is a single player (a one-name ballot
 * is not a vote). `tallies` must already be sorted by votes descending.
 */
function narrowCandidates(tallies) {
  const ids = [];
  let lastVotes = null;
  for (const t of tallies) {
    if (ids.length >= 2 && t.votes !== lastVotes) break;
    ids.push(t.id);
    lastVotes = t.votes;
  }
  return ids;
}

// Rounds are capped so a permanently split table cannot hang the game. With an
// even player count two candidates can deadlock forever (3-3, 3-3, ...), so
// running out of rounds is a real outcome, not a theoretical one.
const MAX_VOTE_ROUNDS = 3;

function resolveVotes(room) {
  const tally = {};
  Object.values(room.votes).forEach(targetId => { tally[targetId] = (tally[targetId] || 0) + 1; });

  const needed = majorityNeeded(activePlayers(room).length);
  const tallies = Object.entries(tally).map(([targetId, count]) => ({
    id: targetId,
    name: room.players.find(p => p.id === targetId)?.name || '?',
    votes: count,
    voters: Object.entries(room.votes)
      .filter(([, t]) => t === targetId)
      .map(([voterId]) => room.players.find(p => p.id === voterId)?.name || '?'),
  })).sort((a, b) => b.votes - a.votes);

  // Recorded per round and shown back to players between rounds, so a table
  // that failed to agree can see exactly where the votes went.
  room.voteHistory.push({ round: room.voteRound, majorityNeeded: needed, tallies });

  const max = tallies.length ? tallies[0].votes : 0;
  const leaders = tallies.filter(t => t.votes === max).map(t => t.id);

  // No majority on a single player — go again with a shorter ballot.
  if (leaders.length !== 1 || max < needed) {
    if (room.voteRound < MAX_VOTE_ROUNDS) {
      room.voteRound++;
      room.voteCandidates = narrowCandidates(tallies);
      room.votes = {};
      return { action: 'revote', candidates: room.voteCandidates };
    }
    room.winner = 'imposter';
    room.winReason = `The group never reached a majority after ${MAX_VOTE_ROUNDS} votes — the Imposters blended in.`;
    room.phase = 'game-over';
    return { action: 'game-over' };
  }

  // A majority named someone — they are out. Whether that ends the game is
  // eliminatePlayer's call, not this one: with several imposters in play,
  // catching one is just a round going the crew's way.
  return eliminatePlayer(room, room.players.find(p => p.id === leaders[0]));
}

/**
 * The caught imposter's final word guess.
 */
function resolveGuess(room, guess) {
  const accused = room.players.find(p => p.id === room.accusedId);
  const normalize = s => String(s).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const correct = normalize(guess) === normalize(room.secret.word);

  room.imposterGuess = guess;
  room.guessUsed.push(accused.id);          // one shot each, ever
  const entry = room.eliminationLog.find(e => e.id === accused.id);
  if (entry) { entry.guess = guess; entry.guessCorrect = correct; }

  // A correct guess wins it outright, no matter how many imposters are left
  // or how many have already been caught.
  if (correct) {
    room.winner = 'imposter';
    room.winReason = `${accused.name} was caught — but guessed the word "${room.secret.word}" and stole the win for the Imposters!`;
    room.phase = 'game-over';
    return;
  }

  // Wrong guess. Only now can the crew have won — this is what guarantees the
  // last imposter still gets their shot before the game is called.
  if (checkWinConditions(room)) {
    if (room.winner === 'regular') {
      room.winReason = `${accused.name} was caught and guessed "${guess}" — wrong! The word was "${room.secret.word}". Every Imposter has been found, so the Regular Players win!`;
    }
    return;
  }
  startNextRound(room);
}

module.exports = {
  assignRoles, buildPrivateInfo, beginGame, submitClue, resolveVotes, resolveGuess,
  validateConfig, teamBreakdown, isImposterTeam, isWordIgnorant, majorityNeeded, MAX_VOTE_ROUNDS,
  activePlayers, activeImposters, activeCrew, isEliminated, checkWinConditions, eliminatePlayer,
};
