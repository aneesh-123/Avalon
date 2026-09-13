/**
 * Word reroll — "this word is too hard, deal us another".
 *
 * The rule that matters most here is that a reroll changes the WORD and
 * nothing else. Re-dealing roles would turn the vote into a way for an
 * imposter to vote themselves out of the role, so these tests pin the roles
 * down across a reroll as hard as they pin the word changing.
 *
 * The second rule is the window: the vote is only open before the first clue
 * of the opening round. Once a clue is on the board it was given about a word,
 * and swapping that word underneath it would make the clue a lie.
 */

const {
  assignRoles, beginGame, buildPrivateInfo, submitClue, resolveVotes,
  rerollOpen, rerollNeeded, toggleRerollVote, rerollWord, MAX_REROLLS,
  activePlayers,
} = require('../server/imposter/engine');
const { pickWord } = require('../server/imposter/words');
const { impRooms } = require('../server/imposter/rooms');
const { impGameState } = require('../server/imposter/state');
const registerImposterHandlers = require('../server/imposter/handlers');
const { makeIo, connectSocket } = require('./helpers');

jest.mock('../server/db', () => ({
  saveRoom:   () => Promise.resolve(),
  deleteRoom: () => Promise.resolve(),
  loadRooms:  () => Promise.resolve([]),
}));

// No customWord — a host-chosen word is deliberately not rerollable, and most
// of these tests need a word drawn from the bank.
const BANK_CONFIG = {
  imposterCount: 1,
  impostersKnowEachOther: false,
  hintLevel: 'category',
  categoryVisible: true,
  clueRounds: 1,
  allowImposterGuess: true,
  specialRoles: { detective: false, confused: false, doubleAgent: false, accomplice: false, jester: false },
  categories: [], customWords: [],
  customWord: null, customCategory: null, customRelated: null,
};

beforeEach(() => { Object.keys(impRooms).forEach(k => delete impRooms[k]); });

/** A started six-player room with roles pinned to seats. */
function startedRoom(code, roles = ['Imposter', 'Regular', 'Regular', 'Regular', 'Regular', 'Regular'], extra = {}) {
  const config = { ...BANK_CONFIG, ...extra,
    imposterCount: roles.filter(r => r === 'Imposter').length || 1 };
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

// ── When the vote is open ────────────────────────────────────────────────────
describe('the reroll window', () => {
  test('is open on a fresh deal', () => {
    expect(rerollOpen(startedRoom('R1'))).toBe(true);
  });

  test('closes as soon as the first clue lands', () => {
    const room = startedRoom('R2');
    expect(rerollOpen(room)).toBe(true);
    submitClue(room, room.clueOrder[0], 'round and cheesy');
    expect(rerollOpen(room)).toBe(false);
  });

  test('is closed in later elimination rounds', () => {
    const room = startedRoom('R3');
    room.round = 2;
    expect(rerollOpen(room)).toBe(false);
  });

  test('is closed outside the clue phase', () => {
    const room = startedRoom('R4');
    room.phase = 'vote';
    expect(rerollOpen(room)).toBe(false);
  });

  test('is closed for a host-chosen custom word', () => {
    const room = startedRoom('R5', undefined, { customWord: 'Pizza', customCategory: 'Food' });
    expect(room.secret.word).toBe('Pizza');
    expect(rerollOpen(room)).toBe(false);
  });

  test('closes for good once the cap is spent', () => {
    const room = startedRoom('R6');
    for (let i = 0; i < MAX_REROLLS; i++) {
      expect(rerollOpen(room)).toBe(true);
      rerollWord(room);
    }
    expect(room.rerollCount).toBe(MAX_REROLLS);
    expect(rerollOpen(room)).toBe(false);
  });
});

// ── Counting the votes ───────────────────────────────────────────────────────
describe('the vote', () => {
  test('needs more than half the table', () => {
    expect(rerollNeeded(startedRoom('V1'))).toBe(4);          // 6 players
    expect(rerollNeeded(startedRoom('V2', ['Imposter', 'Regular', 'Regular', 'Regular', 'Regular']))).toBe(3);
  });

  test('counts a request without carrying on its own', () => {
    const room = startedRoom('V3');
    expect(toggleRerollVote(room, 's1').action).toBe('counted');
    expect(toggleRerollVote(room, 's2').action).toBe('counted');
    expect(room.rerollVotes).toEqual(['s1', 's2']);
    expect(room.rerollCount).toBe(0);
  });

  test('lets a player take their request back', () => {
    const room = startedRoom('V4');
    toggleRerollVote(room, 's1');
    toggleRerollVote(room, 's1');
    expect(room.rerollVotes).toEqual([]);
  });

  test('does not double-count the same player', () => {
    const room = startedRoom('V5');
    toggleRerollVote(room, 's1');
    toggleRerollVote(room, 's2');
    toggleRerollVote(room, 's3');
    toggleRerollVote(room, 's3');   // taken back
    toggleRerollVote(room, 's3');   // asked again
    expect(room.rerollVotes).toHaveLength(3);
    expect(room.rerollCount).toBe(0);
  });

  test('carries on the fourth of six, and clears the tally', () => {
    const room = startedRoom('V6');
    const before = room.secret.word;
    ['s1', 's2', 's3'].forEach(id => toggleRerollVote(room, id));
    const result = toggleRerollVote(room, 's4');

    expect(result.action).toBe('rerolled');
    expect(result.from).toBe(before);
    expect(room.rerollVotes).toEqual([]);
    expect(room.rerollCount).toBe(1);
  });

  test('is refused once the window has closed', () => {
    const room = startedRoom('V7');
    submitClue(room, room.clueOrder[0], 'a clue');
    expect(toggleRerollVote(room, 's1').action).toBe('closed');
    expect(room.rerollVotes).toEqual([]);
  });

  test('is refused from an eliminated player', () => {
    const room = startedRoom('V8');
    room.eliminated = ['s2'];
    expect(toggleRerollVote(room, 's2').action).toBe('closed');
    expect(activePlayers(room)).toHaveLength(5);
  });
});

// ── What a reroll actually changes ───────────────────────────────────────────
describe('a carried reroll', () => {
  test('deals a different word', () => {
    const room = startedRoom('C1');
    const before = room.secret.word;
    rerollWord(room);
    expect(room.secret.word).not.toBe(before);
    expect(room.rerolledFrom).toBe(before);
  });

  test('never returns the rejected word, over many draws', () => {
    // The exclusion is the whole promise of the feature, so it is worth
    // hammering rather than sampling once.
    for (let i = 0; i < 300; i++) {
      const room = startedRoom(`C2-${i}`);
      const before = room.secret.word;
      rerollWord(room);
      expect(room.secret.word).not.toBe(before);
    }
  });

  test('leaves every role exactly where it was', () => {
    const roles = ['Imposter', 'Double Agent', 'Detective', 'Confused', 'Regular', 'Regular'];
    const room = startedRoom('C3', roles);
    const before = room.players.map(p => `${p.name}:${p.role}`);
    rerollWord(room);
    expect(room.players.map(p => `${p.name}:${p.role}`)).toEqual(before);
  });

  test('puts the round back to its opening state', () => {
    const room = startedRoom('C4');
    room.clues = [{ playerId: 's1', name: 'Player1', text: 'stale', round: 1 }];
    room.clueIndex = 1;
    room.votes = { s1: 's2' };
    room.voteRound = 2;
    room.voteCandidates = ['s2'];

    rerollWord(room);

    expect(room.phase).toBe('clue');
    expect(room.clues).toEqual([]);
    expect(room.clueIndex).toBe(0);
    expect(room.clueRound).toBe(1);
    expect(room.votes).toEqual({});
    expect(room.voteRound).toBe(1);
    expect(room.voteCandidates).toBeNull();
    expect(room.clueOrder).toHaveLength(6);
  });

  test('rebuilds the cards around the new word', () => {
    const roles = ['Imposter', 'Confused', 'Regular', 'Regular', 'Regular', 'Regular'];
    const room = startedRoom('C5', roles);
    rerollWord(room);

    const regular = buildPrivateInfo(room, room.players[2]);
    const confused = buildPrivateInfo(room, room.players[1]);
    const imposter = buildPrivateInfo(room, room.players[0]);

    expect(regular.word).toBe(room.secret.word);
    // Still lied to, and still with a word that is not the real one.
    expect(confused.displayRole).toBe('Regular Player');
    expect(confused.word).toBe(room.secret.related);
    expect(confused.word).not.toBe(room.secret.word);
    expect(imposter.word).toBeNull();
  });

  test('does not hand the Detective a second confirmed Regular', () => {
    // buildPrivateInfo runs again on every reroll and every rejoin. If the
    // confirmed name were re-drawn each time, a Detective could collect the
    // whole crew by refreshing.
    const roles = ['Imposter', 'Detective', 'Regular', 'Regular', 'Regular', 'Regular'];
    const room = startedRoom('C6', roles);
    const detective = room.players[1];

    const first = buildPrivateInfo(room, detective).extra;
    rerollWord(room);
    for (let i = 0; i < 20; i++) {
      expect(buildPrivateInfo(room, detective).extra).toBe(first);
    }
  });

  test('leaves a game that can still be played to a finish', () => {
    const room = startedRoom('C7');
    rerollWord(room);
    room.clueOrder.forEach(id => submitClue(room, id, 'clue'));
    expect(room.phase).toBe('discussion');

    room.phase = 'vote';
    room.votes = {};
    activePlayers(room).forEach(p => { if (p.id !== 's1') room.votes[p.id] = 's1'; });
    room.votes.s1 = 's2';
    expect(resolveVotes(room).action).toBe('imposter-guess');
  });
});

// ── The word bank's side of it ───────────────────────────────────────────────
describe('pickWord exclusion', () => {
  test('honours excludeWord across the whole bank', () => {
    const drawn = new Set();
    for (let i = 0; i < 500; i++) drawn.add(pickWord([], [], 'Pizza').word);
    expect(drawn.has('Pizza')).toBe(false);
    expect(drawn.size).toBeGreaterThan(1);
  });

  test('is case-insensitive', () => {
    for (let i = 0; i < 200; i++) {
      expect(pickWord(['Food'], [], 'pizza').word).not.toBe('Pizza');
    }
  });

  test('gives a word back rather than nothing when the pool is a single word', () => {
    // One host-added word, that category only, and it is the rejected one.
    // Dealing the same word again beats dealing no word at all.
    const entry = pickWord(['Your Words'], ['Onlyword'], 'Onlyword');
    expect(entry.word).toBe('Onlyword');
    expect(entry.related).toBeTruthy();   // the Confused player still needs one
  });

  test('still pairs a related word after an exclusion', () => {
    for (let i = 0; i < 100; i++) {
      const entry = pickWord([], [], 'Pizza');
      expect(entry.related).toBeTruthy();
      expect(entry.hint).toBeTruthy();
    }
  });
});

// ── Over the wire: the online game ───────────────────────────────────────────
describe('imp:request-reroll', () => {
  function wiredGame(code) {
    const { io } = makeIo();
    registerImposterHandlers(io);
    const room = startedRoom(code);
    room.state = 'playing';
    const sockets = room.players.map(p => {
      const s = connectSocket(io, p.id);
      s.rooms.add('imp-' + code);
      return s;
    });
    return { io, room, sockets };
  }

  test('broadcasts the running count without rerolling', () => {
    const { room, sockets } = wiredGame('W1');
    const before = room.secret.word;

    sockets[0].trigger('imp:request-reroll');
    sockets[1].trigger('imp:request-reroll');

    const state = impGameState(room);
    expect(state.rerollOpen).toBe(true);
    expect(state.rerollNeeded).toBe(4);
    expect(state.rerollVoters).toEqual(['Player1', 'Player2']);
    expect(state.rerollVoteIds).toEqual(['s1', 's2']);
    expect(room.secret.word).toBe(before);
    expect(sockets[0].received('imp:word-rerolled')).toBe(false);
  });

  test('on a majority, re-sends every private card and announces the swap', () => {
    const { room, sockets } = wiredGame('W2');
    const before = room.secret.word;

    ['0', '1', '2', '3'].forEach(i => sockets[Number(i)].trigger('imp:request-reroll'));

    expect(room.secret.word).not.toBe(before);
    sockets.forEach(s => {
      expect(s.received('imp:your-role')).toBe(true);
      expect(s.last('imp:word-rerolled')).toEqual({ from: before });
    });
    // The card each player is handed matches the NEW word, not the old one.
    const regular = room.players.find(p => p.role === 'Regular');
    expect(sockets[room.players.indexOf(regular)].last('imp:your-role').word).toBe(room.secret.word);
  });

  test('ignores a request once a clue is in', () => {
    const { room, sockets } = wiredGame('W3');
    submitClue(room, room.clueOrder[0], 'a clue');
    const before = room.secret.word;

    sockets.forEach(s => s.trigger('imp:request-reroll'));

    expect(room.secret.word).toBe(before);
    expect(room.rerollVotes).toEqual([]);
  });

  test('survives a rejoin remapping the voter to a new socket id', () => {
    const { io, room, sockets } = wiredGame('W4');
    sockets[0].trigger('imp:request-reroll');
    expect(room.rerollVotes).toEqual(['s1']);

    const revived = connectSocket(io, 'fresh-1');
    revived.trigger('imp:rejoin-room', { code: 'W4', name: 'Player1', token: 'tok-1' });

    expect(room.rerollVotes).toEqual(['fresh-1']);
    expect(impGameState(room).rerollVoters).toEqual(['Player1']);
  });
});

// ── Over the wire: the shared phone ──────────────────────────────────────────
describe('imp:solo-reroll', () => {
  const NAMES = ['Ana', 'Ben', 'Cal', 'Dee', 'Eli'];

  function deal() {
    const { io } = makeIo();
    registerImposterHandlers(io);
    const socket = connectSocket(io, 'phone');
    socket.trigger('imp:solo-deal', { names: NAMES, config: BANK_CONFIG });
    return { socket, dealt: socket.last('imp:solo-dealt') };
  }

  test('keeps every seat on the same role and changes only the word', () => {
    const { socket, dealt } = deal();

    socket.trigger('imp:solo-reroll', {
      names: NAMES, roles: dealt.roles, config: BANK_CONFIG, excludeWord: dealt.secretWord,
    });
    const again = socket.last('imp:solo-dealt');

    expect(again.rerolled).toBe(true);
    expect(again.secretWord).not.toBe(dealt.secretWord);
    expect(again.roles).toEqual(dealt.roles);
    expect(again.deal.map(d => d.name)).toEqual(dealt.deal.map(d => d.name));
  });

  test('rebuilds each card around the new word', () => {
    const { socket, dealt } = deal();
    socket.trigger('imp:solo-reroll', {
      names: NAMES, roles: dealt.roles, config: BANK_CONFIG, excludeWord: dealt.secretWord,
    });
    const again = socket.last('imp:solo-dealt');

    again.deal.forEach(({ name, info }) => {
      const role = again.roles.find(r => r.name === name).role;
      if (role === 'Imposter' || role === 'Double Agent') expect(info.word).toBeNull();
      else if (role === 'Confused') expect(info.word).not.toBe(again.secretWord);
      else expect(info.word).toBe(again.secretWord);
    });
  });

  test('deals a whole fresh game if the roles come back incomplete', () => {
    const { socket, dealt } = deal();
    socket.trigger('imp:solo-reroll', {
      names: NAMES, roles: dealt.roles.slice(0, 2), config: BANK_CONFIG, excludeWord: dealt.secretWord,
    });
    const again = socket.last('imp:solo-dealt');

    expect(again.roles).toHaveLength(NAMES.length);
    expect(again.roles.filter(r => r.role === 'Imposter')).toHaveLength(1);
  });

  test('rejects a table that has shrunk below the minimum', () => {
    const { socket, dealt } = deal();
    socket.trigger('imp:solo-reroll', {
      names: ['Ana', 'Ben'], roles: dealt.roles, config: BANK_CONFIG, excludeWord: dealt.secretWord,
    });
    expect(socket.last('imp:solo-error')).toMatch(/between 4 and 15/);
  });
});
