/**
 * Pass-and-play (one phone) role dealing.
 *
 * There is no lobby and no room: the whole deal is returned to the single
 * requesting socket, because that device IS the shared device everyone looks at
 * in turn. That makes the usual "never send a player another player's card"
 * rule inapplicable here — but everything else still has to hold, especially
 * that the deal itself is server-side and validated the same way online games
 * are.
 */

const { impRooms } = require('../server/imposter/rooms');
const registerImposterHandlers = require('../server/imposter/handlers');
const { makeIo, connectSocket } = require('./helpers');

jest.mock('../server/db', () => ({
  saveRoom:   () => Promise.resolve(),
  deleteRoom: () => Promise.resolve(),
  loadRooms:  () => Promise.resolve([]),
}));

let io;
beforeEach(() => {
  Object.keys(impRooms).forEach(k => delete impRooms[k]);
  ({ io } = makeIo());
  registerImposterHandlers(io);
});

const FIVE = ['Aneesh', 'Sam', 'Priya', 'Marco', 'Jo'];

function deal(names = FIVE, config = {}) {
  const s = connectSocket(io, 'host');
  s.trigger('imp:solo-deal', { names, config: { imposterCount: 1, ...config } });
  return s;
}

describe('imp:solo-deal', () => {
  test('deals one card per player, in the order given', () => {
    const s = deal();
    const { deal: cards } = s.last('imp:solo-dealt');

    expect(cards.map(c => c.name)).toEqual(FIVE);
  });

  test('gives every regular the same word and the imposter none', () => {
    const s = deal();
    const { deal: cards, secretWord } = s.last('imp:solo-dealt');

    const withWord = cards.filter(c => c.info.word);
    const without  = cards.filter(c => !c.info.word);
    expect(without).toHaveLength(1);
    expect(withWord).toHaveLength(4);
    withWord.forEach(c => expect(c.info.word).toBe(secretWord));
    expect(without[0].info.team).toBe('imposter');
  });

  test('deals the requested number of imposters', () => {
    const s = deal(FIVE, { imposterCount: 2 });
    const { roles } = s.last('imp:solo-dealt');

    expect(roles.filter(r => r.role === 'Imposter')).toHaveLength(2);
  });

  test('imposters are not told who the other imposters are', () => {
    const s = deal(FIVE, { imposterCount: 2, impostersKnowEachOther: false });
    const { deal: cards, roles } = s.last('imp:solo-dealt');

    const imposterNames = roles.filter(r => r.role === 'Imposter').map(r => r.name);
    cards.filter(c => c.info.team === 'imposter').forEach(card => {
      const others = imposterNames.filter(n => n !== card.name);
      others.forEach(n => expect(card.info.extra || '').not.toContain(n));
    });
  });

  test('includes enabled special roles', () => {
    const s = deal(FIVE, { specialRoles: { detective: true } });
    const { roles } = s.last('imp:solo-dealt');

    expect(roles.filter(r => r.role === 'Detective')).toHaveLength(1);
  });

  test('returns the word and every role for the end-of-game reveal', () => {
    const s = deal();
    const { secretWord, roles } = s.last('imp:solo-dealt');

    expect(typeof secretWord).toBe('string');
    expect(secretWord.length).toBeGreaterThan(0);
    expect(roles).toHaveLength(5);
    roles.forEach(r => expect(typeof r.role).toBe('string'));
  });

  test('stores no room — there is nothing to reconnect to', () => {
    deal();

    expect(Object.keys(impRooms)).toHaveLength(0);
  });

  test.each([
    ['too few players', ['A', 'B', 'C'], /at least 4/i],
    ['too many players', Array.from({ length: 16 }, (_, i) => 'P' + i), /at most 15/i],
  ])('rejects %s', (_label, names, pattern) => {
    const s = deal(names);

    expect(s.last('imp:solo-dealt')).toBeUndefined();
    expect(s.last('imp:solo-error')).toMatch(pattern);
  });

  test('trims and de-duplicates names before counting them', () => {
    const s = deal(['  Sam  ', 'sam', 'Priya', 'Marco', 'Jo', '', '   ']);
    const { deal: cards } = s.last('imp:solo-dealt');

    expect(cards.map(c => c.name)).toEqual(['Sam', 'Priya', 'Marco', 'Jo']);
  });

  test('rejects a role split the regular team cannot outnumber', () => {
    const s = deal(['A', 'B', 'C', 'D'], { imposterCount: 2 });

    expect(s.last('imp:solo-error')).toMatch(/outnumber/i);
    expect(s.last('imp:solo-dealt')).toBeUndefined();
  });

  test('hiding the category strips it from every card', () => {
    const s = deal(FIVE, { categoryVisible: false });
    const { deal: cards, category } = s.last('imp:solo-dealt');

    expect(category).toBeNull();
    cards.forEach(c => expect(c.info.category).toBeNull());
  });

  test('the Confused player is handed a different word, as online', () => {
    const s = deal([...FIVE, 'Kim', 'Lee'], { specialRoles: { confused: true } });
    const { deal: cards, roles, secretWord } = s.last('imp:solo-dealt');

    const confusedName = roles.find(r => r.role === 'Confused').name;
    const card = cards.find(c => c.name === confusedName);
    expect(card.info.word).not.toBe(secretWord);
    expect(card.info.displayRole).toBe('Regular Player');   // still lied to
  });
});
