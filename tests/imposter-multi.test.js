/**
 * Multiple-imposter rules.
 *
 * Catching one imposter used to end the game outright, which made a 3-imposter
 * game *easier* for the crew than a 1-imposter game — two extra targets, any of
 * which won. Play now continues round by round until every imposter is out or
 * they reach parity with the crew.
 *
 * The subtle rule these tests pin down: a caught imposter always gets their one
 * guess *before* the crew can be declared the winner, so the last imposter can
 * still steal it on the way out.
 */

const {
  assignRoles, beginGame, resolveVotes, resolveGuess, submitClue,
  activePlayers, activeImposters, activeCrew,
} = require('../server/imposter/engine');
const { impRooms } = require('../server/imposter/rooms');
const { impGameState } = require('../server/imposter/state');
const registerImposterHandlers = require('../server/imposter/handlers');
const { makeIo, connectSocket } = require('./helpers');

jest.mock('../server/db', () => ({
  saveRoom:   () => Promise.resolve(),
  deleteRoom: () => Promise.resolve(),
  loadRooms:  () => Promise.resolve([]),
}));

const BASE_CONFIG = {
  imposterCount: 1,
  impostersKnowEachOther: false,
  hintLevel: 'category',
  categoryVisible: true,
  clueRounds: 1,
  allowImposterGuess: true,
  specialRoles: { detective: false, confused: false, doubleAgent: false, accomplice: false, jester: false },
  categories: [], customWords: [],
  customWord: 'Pizza', customCategory: 'Food', customRelated: 'Pasta',
};

beforeEach(() => { Object.keys(impRooms).forEach(k => delete impRooms[k]); });

/** A started room with roles pinned to seats, so outcomes are deterministic. */
function riggedGame(code, roles) {
  const config = { ...BASE_CONFIG, imposterCount: roles.filter(r => r === 'Imposter').length || 1 };
  const room = {
    gameType: 'imposter', code, hostId: 's1', playerCount: roles.length, config,
    players: roles.map((_, i) => ({
      id: `s${i + 1}`, name: `Player${i + 1}`, token: `tok-${i + 1}`, ready: true, role: null,
    })),
    state: 'lobby',
  };
  impRooms[code] = room;
  assignRoles(room);
  beginGame(room);
  room.players.forEach((p, i) => { p.role = roles[i]; });
  return room;
}

/** Every surviving player except the target votes them out. */
function ejectByVote(room, targetId) {
  room.phase = 'vote';
  room.votes = {};
  room.voteRound = 1;
  room.voteCandidates = null;
  const alive = activePlayers(room);
  alive.forEach(p => { if (p.id !== targetId) room.votes[p.id] = targetId; });
  room.votes[targetId] = alive.find(p => p.id !== targetId).id;
  return resolveVotes(room);
}

const TWO_IMP = ['Imposter', 'Imposter', 'Regular', 'Regular', 'Regular', 'Regular'];

// ── Catching one is not the end ───────────────────────────────────────────────
describe('catching an imposter', () => {
  test('does not end the game while another imposter is alive', () => {
    const room = riggedGame('M1', TWO_IMP);

    const result = ejectByVote(room, 's1');
    expect(result.action).toBe('imposter-guess');
    expect(room.winner).toBeNull();

    resolveGuess(room, 'definitely wrong');

    expect(room.winner).toBeNull();
    expect(room.phase).toBe('clue');
    expect(activeImposters(room)).toHaveLength(1);
  });

  test('starts a fresh round with the survivors', () => {
    const room = riggedGame('M2', TWO_IMP);
    ejectByVote(room, 's1');
    resolveGuess(room, 'wrong');

    expect(room.round).toBe(2);
    expect(room.clueOrder).not.toContain('s1');
    expect(room.clueOrder).toHaveLength(5);
    expect(room.clues).toEqual([]);
    expect(room.votes).toEqual({});
  });

  test('is recorded in the elimination log with their true role', () => {
    const room = riggedGame('M3', TWO_IMP);
    ejectByVote(room, 's1');
    resolveGuess(room, 'nope');

    expect(room.eliminationLog[0]).toMatchObject({
      name: 'Player1', wasImposter: true, guess: 'nope', guessCorrect: false, round: 1,
    });
  });
});

// ── The guess ─────────────────────────────────────────────────────────────────
describe('the caught imposter s one guess', () => {
  test('wins outright even with another imposter still at large', () => {
    const room = riggedGame('M4', TWO_IMP);
    ejectByVote(room, 's1');

    resolveGuess(room, 'Pizza');

    expect(room.winner).toBe('imposter');
    expect(room.phase).toBe('game-over');
    expect(activeImposters(room)).toHaveLength(1);   // the other was never caught
  });

  test('wins outright even when every imposter has already been caught', () => {
    const room = riggedGame('M5', TWO_IMP);
    ejectByVote(room, 's1');
    resolveGuess(room, 'wrong');

    ejectByVote(room, 's2');
    resolveGuess(room, 'Pizza');

    expect(room.winner).toBe('imposter');
  });

  test('is offered to the last imposter before the crew is declared winner', () => {
    const room = riggedGame('M6', TWO_IMP);
    ejectByVote(room, 's1');
    resolveGuess(room, 'wrong');
    expect(room.winner).toBeNull();

    const second = ejectByVote(room, 's2');
    expect(second.action).toBe('imposter-guess');    // not an instant crew win
    expect(room.winner).toBeNull();

    resolveGuess(room, 'wrong again');

    expect(room.winner).toBe('regular');
    expect(room.phase).toBe('game-over');
  });

  test('is spent once and never offered again', () => {
    const room = riggedGame('M7', TWO_IMP);
    ejectByVote(room, 's1');
    resolveGuess(room, 'nope');

    expect(room.guessUsed).toEqual(['s1']);
  });
});

// ── Win conditions ────────────────────────────────────────────────────────────
describe('win conditions', () => {
  test('imposters win on reaching parity with the crew', () => {
    const room = riggedGame('M8', TWO_IMP);

    ejectByVote(room, 's3');       // 2 imposters vs 3 crew — continues
    expect(room.winner).toBeNull();
    expect(room.phase).toBe('clue');

    ejectByVote(room, 's4');       // 2 vs 2 — imposters take over

    expect(room.winner).toBe('imposter');
    expect(room.phase).toBe('game-over');
  });

  test('one imposter against two crew keeps going', () => {
    const room = riggedGame('M9', ['Imposter', 'Regular', 'Regular', 'Regular']);

    ejectByVote(room, 's2');

    expect(room.winner).toBeNull();
    expect(activeImposters(room)).toHaveLength(1);
    expect(activeCrew(room)).toHaveLength(2);
  });

  test('one imposter against one crew ends it', () => {
    const room = riggedGame('M10', ['Imposter', 'Regular', 'Regular']);

    ejectByVote(room, 's2');

    expect(room.winner).toBe('imposter');
  });

  test('ejecting a regular costs the crew a player without ending the game', () => {
    const room = riggedGame('M11', TWO_IMP);

    const result = ejectByVote(room, 's3');

    expect(result.action).toBe('next-round');
    expect(room.eliminationLog[0]).toMatchObject({ name: 'Player3', wasImposter: false });
    expect(activeCrew(room)).toHaveLength(3);
  });

  test('a single-imposter game behaves exactly as before', () => {
    const room = riggedGame('M12', ['Imposter', 'Regular', 'Regular', 'Regular', 'Regular']);

    expect(ejectByVote(room, 's1').action).toBe('imposter-guess');
    resolveGuess(room, 'wrong');

    expect(room.winner).toBe('regular');
    expect(room.phase).toBe('game-over');
  });
});

// ── What the survivors are allowed to see and do ──────────────────────────────
describe('eliminated players', () => {
  test('are excluded from the majority threshold', () => {
    const room = riggedGame('M13', TWO_IMP);
    expect(impGameState(room).majorityNeeded).toBe(4);   // 6 players

    ejectByVote(room, 's3');

    expect(activePlayers(room)).toHaveLength(5);
    expect(impGameState(room).majorityNeeded).toBe(3);
  });

  test('cannot cast a vote', () => {
    const { io } = makeIo();
    registerImposterHandlers(io);
    const room = riggedGame('M14', TWO_IMP);
    ejectByVote(room, 's3');
    room.phase = 'vote';
    room.votes = {};

    const ghost = connectSocket(io, 's3');
    ghost.trigger('imp:cast-vote', { targetId: 's1' });

    expect(room.votes.s3).toBeUndefined();
  });

  test('cannot be voted for', () => {
    const { io } = makeIo();
    registerImposterHandlers(io);
    const room = riggedGame('M15', TWO_IMP);
    ejectByVote(room, 's3');
    room.phase = 'vote';
    room.votes = {};

    const voter = connectSocket(io, 's4');
    voter.trigger('imp:cast-vote', { targetId: 's3' });

    expect(room.votes.s4).toBeUndefined();
  });

  test('are marked in the broadcast state so the UI can grey them out', () => {
    const room = riggedGame('M16', TWO_IMP);
    ejectByVote(room, 's3');

    const state = impGameState(room);

    expect(state.players.find(p => p.id === 's3').eliminated).toBe(true);
    expect(state.players.find(p => p.id === 's4').eliminated).toBe(false);
    expect(state.activeCount).toBe(5);
  });
});

// ── Nothing leaks ─────────────────────────────────────────────────────────────
describe('mid-game state never exposes surviving imposters', () => {
  test('shows who was caught but not who is left', () => {
    const room = riggedGame('M17', TWO_IMP);
    ejectByVote(room, 's1');
    resolveGuess(room, 'wrong');

    const state = impGameState(room);

    expect(state.eliminationLog[0]).toMatchObject({ name: 'Player1', wasImposter: true });
    expect(state.impostersFound).toBe(1);
    expect(state.impostersTotal).toBe(2);
    expect(state.revealedRoles).toBeNull();
    // Player2 is the surviving imposter — nothing may give that away. The
    // elimination log is meant to say "Player1 was an Imposter", so exclude it
    // and require the rest of the payload to be free of any role information.
    const { eliminationLog, ...rest } = state;
    expect(state.players.find(p => p.id === 's2')).not.toHaveProperty('role');
    expect(JSON.stringify(rest)).not.toContain('Imposter');
    expect(JSON.stringify(state)).not.toContain('Pizza');
  });

  test('reveals every role once the game is over', () => {
    const room = riggedGame('M18', TWO_IMP);
    ejectByVote(room, 's1');
    resolveGuess(room, 'Pizza');           // imposters steal it

    const state = impGameState(room);

    expect(state.revealedRoles).toHaveLength(6);
    expect(state.revealedRoles.filter(r => r.role === 'Imposter')).toHaveLength(2);
    expect(state.secretWord).toBe('Pizza');
  });
});

// ── Imposter coordination ─────────────────────────────────────────────────────
// Teammate names ship as structured data alongside the prose, so the client can
// keep a live panel in step with who has been caught. The role card is dealt
// once at game start and would otherwise go stale the moment a teammate goes.
describe('imposter coordination', () => {
  const { buildPrivateInfo } = require('../server/imposter/engine');

  function teamGame(code, know) {
    const room = riggedGame(code, TWO_IMP);
    room.config.impostersKnowEachOther = know;
    return room;
  }

  test('with the option on, each imposter is given the others by name', () => {
    const room = teamGame('C1', true);

    const first  = buildPrivateInfo(room, room.players[0]);
    const second = buildPrivateInfo(room, room.players[1]);

    expect(first.teammates).toEqual(['Player2']);
    expect(second.teammates).toEqual(['Player1']);
  });

  test('with the option off, imposters get no teammates at all', () => {
    const room = teamGame('C2', false);

    const first = buildPrivateInfo(room, room.players[0]);

    expect(first.teammates).toEqual([]);
    expect(first.extra).not.toContain('Player2');
  });

  test('a player never appears in their own teammate list', () => {
    const room = teamGame('C3', true);

    room.players.filter(p => p.role === 'Imposter').forEach(p => {
      expect(buildPrivateInfo(room, p).teammates).not.toContain(p.name);
    });
  });

  test('regular-team players are never given a teammate list', () => {
    const room = teamGame('C4', true);

    room.players.filter(p => p.role === 'Regular').forEach(p => {
      expect(buildPrivateInfo(room, p).teammates).toBeUndefined();
    });
  });

  test('the Accomplice always learns who to help, option or not', () => {
    const room = riggedGame('C5', ['Accomplice', 'Imposter', 'Regular', 'Regular', 'Regular', 'Regular']);
    room.config.impostersKnowEachOther = false;

    const info = buildPrivateInfo(room, room.players[0]);

    expect(info.teammates).toEqual(['Player2']);
  });

  test('teammate names are never present in the broadcast state', () => {
    const room = teamGame('C6', true);

    // Both imposters know each other, but nothing public may say who they are.
    const state = impGameState(room);
    expect(JSON.stringify(state)).not.toContain('teammates');
    expect(state.players.find(p => p.id === 's1')).not.toHaveProperty('teammates');
  });

  test('the caught status a client shows is derivable from public data alone', () => {
    const room = teamGame('C7', true);
    ejectByVote(room, 's1');
    resolveGuess(room, 'wrong');

    // Player2 holds ['Player1'] as their team; the elimination log is what
    // tells them Player1 is gone, and that log is public.
    const state = impGameState(room);
    expect(state.eliminationLog.some(e => e.name === 'Player1')).toBe(true);
  });
});

// ── Imposter team accounting ──────────────────────────────────────────────────
// impostersFound counts anyone on the imposter TEAM, so the total it is
// measured against has to be the team as well. Counting only the Imposter role
// let a caught Double Agent decrement a total it was never part of, and the
// header could read "0 of 2 left" with an Imposter still alive.
describe('imposter counts stay consistent with the team', () => {
  function withDoubleAgent(code) {
    const room = riggedGame(code, ['Imposter', 'Imposter', 'Double Agent', 'Regular', 'Regular', 'Regular', 'Regular']);
    room.config.imposterCount = 2;
    room.config.specialRoles = { ...room.config.specialRoles, doubleAgent: true };
    return room;
  }

  test('the total includes the Double Agent', () => {
    const room = withDoubleAgent('T1');

    expect(impGameState(room).impostersTotal).toBe(3);
  });

  test('an Accomplice counts towards the total too', () => {
    const room = riggedGame('T2', ['Imposter', 'Accomplice', 'Regular', 'Regular', 'Regular', 'Regular']);
    room.config.imposterCount = 1;
    room.config.specialRoles = { ...room.config.specialRoles, accomplice: true };

    expect(impGameState(room).impostersTotal).toBe(2);
  });

  test('found never exceeds the total, and left never lies', () => {
    const room = withDoubleAgent('T3');
    ejectByVote(room, 's3');            // the Double Agent
    resolveGuess(room, 'wrong');
    ejectByVote(room, 's1');            // a real Imposter
    resolveGuess(room, 'wrong');

    const state = impGameState(room);
    const left = state.impostersTotal - state.impostersFound;

    expect(state.impostersFound).toBe(2);
    expect(state.impostersTotal).toBe(3);
    expect(left).toBe(1);
    // …and that matches who is genuinely still playing for the imposters.
    expect(left).toBe(activeImposters(room).length);
  });

  test('the count shown matches the survivors at every step', () => {
    const room = withDoubleAgent('T4');

    [ 's3', 's1' ].forEach(id => {
      ejectByVote(room, id);
      if (room.phase === 'imposter-guess') resolveGuess(room, 'wrong');
      const s = impGameState(room);
      expect(s.impostersTotal - s.impostersFound).toBe(activeImposters(room).length);
    });
  });
});

// ── Skipping the clue round ───────────────────────────────────────────────────
// After the first round a table usually already has a suspect, so making
// everyone clue again just to reach a vote is dead time.
describe('skipping the clue round', () => {
  function midGame(code) {
    const room = riggedGame(code, TWO_IMP);
    const { io } = makeIo();
    registerImposterHandlers(io);
    room.players.forEach(p => connectSocket(io, p.id));
    return { room, io };
  }

  test('the host can jump straight to discussion from round 2', () => {
    const { room, io } = midGame('S1');
    ejectByVote(room, 's3');                 // into round 2
    expect(room.phase).toBe('clue');

    connectSocket(io, room.hostId).trigger('imp:skip-clues');

    expect(room.phase).toBe('discussion');
  });

  test('round 1 cannot be skipped — those clues are the whole game', () => {
    const { room, io } = midGame('S2');
    expect(room.round).toBe(1);

    connectSocket(io, room.hostId).trigger('imp:skip-clues');

    expect(room.phase).toBe('clue');
  });

  test('only the host may skip', () => {
    const { room, io } = midGame('S3');
    ejectByVote(room, 's3');
    const other = room.players.find(p => p.id !== room.hostId && !room.eliminated.includes(p.id));

    connectSocket(io, other.id).trigger('imp:skip-clues');

    expect(room.phase).toBe('clue');
  });

  test('clues already given in the round are kept', () => {
    const { room, io } = midGame('S4');
    ejectByVote(room, 's3');
    submitClue(room, room.clueOrder[0], 'first clue');

    connectSocket(io, room.hostId).trigger('imp:skip-clues');

    expect(room.phase).toBe('discussion');
    expect(room.clues.map(c => c.text)).toEqual(['first clue']);
  });
});
