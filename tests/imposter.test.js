/**
 * Imposter engine + handler tests.
 *
 * Mirrors the Avalon suites: pure engine logic first, then the socket handlers
 * driven through mock sockets. The engine half is where the game's secrets are
 * decided — who is told the word, who is lied to — so it gets the most
 * attention. A regression there is invisible in play until someone realises the
 * Imposter knew the answer all along.
 */

const {
  assignRoles, buildPrivateInfo, beginGame, submitClue,
  resolveVotes, resolveGuess, validateConfig, isImposterTeam, isWordIgnorant,
} = require('../server/imposter/engine');
const { impRooms } = require('../server/imposter/rooms');
const { impGameState, impLobbyState } = require('../server/imposter/state');
const registerImposterHandlers = require('../server/imposter/handlers');
const { makeIo, connectSocket } = require('./helpers');

jest.mock('../server/db', () => ({
  saveRoom:   () => Promise.resolve(),
  deleteRoom: () => Promise.resolve(),
  loadRooms:  () => Promise.resolve([]),
}));

const BASE_CONFIG = {
  imposterCount: 1,
  impostersKnowEachOther: true,
  hintLevel: 'category',
  categoryVisible: true,
  clueRounds: 1,
  allowImposterGuess: true,
  specialRoles: { detective: false, confused: false, doubleAgent: false, accomplice: false, jester: false },
  categories: [],
  customWord: null, customCategory: null, customRelated: null,
};

function clearImpRooms() { Object.keys(impRooms).forEach(k => delete impRooms[k]); }

/** Build an Imposter room directly, bypassing sockets. */
function buildImpRoom(code, n = 5, configOverrides = {}) {
  const config = { ...BASE_CONFIG, ...configOverrides,
    specialRoles: { ...BASE_CONFIG.specialRoles, ...(configOverrides.specialRoles || {}) } };
  const room = {
    gameType: 'imposter', code, hostId: 's1', playerCount: n, config,
    players: Array.from({ length: n }, (_, i) => ({
      id: `s${i + 1}`, name: `Player${i + 1}`, token: `tok-${i + 1}`, ready: false, role: null,
    })),
    state: 'lobby',
  };
  impRooms[code] = room;
  return room;
}

/** Build a room already mid-game with a known secret word. */
function startedRoom(code = 'IMP', n = 5, configOverrides = {}) {
  const room = buildImpRoom(code, n, { customWord: 'Pizza', customCategory: 'Food', customRelated: 'Pasta', ...configOverrides });
  assignRoles(room);
  beginGame(room);
  return room;
}

const roleOf = (room, id) => room.players.find(p => p.id === id).role;
const playerWithRole = (room, role) => room.players.find(p => p.role === role);

beforeEach(clearImpRooms);

// ── Config validation ─────────────────────────────────────────────────────────
describe('validateConfig', () => {
  test('accepts a normal 5-player single-imposter game', () => {
    expect(validateConfig(5, { ...BASE_CONFIG })).toBeNull();
  });

  // `config.imposterCount || 1` coerces 0 to 1, so validateConfig's own
  // `imposters < 1` guard is unreachable. Nothing is exposed by that: the
  // create-room handler clamps with Math.max(1, ...) before validating. This
  // test pins the real behaviour so the coercion is not "fixed" without also
  // revisiting the guard.
  test('an imposter count of zero is coerced to one rather than rejected', () => {
    expect(validateConfig(5, { ...BASE_CONFIG, imposterCount: 0 })).toBeNull();
  });

  test('the create-room handler is what actually enforces a minimum of one', () => {
    const { io } = makeIo();
    registerImposterHandlers(io);
    const s = connectSocket(io, 'zero');
    s.trigger('imp:create-room', {
      playerCount: 5, name: 'H', token: 'z',
      config: { ...BASE_CONFIG, imposterCount: 0 },
    });

    expect(impRooms[s.last('imp:room-created').code].config.imposterCount).toBe(1);
  });

  test('rejects a config where the imposter team is not outnumbered', () => {
    expect(validateConfig(4, { ...BASE_CONFIG, imposterCount: 2 })).toMatch(/outnumber/i);
  });

  test('counts double agent and accomplice on the imposter side', () => {
    // 5 players, 1 imposter + doubleAgent + accomplice = 3 evil vs 2 regular
    const err = validateConfig(5, { ...BASE_CONFIG,
      specialRoles: { ...BASE_CONFIG.specialRoles, doubleAgent: true, accomplice: true } });
    expect(err).toMatch(/outnumber/i);
  });

  test('counts the jester as neither side but still consuming a seat', () => {
    expect(validateConfig(5, { ...BASE_CONFIG,
      specialRoles: { ...BASE_CONFIG.specialRoles, jester: true } })).toBeNull();
  });
});

// ── Role assignment ───────────────────────────────────────────────────────────
describe('assignRoles', () => {
  test('deals exactly one imposter and fills the rest with regulars', () => {
    const room = buildImpRoom('A', 5);
    assignRoles(room);

    const roles = room.players.map(p => p.role);
    expect(roles.filter(r => r === 'Imposter')).toHaveLength(1);
    expect(roles.filter(r => r === 'Regular')).toHaveLength(4);
  });

  test('deals the requested number of imposters', () => {
    const room = buildImpRoom('B', 7, { imposterCount: 2 });
    assignRoles(room);

    expect(room.players.filter(p => p.role === 'Imposter')).toHaveLength(2);
  });

  test('includes every enabled special role exactly once', () => {
    const room = buildImpRoom('C', 8, {
      specialRoles: { detective: true, confused: true, doubleAgent: true, accomplice: true, jester: true },
    });
    assignRoles(room);

    const roles = room.players.map(p => p.role);
    ['Detective', 'Confused', 'Double Agent', 'Accomplice', 'Jester', 'Imposter']
      .forEach(r => expect(roles.filter(x => x === r)).toHaveLength(1));
    expect(roles).toHaveLength(8);
  });

  test('every player gets a role and none are left null', () => {
    const room = buildImpRoom('D', 6, { imposterCount: 2 });
    assignRoles(room);

    expect(room.players.every(p => typeof p.role === 'string' && p.role.length)).toBe(true);
  });

  test('a custom word overrides the word bank', () => {
    const room = buildImpRoom('E', 5, { customWord: 'Bicycle', customCategory: 'Vehicles', customRelated: 'Scooter' });
    assignRoles(room);

    expect(room.secret).toMatchObject({ word: 'Bicycle', category: 'Vehicles', related: 'Scooter' });
  });

  test('host-added words form their own category that can be drawn from', () => {
    const room = buildImpRoom('E2', 5, {
      customWords: ['Pickleball', 'Game Night', 'Inside Joke'],
      categories: ['Your Words'],
    });
    assignRoles(room);

    expect(room.secret.category).toBe('Your Words');
    expect(['Pickleball', 'Game Night', 'Inside Joke']).toContain(room.secret.word);
  });

  test('a host-added word still gets a related word, so Confused keeps working', () => {
    const room = buildImpRoom('E3', 7, {
      customWords: ['Pickleball', 'Game Night'],
      categories: ['Your Words'],
      specialRoles: { confused: true },
    });
    assignRoles(room);

    expect(room.secret.related).toBeTruthy();
    expect(room.secret.related).not.toBe(room.secret.word);

    // The Confused player must be handed something other than the true word.
    const confused = playerWithRole(room, 'Confused');
    expect(buildPrivateInfo(room, confused).word).not.toBe(room.secret.word);
  });

  test('host words are ignored when their category is not selected', () => {
    const room = buildImpRoom('E4', 5, { customWords: ['Pickleball'], categories: ['Food'] });
    assignRoles(room);

    expect(room.secret.category).toBe('Food');
    expect(room.secret.word).not.toBe('Pickleball');
  });

  test('without a custom word it draws a real entry from the bank', () => {
    const room = buildImpRoom('F', 5, { categories: ['Food'] });
    assignRoles(room);

    expect(room.secret.category).toBe('Food');
    expect(typeof room.secret.word).toBe('string');
    expect(room.secret.word.length).toBeGreaterThan(0);
  });
});

// ── Private info: who is told what ────────────────────────────────────────────
describe('buildPrivateInfo — the secret-keeping rules', () => {
  test('a regular player is told the word', () => {
    const room = startedRoom('G');
    const p = playerWithRole(room, 'Regular');

    const info = buildPrivateInfo(room, p);

    expect(info).toMatchObject({ displayRole: 'Regular Player', team: 'regular', word: 'Pizza' });
  });

  test('the imposter is NOT told the word', () => {
    const room = startedRoom('H');
    const p = playerWithRole(room, 'Imposter');

    const info = buildPrivateInfo(room, p);

    expect(info.word).toBeNull();
    expect(info.team).toBe('imposter');
    expect(info.displayRole).toBe('Imposter');
  });

  test('the double agent is on the imposter team and does not know the word', () => {
    const room = startedRoom('I', 7, { specialRoles: { doubleAgent: true } });
    const p = playerWithRole(room, 'Double Agent');

    const info = buildPrivateInfo(room, p);

    expect(info.word).toBeNull();
    expect(info.team).toBe('imposter');
    expect(info.extra).toContain('Pasta');   // gets the related word as partial info
  });

  test('the accomplice knows the word but plays for the imposters', () => {
    const room = startedRoom('J', 7, { specialRoles: { accomplice: true } });
    const p = playerWithRole(room, 'Accomplice');

    const info = buildPrivateInfo(room, p);

    expect(info.word).toBe('Pizza');
    expect(info.team).toBe('imposter');
  });

  test('the confused player is lied to — shown as Regular with the related word', () => {
    const room = startedRoom('K', 7, { specialRoles: { confused: true } });
    const p = playerWithRole(room, 'Confused');

    const info = buildPrivateInfo(room, p);

    // They must not be able to tell they are the confused one.
    expect(info.displayRole).toBe('Regular Player');
    expect(info.team).toBe('regular');
    expect(info.word).toBe('Pasta');
  });

  test('the jester knows the word and is on nobody s team', () => {
    const room = startedRoom('L', 7, { specialRoles: { jester: true } });
    const p = playerWithRole(room, 'Jester');

    const info = buildPrivateInfo(room, p);

    expect(info.team).toBe('jester');
    expect(info.word).toBe('Pizza');
  });

  test('hiding the category strips it from every card', () => {
    const room = startedRoom('M', 5, { categoryVisible: false });

    room.players.forEach(p => expect(buildPrivateInfo(room, p).category).toBeNull());
  });

  test.each([
    ['none',         null],
    ['category',     /Category: Food/],
    ['vague',        /Hint:/],
    ['related',      /Pasta/],
    ['first-letter', /starts with "P"/],
    ['letter-count', /5 letters/],
  ])('hintLevel %s shapes what the imposter is told', (hintLevel, expected) => {
    const room = startedRoom('N' + hintLevel, 5, { hintLevel });
    const info = buildPrivateInfo(room, playerWithRole(room, 'Imposter'));

    if (expected === null) expect(info.extra).not.toMatch(/Category:/);
    else expect(info.extra).toMatch(expected);
  });
});

// ── Clue phase ────────────────────────────────────────────────────────────────
describe('clue phase', () => {
  test('beginGame seats everyone in a clue order', () => {
    const room = startedRoom('O');

    expect(room.phase).toBe('clue');
    expect(room.clueOrder).toHaveLength(5);
    expect(new Set(room.clueOrder).size).toBe(5);
    expect(room.clueIndex).toBe(0);
  });

  test('only the player whose turn it is may clue', () => {
    const room = startedRoom('P');
    const notTheirTurn = room.clueOrder[2];

    expect(submitClue(room, notTheirTurn, 'nope')).toBe(false);
    expect(room.clues).toHaveLength(0);
  });

  test('a valid clue is recorded and the turn advances', () => {
    const room = startedRoom('Q');

    expect(submitClue(room, room.clueOrder[0], 'italian')).toBe(true);
    expect(room.clues[0]).toMatchObject({ text: 'italian', round: 1 });
    expect(room.clueIndex).toBe(1);
  });

  test('the last clue moves the game to discussion', () => {
    const room = startedRoom('R');
    room.clueOrder.forEach(id => submitClue(room, id, 'clue'));

    expect(room.phase).toBe('discussion');
    expect(room.clues).toHaveLength(5);
  });

  test('a two-round game reshuffles and runs a second round before discussion', () => {
    const room = startedRoom('S', 5, { clueRounds: 2 });
    [...room.clueOrder].forEach(id => submitClue(room, id, 'r1'));

    expect(room.phase).toBe('clue');
    expect(room.clueRound).toBe(2);
    expect(room.clueIndex).toBe(0);

    [...room.clueOrder].forEach(id => submitClue(room, id, 'r2'));
    expect(room.phase).toBe('discussion');
    expect(room.clues).toHaveLength(10);
  });
});

// ── Vote resolution ───────────────────────────────────────────────────────────
describe('resolveVotes', () => {
  /** Force a specific role onto a specific seat so outcomes are deterministic. */
  function riggedRoom(code, roleBySeat) {
    const room = startedRoom(code);
    room.players.forEach((p, i) => { p.role = roleBySeat[i] || 'Regular'; });
    room.phase = 'vote';
    room.votes = {};
    return room;
  }

  function allVoteFor(room, targetId) {
    room.players.forEach(p => { room.votes[p.id] = p.id === targetId ? room.players[0].id : targetId; });
    room.votes[targetId] = room.players.find(p => p.id !== targetId).id;
    // Ensure the target is the clear leader
    room.players.filter(p => p.id !== targetId).forEach(p => { room.votes[p.id] = targetId; });
  }

  test('catching the imposter opens their final guess', () => {
    const room = riggedRoom('T', ['Imposter']);
    allVoteFor(room, 's1');

    const result = resolveVotes(room);

    expect(result.action).toBe('imposter-guess');
    expect(room.phase).toBe('imposter-guess');
    expect(room.accusedId).toBe('s1');
  });

  test('voting out a regular costs a round but does not end the game', () => {
    const room = riggedRoom('U', ['Regular', 'Imposter']);
    allVoteFor(room, 's1');

    const result = resolveVotes(room);

    // 1 imposter vs 3 remaining crew — nowhere near parity, so play continues.
    expect(result.action).toBe('next-round');
    expect(room.winner).toBeNull();
    expect(room.phase).toBe('clue');
    expect(room.eliminated).toEqual(['s1']);
  });

  test('voting out the jester wins the jester the game alone', () => {
    const room = riggedRoom('V', ['Jester', 'Imposter']);
    allVoteFor(room, 's1');

    resolveVotes(room);

    expect(room.winner).toBe('jester');
    expect(room.winReason).toMatch(/Jester/);
  });

  test('an accomplice gets no guess — they already know the word', () => {
    const room = riggedRoom('W', ['Accomplice', 'Imposter']);
    allVoteFor(room, 's1');

    const result = resolveVotes(room);

    // Out, but no guess phase, and the real Imposter is still at large.
    expect(result.action).toBe('next-round');
    expect(room.eliminated).toEqual(['s1']);
    expect(room.phase).toBe('clue');
  });

  test('with guessing disabled, catching the imposter ends it at once', () => {
    const room = riggedRoom('X', ['Imposter']);
    room.config.allowImposterGuess = false;
    allVoteFor(room, 's1');

    resolveVotes(room);

    expect(room.winner).toBe('regular');
    expect(room.phase).toBe('game-over');
  });

  test('a tie triggers a revote limited to the tied players', () => {
    const room = riggedRoom('Y', ['Imposter']);
    room.votes = { s1: 's2', s2: 's1', s3: 's2', s4: 's1', s5: 's3' };

    const result = resolveVotes(room);

    expect(result.action).toBe('revote');
    expect(room.voteRound).toBe(2);
    expect(room.voteCandidates.sort()).toEqual(['s1', 's2']);
    expect(room.votes).toEqual({});
  });

  // A plurality is not enough — ejecting on 2 of 5 let 40% of the table decide.
  test('a leading player without a majority does NOT get ejected', () => {
    const room = riggedRoom('Y2', ['Imposter']);
    // s2 leads with 2 of 5 — a plurality, but short of the 3 needed.
    room.votes = { s1: 's2', s5: 's2', s2: 's3', s3: 's4', s4: 's5' };

    const result = resolveVotes(room);

    expect(result.action).toBe('revote');
    expect(room.accusedId).toBeNull();
    expect(room.phase).not.toBe('game-over');
  });

  test('a clear majority ejects on the first round', () => {
    const room = riggedRoom('Y3', ['Imposter']);
    room.votes = { s2: 's1', s3: 's1', s4: 's1', s5: 's2', s1: 's2' };

    const result = resolveVotes(room);

    expect(result.action).toBe('imposter-guess');
    expect(room.accusedId).toBe('s1');
  });

  test('the ballot widens to the runners-up when the top tier is one player', () => {
    const room = riggedRoom('Y4', ['Imposter']);
    // s2 leads with 2, s3 and s4 have 1 each — a one-name ballot is not a vote.
    room.votes = { s1: 's2', s5: 's2', s2: 's3', s3: 's4', s4: 's3' };

    resolveVotes(room);

    expect(room.voteCandidates).toContain('s2');
    expect(room.voteCandidates.length).toBeGreaterThan(1);
  });

  test('each failed round records who voted for whom', () => {
    const room = riggedRoom('Y5', ['Imposter']);
    room.votes = { s1: 's2', s2: 's1', s3: 's2', s4: 's1', s5: 's3' };

    resolveVotes(room);

    const round1 = room.voteHistory[0];
    expect(round1.majorityNeeded).toBe(3);
    const forS2 = round1.tallies.find(t => t.name === 'Player2');
    expect(forS2.votes).toBe(2);
    expect(forS2.voters.sort()).toEqual(['Player1', 'Player3']);
  });

  test('three rounds without a majority hands the win to the imposters', () => {
    const room = riggedRoom('Z', ['Imposter']);
    const split = { s1: 's2', s2: 's1', s3: 's2', s4: 's1' };

    room.votes = { ...split }; resolveVotes(room);
    expect(room.voteRound).toBe(2);
    room.votes = { ...split }; resolveVotes(room);
    expect(room.voteRound).toBe(3);
    room.votes = { ...split }; resolveVotes(room);

    expect(room.winner).toBe('imposter');
    expect(room.winReason).toMatch(/never reached a majority/i);
    expect(room.phase).toBe('game-over');
  });

  test('each round is recorded in the vote history for the recap', () => {
    const room = riggedRoom('AA', ['Imposter']);
    allVoteFor(room, 's1');

    resolveVotes(room);

    expect(room.voteHistory).toHaveLength(1);
    expect(room.voteHistory[0].tallies[0]).toMatchObject({ name: 'Player1', votes: 4 });
    expect(room.voteHistory[0].tallies[0].voters).toHaveLength(4);
  });
});

// ── Final guess ───────────────────────────────────────────────────────────────
describe('resolveGuess', () => {
  // s1 is the only imposter and has just been voted out, awaiting their guess.
  function caughtRoom(code) {
    const room = startedRoom(code);
    room.players.forEach((p, i) => { p.role = i === 0 ? 'Imposter' : 'Regular'; });
    room.eliminated = ['s1'];
    room.eliminationLog = [{ id: 's1', name: 'Player1', role: 'Imposter',
                             wasImposter: true, round: 1, guess: null, guessCorrect: null }];
    room.accusedId = 's1';
    room.phase = 'imposter-guess';
    return room;
  }

  test('a correct guess steals the win', () => {
    const room = caughtRoom('AB');
    resolveGuess(room, 'Pizza');

    expect(room.winner).toBe('imposter');
    expect(room.phase).toBe('game-over');
  });

  test('guessing is case and punctuation insensitive', () => {
    const room = caughtRoom('AC');
    resolveGuess(room, '  pIzZa! ');

    expect(room.winner).toBe('imposter');
  });

  test('a wrong guess by the last imposter gives it to the regulars', () => {
    const room = caughtRoom('AD');
    resolveGuess(room, 'Sushi');

    expect(room.winner).toBe('regular');
    expect(room.winReason).toMatch(/Pizza/);
  });

  test('the guess is recorded against that player and cannot be repeated', () => {
    const room = caughtRoom('AD2');
    resolveGuess(room, 'Sushi');

    expect(room.guessUsed).toContain('s1');
    expect(room.eliminationLog[0]).toMatchObject({ guess: 'Sushi', guessCorrect: false });
  });
});

// ── Broadcast state must not leak ─────────────────────────────────────────────
describe('impGameState never leaks secrets mid-game', () => {
  test('the word and roles stay hidden until game over', () => {
    const room = startedRoom('AE');

    const state = impGameState(room);

    expect(state.secretWord).toBeNull();
    expect(state.revealedRoles).toBeNull();
    expect(JSON.stringify(state)).not.toContain('Pizza');
    expect(JSON.stringify(state)).not.toContain('Imposter');
  });

  test('votes are masked while voting is open', () => {
    const room = startedRoom('AF');
    room.phase = 'vote';
    room.votes = { s1: 's3', s2: 's3' };

    const state = impGameState(room);

    expect(state.votes).toEqual({ s1: 'voted', s2: 'voted' });
  });

  test('everything is revealed once the game is over', () => {
    const room = startedRoom('AG');
    room.phase = 'game-over';
    room.winner = 'regular';

    const state = impGameState(room);

    expect(state.secretWord).toBe('Pizza');
    expect(state.revealedRoles).toHaveLength(5);
  });

  test('the lobby view exposes no roles', () => {
    const room = startedRoom('AH');

    expect(JSON.stringify(impLobbyState(room))).not.toContain('Imposter');
  });
});

// ── Team helpers ──────────────────────────────────────────────────────────────
describe('team classification', () => {
  test.each([
    ['Imposter', true], ['Double Agent', true], ['Accomplice', true],
    ['Regular', false], ['Detective', false], ['Confused', false], ['Jester', false],
  ])('%s on imposter team: %s', (role, expected) => {
    expect(isImposterTeam(role)).toBe(expected);
  });

  test('only roles that do not know the word may guess when caught', () => {
    expect(isWordIgnorant('Imposter')).toBe(true);
    expect(isWordIgnorant('Double Agent')).toBe(true);
    expect(isWordIgnorant('Accomplice')).toBe(false);
  });
});

// ── Handlers over mock sockets ────────────────────────────────────────────────
describe('imposter socket handlers', () => {
  let io;
  beforeEach(() => {
    clearImpRooms();
    ({ io } = makeIo());
    registerImposterHandlers(io);
  });

  function seat(n) {
    const host = connectSocket(io, 'h1');
    host.trigger('imp:create-room', { playerCount: n, name: 'Host', token: 'h', config: BASE_CONFIG });
    const code = host.last('imp:room-created').code;
    host.join('imp-' + code);
    const rest = [];
    for (let i = 2; i <= n; i++) {
      const c = connectSocket(io, 's' + i);
      c.trigger('imp:join-room', { code, name: 'P' + i, token: 't' + i });
      c.join('imp-' + code);
      rest.push(c);
    }
    return { code, sockets: [host, ...rest] };
  }

  test('create-room makes a room with a sane config', () => {
    const { code } = seat(5);

    expect(impRooms[code]).toBeDefined();
    expect(impRooms[code].playerCount).toBe(5);
    expect(impRooms[code].config.imposterCount).toBe(1);
  });

  test('host-added words are trimmed, de-duplicated, and capped', () => {
    const s = connectSocket(io, 'cw');
    s.trigger('imp:create-room', {
      playerCount: 5, name: 'H', token: 'cw',
      config: { ...BASE_CONFIG,
        customWords: ['  Pickleball  ', 'pickleball', '', '   ', 'Game Night',
                      ...Array.from({ length: 60 }, (_, i) => 'w' + i)] },
    });

    const words = impRooms[s.last('imp:room-created').code].config.customWords;
    expect(words).toHaveLength(50);
    expect(words[0]).toBe('Pickleball');          // trimmed
    expect(words.filter(w => w.toLowerCase() === 'pickleball')).toHaveLength(1);
    expect(words).not.toContain('');
  });

  test('the Your Words category survives config sanitising', () => {
    const s = connectSocket(io, 'cw2');
    s.trigger('imp:create-room', {
      playerCount: 5, name: 'H', token: 'cw2',
      config: { ...BASE_CONFIG, customWords: ['Pickleball'], categories: ['Your Words', 'Food', 'Bogus'] },
    });

    const cfg = impRooms[s.last('imp:room-created').code].config;
    expect(cfg.categories).toEqual(['Your Words', 'Food']);
  });

  test('a bad player count is clamped into range', () => {
    const s = connectSocket(io, 'z1');
    s.trigger('imp:create-room', { playerCount: 99, name: 'H', token: 'z', config: BASE_CONFIG });

    expect(impRooms[s.last('imp:room-created').code].playerCount).toBe(15);
  });

  test('a duplicate name is rejected', () => {
    const { code } = seat(5);
    const late = connectSocket(io, 'dup');
    late.trigger('imp:join-room', { code, name: 'host', token: 'd' });

    expect(late.last('imp:join-error')).toBeDefined();
  });

  test('joining an unknown room errors', () => {
    const s = connectSocket(io, 'q');
    s.trigger('imp:join-room', { code: 'NOPE', name: 'X', token: 'q' });

    expect(s.last('imp:join-error')).toBe('Room not found.');
  });

  test('the game starts once the room is full and everyone is ready', () => {
    const { code, sockets } = seat(5);
    sockets.forEach(s => s.trigger('imp:toggle-ready'));

    expect(impRooms[code].state).toBe('playing');
    expect(impRooms[code].phase).toBe('clue');
    sockets.forEach(s => expect(s.last('imp:your-role')).toBeDefined());
  });

  test('only the host may start the vote', () => {
    const { code, sockets } = seat(5);
    sockets.forEach(s => s.trigger('imp:toggle-ready'));
    const room = impRooms[code];
    room.clueOrder.forEach(id => submitClue(room, id, 'c'));

    sockets[2].trigger('imp:start-vote');
    expect(room.phase).toBe('discussion');

    sockets[0].trigger('imp:start-vote');
    expect(room.phase).toBe('vote');
  });

  test('a player cannot vote for themselves or vote twice', () => {
    const { code, sockets } = seat(5);
    sockets.forEach(s => s.trigger('imp:toggle-ready'));
    const room = impRooms[code];
    room.clueOrder.forEach(id => submitClue(room, id, 'c'));
    sockets[0].trigger('imp:start-vote');

    sockets[1].trigger('imp:cast-vote', { targetId: sockets[1].id });
    expect(room.votes[sockets[1].id]).toBeUndefined();

    sockets[1].trigger('imp:cast-vote', { targetId: sockets[2].id });
    sockets[1].trigger('imp:cast-vote', { targetId: sockets[3].id });
    expect(room.votes[sockets[1].id]).toBe(sockets[2].id);
  });

  test('a mid-game disconnect pauses and the room survives', () => {
    const { code, sockets } = seat(5);
    sockets.forEach(s => s.trigger('imp:toggle-ready'));

    sockets[3].trigger('disconnect');

    expect(impRooms[code]).toBeDefined();
    expect(impRooms[code].disconnected).toEqual(['P4']);
    expect(sockets[0].last('imp:game-paused')).toEqual({ disconnected: ['P4'] });
  });

  test('the room is deleted once everyone has dropped', () => {
    const { code, sockets } = seat(5);
    sockets.forEach(s => s.trigger('imp:toggle-ready'));

    sockets.forEach(s => s.trigger('disconnect'));

    expect(impRooms[code]).toBeUndefined();
  });

  test('rejoining by token restores the players own role', () => {
    const { code, sockets } = seat(5);
    sockets.forEach(s => s.trigger('imp:toggle-ready'));
    const originalRole = roleOf(impRooms[code], sockets[2].id);
    sockets[2].trigger('disconnect');

    const back = connectSocket(io, 'back');
    back.trigger('imp:rejoin-room', { code, name: 'P3', token: 't3' });

    expect(back.last('imp:your-role')).toBeDefined();
    expect(roleOf(impRooms[code], 'back')).toBe(originalRole);
    expect(impRooms[code].disconnected).toHaveLength(0);
  });

  test('an imposter room is invisible to Avalon room lookups', () => {
    const { code } = seat(5);
    const { rooms } = require('../server/rooms');

    expect(rooms[code]).toBeUndefined();
    expect(impRooms[code]).toBeDefined();
  });
});
