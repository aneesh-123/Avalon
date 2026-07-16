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
function validateConfig(n, config) {
  const imposters = config.imposterCount || 1;
  const specials  = config.specialRoles || {};
  const imposterSide = imposters + (specials.doubleAgent ? 1 : 0) + (specials.accomplice ? 1 : 0);
  const regularSide  = n - imposterSide - (specials.jester ? 1 : 0);
  if (imposters < 1) return 'At least one Imposter is required.';
  if (regularSide <= imposterSide) return 'The Regular team must outnumber the Imposter team.';
  if (regularSide < 1) return 'Not enough players for that many special roles.';
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
    room.secret = pickWord(config.categories);
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
    case 'Accomplice':
      return { displayRole: 'Accomplice', team: 'imposter', word: s.word,
               category: showCategory ? s.category : null,
               extra: imposterNames.length
                 ? `You know the word. Secretly help the Imposter${imposterNames.length > 1 ? 's' : ''}: ${imposterNames.join(', ')}.`
                 : 'You know the word. Secretly help the Imposter team.' };
    case 'Double Agent': {
      const partial = s.related ? `Your partial info: "${s.related}"` : `Your partial info: "${s.hint}"`;
      const knows = room.config.impostersKnowEachOther && imposterNames.length
        ? ` Imposter${imposterNames.length > 1 ? 's' : ''}: ${imposterNames.join(', ')}.` : '';
      return { displayRole: 'Double Agent', team: 'imposter', word: null,
               category: showCategory ? s.category : null,
               extra: `You do NOT know the exact word. ${partial}.${knows}` };
    }
    case 'Imposter': {
      const hint = imposterHint(room);
      const knows = room.config.impostersKnowEachOther && imposterNames.length
        ? ` Fellow Imposter${imposterNames.length > 1 ? 's' : ''}: ${imposterNames.join(', ')}.` : '';
      return { displayRole: 'Imposter', team: 'imposter', word: null,
               category: showCategory ? s.category : null,
               extra: `${hint ? hint + '. ' : ''}Blend in — listen to the clues and act like you know the word.${knows}` };
    }
    default:
      return { displayRole: player.role, team: 'regular', word: s.word, category: s.category, extra: null };
  }
}

function beginGame(room) {
  room.state = 'playing';
  room.phase = 'clue';
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
      room.clueOrder = shuffle(room.players.map(p => p.id));
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
function resolveVotes(room) {
  const tally = {};
  Object.values(room.votes).forEach(targetId => { tally[targetId] = (tally[targetId] || 0) + 1; });

  // Record this round for the game-over breakdown
  room.voteHistory.push({
    round: room.voteRound,
    tallies: Object.entries(tally).map(([targetId, count]) => ({
      name: room.players.find(p => p.id === targetId)?.name || '?',
      votes: count,
      voters: Object.entries(room.votes)
        .filter(([, t]) => t === targetId)
        .map(([voterId]) => room.players.find(p => p.id === voterId)?.name || '?'),
    })).sort((a, b) => b.votes - a.votes),
  });

  const max = Math.max(...Object.values(tally));
  const leaders = Object.keys(tally).filter(id => tally[id] === max);

  if (leaders.length > 1) {
    if (room.voteRound === 1) {
      room.voteRound = 2;
      room.voteCandidates = leaders;
      room.votes = {};
      return { action: 'revote', candidates: leaders };
    }
    room.winner = 'imposter';
    room.winReason = 'The vote was deadlocked twice — the Imposters blended in.';
    room.phase = 'game-over';
    return { action: 'game-over' };
  }

  const accused = room.players.find(p => p.id === leaders[0]);
  room.accusedId = accused.id;

  if (accused.role === 'Jester') {
    room.winner = 'jester';
    room.winReason = `${accused.name} was the Jester — and just wanted to get voted out. The Jester wins alone!`;
    room.phase = 'game-over';
    return { action: 'game-over' };
  }

  if (isImposterTeam(accused.role)) {
    if (room.config.allowImposterGuess !== false && isWordIgnorant(accused.role)) {
      room.phase = 'imposter-guess';
      return { action: 'imposter-guess', accusedId: accused.id };
    }
    room.winner = 'regular';
    room.winReason = `${accused.name} (${accused.role}) was caught! The Regular Players win.`;
    room.phase = 'game-over';
    return { action: 'game-over' };
  }

  // A regular-team player was voted out
  room.winner = 'imposter';
  room.winReason = `${accused.name} was ${accused.role === 'Confused' ? 'the Confused Player — on the Regular team all along' : 'a Regular Player'}. The Imposters win!`;
  room.phase = 'game-over';
  return { action: 'game-over' };
}

/**
 * The caught imposter's final word guess.
 */
function resolveGuess(room, guess) {
  const accused = room.players.find(p => p.id === room.accusedId);
  const normalize = s => String(s).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const correct = normalize(guess) === normalize(room.secret.word);
  room.imposterGuess = guess;
  if (correct) {
    room.winner = 'imposter';
    room.winReason = `${accused.name} was caught — but guessed the word "${room.secret.word}" and stole the win!`;
  } else {
    room.winner = 'regular';
    room.winReason = `${accused.name} was caught and guessed "${guess}" — wrong! The word was "${room.secret.word}". Regular Players win.`;
  }
  room.phase = 'game-over';
}

module.exports = {
  assignRoles, buildPrivateInfo, beginGame, submitClue, resolveVotes, resolveGuess,
  validateConfig, isImposterTeam, isWordIgnorant,
};
