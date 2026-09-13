// Clocktower engine tests — Phase 0.
//
// Characters are dealt at random, so anything that depends on a specific
// layout re-assigns characters after setupGame() and rebuilds the night queue.

jest.mock('../server/db', () => ({
  saveRoom:   () => Promise.resolve(),
  deleteRoom: () => Promise.resolve(),
}));

const { botcRooms } = require('../server/botc/rooms');
const { CHARACTERS, COUNTS } = require('../server/botc/characters');
const { botcGameState } = require('../server/botc/state');
const engine = require('../server/botc/engine');

function makeRoom(names) {
  const room = {
    code: 'TEST1', gameType: 'botc', hostId: 'p0', playerCount: names.length,
    players: names.map((n, i) => ({ id: `p${i}`, name: n, token: `t${i}`, ready: true })),
    state: 'lobby',
  };
  botcRooms[room.code] = room;
  return room;
}

// Force a known character layout, keeping seats and the rest of setup intact.
// believedCharacter tracks the truth unless a test is deliberately about the
// Drunk, who is the only character where the two ever differ.
function setCharacters(room, chars) {
  room.players.forEach((p, i) => {
    p.character = chars[i];
    p.alignment = CHARACTERS[chars[i]].alignment;
    p.believedCharacter = chars[i];
  });
}

const P5 = ['Ana', 'Ben', 'Cara', 'Dan', 'Eve'];

afterEach(() => { Object.keys(botcRooms).forEach(k => delete botcRooms[k]); });

describe('setup', () => {
  test('deals the Trouble Brewing composition for every supported count', () => {
    for (let n = 5; n <= 9; n++) {
      const room = makeRoom(P5.concat(['Fay', 'Gus', 'Hal', 'Ivy']).slice(0, n));
      engine.setupGame(room);

      let [tf, out, min, dem] = COUNTS[n];
      const count = team => room.players.filter(p => CHARACTERS[p.character].team === team).length;

      // The Baron legitimately swaps two Townsfolk for two Outsiders.
      if (room.players.some(p => p.character === 'Baron')) {
        const shift = Math.min(2, tf);
        out += shift; tf -= shift;
      }

      expect(count('townsfolk')).toBe(tf);
      expect(count('outsider')).toBe(out);
      expect(count('minion')).toBe(min);
      expect(count('demon')).toBe(dem);
      expect(new Set(room.players.map(p => p.character)).size).toBe(n); // no duplicates
      delete botcRooms[room.code];
    }
  });

  test('gives the Demon exactly three bluffs, none of them in play', () => {
    const room = makeRoom(P5);
    engine.setupGame(room);
    const inPlay = new Set(room.players.map(p => p.character));
    expect(room.bluffs).toHaveLength(3);
    room.bluffs.forEach(b => expect(inPlay.has(b)).toBe(false));
  });

  test('everyone starts alive with an unspent ghost vote', () => {
    const room = makeRoom(P5);
    engine.setupGame(room);
    expect(room.players.every(p => p.alive && !p.ghostVoteUsed)).toBe(true);
  });
});

describe('first night', () => {
  test('evil learns each other and good does not', () => {
    const room = makeRoom(P5);
    engine.setupGame(room);
    setCharacters(room, ['Empath', 'Chef', 'Soldier', 'Scarlet Woman', 'Imp']);
    engine.beginNight(room);
    engine.advanceNight(room);

    const sw  = room.info['p3'].map(i => i.text).join(' ');
    const imp = room.info['p4'].map(i => i.text).join(' ');
    expect(sw).toContain('The Demon is Eve');
    expect(imp).toContain('Your Minions: Dan');
    // A Townsfolk never learns who is evil from setup.
    expect((room.info['p2'] || []).map(i => i.text).join(' ')).not.toContain('Demon');
  });

  test('Empath counts evil among living neighbours', () => {
    const room = makeRoom(P5);
    engine.setupGame(room);
    // Seats: Ana(Empath) sits between Eve(Imp) and Ben(Chef) — one evil.
    setCharacters(room, ['Empath', 'Chef', 'Soldier', 'Scarlet Woman', 'Imp']);
    engine.beginNight(room);
    engine.advanceNight(room);
    expect(room.info['p0'].pop().text).toBe('Living neighbours who are evil: 1.');
  });

  test('Chef counts adjacent evil pairs around the circle', () => {
    const room = makeRoom(P5);
    engine.setupGame(room);
    // Dan and Eve are adjacent and both evil — exactly one pair.
    setCharacters(room, ['Empath', 'Chef', 'Soldier', 'Scarlet Woman', 'Imp']);
    engine.beginNight(room);
    engine.advanceNight(room);
    expect(room.info['p1'].pop().text).toBe('Pairs of evil players sitting next to each other: 1.');
  });

  test('nobody dies on the first night', () => {
    const room = makeRoom(P5);
    engine.setupGame(room);
    setCharacters(room, ['Empath', 'Chef', 'Soldier', 'Scarlet Woman', 'Imp']);
    engine.beginNight(room);
    engine.advanceNight(room);
    expect(room.players.every(p => p.alive)).toBe(true);
  });
});

describe('night actions', () => {
  function nightTwo(room, chars) {
    engine.setupGame(room);
    setCharacters(room, chars);
    engine.beginNight(room);          // night 1
    engine.advanceNight(room);
    engine.beginDay(room);
    engine.beginNight(room);          // night 2
    return engine.advanceNight(room);
  }

  test('the Imp kills, and only the acting player is prompted', () => {
    const room = makeRoom(P5);
    const res = nightTwo(room, ['Empath', 'Chef', 'Soldier', 'Scarlet Woman', 'Imp']);
    expect(res).toBe('awaiting');
    expect(room.night.awaiting.playerId).toBe('p4');

    // The prompt reaches the Imp and nobody else.
    expect(botcGameState(room, 'p4').prompt).not.toBeNull();
    expect(botcGameState(room, 'p0').prompt).toBeNull();

    engine.applyNightChoice(room, 'p4', 'p1');
    expect(room.players.find(p => p.id === 'p1').alive).toBe(false);
  });

  test('the Soldier survives the Demon', () => {
    const room = makeRoom(P5);
    nightTwo(room, ['Empath', 'Chef', 'Soldier', 'Scarlet Woman', 'Imp']);
    engine.applyNightChoice(room, 'p4', 'p2');   // p2 is the Soldier
    expect(room.players.find(p => p.id === 'p2').alive).toBe(true);
  });

  test('the Monk protects their target', () => {
    const room = makeRoom(P5);
    const res = nightTwo(room, ['Monk', 'Chef', 'Empath', 'Scarlet Woman', 'Imp']);
    expect(res).toBe('awaiting');
    expect(room.night.awaiting.playerId).toBe('p0');   // Monk acts before the Imp
    engine.applyNightChoice(room, 'p0', 'p1');         // protect Ben
    engine.advanceNight(room);
    engine.applyNightChoice(room, 'p4', 'p1');         // Imp targets Ben
    expect(room.players.find(p => p.id === 'p1').alive).toBe(true);
  });

  test('the Ravenkeeper wakes on death and learns a character', () => {
    const room = makeRoom(P5);
    nightTwo(room, ['Ravenkeeper', 'Chef', 'Soldier', 'Scarlet Woman', 'Imp']);
    engine.applyNightChoice(room, 'p4', 'p0');         // Imp kills the Ravenkeeper
    expect(engine.advanceNight(room)).toBe('awaiting');
    expect(room.night.awaiting.playerId).toBe('p0');
    engine.applyNightChoice(room, 'p0', 'p4');
    expect(room.info['p0'].pop().text).toBe('Eve is the Imp.');
  });
});

describe('nominations and voting', () => {
  function atDay(room) {
    engine.setupGame(room);
    setCharacters(room, ['Empath', 'Chef', 'Soldier', 'Scarlet Woman', 'Imp']);
    engine.beginNight(room);
    engine.advanceNight(room);
    engine.beginDay(room);
  }

  test('a player may nominate once and be nominated once per day', () => {
    const room = makeRoom(P5);
    atDay(room);
    expect(engine.nominate(room, 'p0', 'p1')).toBeNull();
    engine.resolveNomination(room);
    expect(engine.nominate(room, 'p0', 'p2')).toMatch(/already nominated/);
    expect(engine.nominate(room, 'p2', 'p1')).toMatch(/already been nominated/);
  });

  test('reaching the threshold puts the nominee on the block', () => {
    const room = makeRoom(P5);
    atDay(room);
    engine.nominate(room, 'p0', 'p4');
    ['p0', 'p1', 'p2'].forEach(id => engine.castNominationVote(room, id, true));
    ['p3', 'p4'].forEach(id => engine.castNominationVote(room, id, false));
    const res = engine.resolveNomination(room);
    expect(res.yes).toBe(3);
    expect(res.threshold).toBe(3);          // ceil(5/2)
    expect(room.onTheBlock.playerId).toBe('p4');
  });

  test('falling short of the threshold leaves the block empty', () => {
    const room = makeRoom(P5);
    atDay(room);
    engine.nominate(room, 'p0', 'p4');
    engine.castNominationVote(room, 'p0', true);
    ['p1', 'p2', 'p3', 'p4'].forEach(id => engine.castNominationVote(room, id, false));
    engine.resolveNomination(room);
    expect(room.onTheBlock).toBeNull();
  });

  test('a tie clears the block rather than executing either player', () => {
    const room = makeRoom(P5);
    atDay(room);
    engine.nominate(room, 'p0', 'p4');
    ['p0', 'p1', 'p2'].forEach(id => engine.castNominationVote(room, id, true));
    ['p3', 'p4'].forEach(id => engine.castNominationVote(room, id, false));
    engine.resolveNomination(room);

    engine.nominate(room, 'p1', 'p3');
    ['p0', 'p1', 'p2'].forEach(id => engine.castNominationVote(room, id, true));
    ['p3', 'p4'].forEach(id => engine.castNominationVote(room, id, false));
    const res = engine.resolveNomination(room);
    expect(res.outcome).toMatch(/tied/);
    expect(room.onTheBlock).toBeNull();
  });

  test('the dead keep exactly one vote', () => {
    const room = makeRoom(P5);
    atDay(room);
    const ghost = room.players.find(p => p.id === 'p1');
    ghost.alive = false;

    engine.nominate(room, 'p0', 'p4');
    expect(engine.castNominationVote(room, 'p1', true)).toBe(true);
    expect(ghost.ghostVoteUsed).toBe(true);
    engine.resolveNomination(room);

    engine.nominate(room, 'p2', 'p3');
    expect(engine.castNominationVote(room, 'p1', true)).toBe(false);   // spent
  });
});

describe('win conditions', () => {
  function atDay(room, chars) {
    engine.setupGame(room);
    setCharacters(room, chars);
    engine.beginNight(room);
    engine.advanceNight(room);
    engine.beginDay(room);
  }

  test('executing the Demon wins the game for good', () => {
    const room = makeRoom(P5);
    atDay(room, ['Empath', 'Chef', 'Soldier', 'Saint', 'Imp']);
    room.onTheBlock = { playerId: 'p4', name: 'Eve', votes: 3 };
    engine.endDay(room);
    expect(engine.checkWin(room)).toBe(true);
    expect(room.winner).toBe('good');
  });

  test('executing the Saint loses the game for good', () => {
    const room = makeRoom(P5);
    atDay(room, ['Empath', 'Chef', 'Soldier', 'Saint', 'Imp']);
    room.onTheBlock = { playerId: 'p3', name: 'Dan', votes: 3 };
    engine.endDay(room);
    expect(engine.checkWin(room)).toBe(true);
    expect(room.winner).toBe('evil');
  });

  test('evil wins once only two players remain', () => {
    const room = makeRoom(P5);
    atDay(room, ['Empath', 'Chef', 'Soldier', 'Scarlet Woman', 'Imp']);
    ['p0', 'p1'].forEach(id => { room.players.find(p => p.id === id).alive = false; });
    room.onTheBlock = { playerId: 'p2', name: 'Cara', votes: 3 };
    engine.endDay(room);
    expect(engine.checkWin(room)).toBe(true);
    expect(room.winner).toBe('evil');
  });

  // The threshold counts the Demon that is dying: at exactly 5 alive including
  // the Demon, the Scarlet Woman inherits and the game continues.
  test('the Scarlet Woman inherits when the Demon dies with 5 alive', () => {
    const room = makeRoom(P5);
    atDay(room, ['Empath', 'Chef', 'Soldier', 'Scarlet Woman', 'Imp']);

    room.onTheBlock = { playerId: 'p4', name: 'Eve', votes: 3 };
    engine.endDay(room);

    expect(room.players.find(p => p.id === 'p3').character).toBe('Imp');
    expect(engine.checkWin(room)).toBe(false);        // the Demon lives on
    expect(room.executedToday.character).toBe('Imp'); // Undertaker still sees the truth
  });

  test('the Scarlet Woman does not inherit below 5 alive', () => {
    const room = makeRoom(P5);
    atDay(room, ['Empath', 'Chef', 'Soldier', 'Scarlet Woman', 'Imp']);
    room.players.find(p => p.id === 'p0').alive = false;   // 4 alive now

    room.onTheBlock = { playerId: 'p4', name: 'Eve', votes: 3 };
    engine.endDay(room);

    expect(room.players.find(p => p.id === 'p3').character).toBe('Scarlet Woman');
    expect(engine.checkWin(room)).toBe(true);
    expect(room.winner).toBe('good');
  });
});

describe('information privacy', () => {
  test("a player's state never carries anyone else's character", () => {
    const room = makeRoom(P5);
    engine.setupGame(room);
    setCharacters(room, ['Empath', 'Chef', 'Soldier', 'Scarlet Woman', 'Imp']);
    engine.beginNight(room);
    engine.advanceNight(room);
    engine.beginDay(room);

    const view = botcGameState(room, 'p0');
    expect(view.you.character).toBe('Empath');
    expect(view.players.every(p => p.character === null)).toBe(true);
    expect(view.you.info).toEqual(room.info['p0']);
  });

  test('characters are revealed to everyone once the game ends', () => {
    const room = makeRoom(P5);
    engine.setupGame(room);
    setCharacters(room, ['Empath', 'Chef', 'Soldier', 'Saint', 'Imp']);
    room.phase = 'game-over';
    const view = botcGameState(room, 'p0');
    expect(view.players.every(p => p.character !== null)).toBe(true);
  });
});
