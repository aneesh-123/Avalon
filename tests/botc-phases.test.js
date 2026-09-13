// Clocktower — impairment, registration, and the day-triggered characters.
//
// Kept separate from botc.test.js, which covers the deterministic core. These
// are the parts where the server is actively lying or resolving "might".

jest.mock('../server/db', () => ({
  saveRoom:   () => Promise.resolve(),
  deleteRoom: () => Promise.resolve(),
}));

const { botcRooms } = require('../server/botc/rooms');
const { CHARACTERS, COUNTS } = require('../server/botc/characters');
const { botcGameState, botcGrimoire } = require('../server/botc/state');
const engine = require('../server/botc/engine');

function makeRoom(names) {
  const room = {
    code: 'PHASE', gameType: 'botc', hostId: 'p0', playerCount: names.length,
    players: names.map((n, i) => ({ id: `p${i}`, name: n, token: `t${i}`, ready: true })),
    state: 'lobby',
  };
  botcRooms[room.code] = room;
  return room;
}

// believedCharacter tracks the truth unless a test is deliberately about the
// Drunk — the only character where the two ever differ.
function setCharacters(room, chars) {
  room.players.forEach((p, i) => {
    p.character = chars[i];
    p.alignment = CHARACTERS[chars[i]].alignment;
    p.believedCharacter = chars[i];
  });
  room.fakeBoards = {};
}

const P5 = ['Ana', 'Ben', 'Cara', 'Dan', 'Eve'];
const infoOf = (room, id) => (room.info[id] || []).map(i => i.text);
const realBoard = room => ({ map: engine.trueBoard(room), real: true });

afterEach(() => { Object.keys(botcRooms).forEach(k => delete botcRooms[k]); });

// ── Phase 1: impairment and the lie engine ────────────────────────────────

describe('the lie engine', () => {
  function firstNight(room, chars) {
    engine.setupGame(room);
    setCharacters(room, chars);
    engine.beginNight(room);
    return engine.advanceNight(room);
  }

  test('a poisoned player is still woken and still told something', () => {
    const room = makeRoom(P5);
    const res = firstNight(room, ['Empath', 'Chef', 'Soldier', 'Poisoner', 'Imp']);
    expect(res).toBe('awaiting');
    expect(room.night.awaiting.playerId).toBe('p3');        // Poisoner wakes first
    engine.applyNightChoice(room, 'p3', 'p0');              // poison the Empath
    engine.advanceNight(room);
    expect(room.players.find(p => p.id === 'p0').statuses.poisoned).toBe(true);
    expect(infoOf(room, 'p0')).toHaveLength(1);
  });

  test('a poisoned reading is a legal answer, not garbage', () => {
    const room = makeRoom(P5);
    firstNight(room, ['Empath', 'Chef', 'Soldier', 'Poisoner', 'Imp']);
    engine.applyNightChoice(room, 'p3', 'p0');
    engine.advanceNight(room);
    expect(infoOf(room, 'p0').pop()).toMatch(/^Living neighbours who are evil: [012]\.$/);
  });

  test('the fake board has the same composition as the real one', () => {
    const room = makeRoom(P5);
    firstNight(room, ['Empath', 'Chef', 'Soldier', 'Poisoner', 'Imp']);
    engine.applyNightChoice(room, 'p3', 'p0');
    engine.advanceNight(room);
    const fake = room.fakeBoards['p0'];
    expect(Object.values(fake).sort()).toEqual(room.players.map(p => p.character).sort());
  });

  test('the fake board is cached, so lies stay coherent across nights', () => {
    const room = makeRoom(P5);
    firstNight(room, ['Empath', 'Chef', 'Soldier', 'Poisoner', 'Imp']);
    engine.applyNightChoice(room, 'p3', 'p0');
    engine.advanceNight(room);
    const night1 = { ...room.fakeBoards['p0'] };

    engine.beginDay(room);
    engine.beginNight(room);
    engine.advanceNight(room);
    engine.applyNightChoice(room, 'p3', 'p0');              // poisoned again
    engine.advanceNight(room);

    expect(room.fakeBoards['p0']).toEqual(night1);
  });

  test('poison wears off at the start of the next night', () => {
    const room = makeRoom(P5);
    firstNight(room, ['Empath', 'Chef', 'Soldier', 'Poisoner', 'Imp']);
    engine.applyNightChoice(room, 'p3', 'p0');
    engine.advanceNight(room);
    engine.beginDay(room);
    engine.beginNight(room);
    const empath = room.players.find(p => p.id === 'p0');
    expect(empath.statuses.poisoned).toBe(false);
    expect(engine.abilityWorking(room, empath)).toBe(true);
  });

  test('the Drunk is shown a Townsfolk and never told otherwise', () => {
    const room = makeRoom(P5.concat(['Fay']));
    engine.setupGame(room);
    setCharacters(room, ['Drunk', 'Chef', 'Soldier', 'Poisoner', 'Imp', 'Empath']);
    const drunk = room.players.find(p => p.id === 'p0');
    drunk.believedCharacter = 'Washerwoman';

    const view = botcGameState(room, 'p0');
    expect(view.you.character).toBe('Washerwoman');
    expect(view.you.alignment).toBe('good');
    expect(engine.abilityWorking(room, drunk)).toBe(false);
  });

  test('setupGame gives a dealt Drunk a believed Townsfolk that is out of play', () => {
    for (let i = 0; i < 80; i++) {
      const room = makeRoom(P5.concat(['Fay', 'Gus', 'Hal', 'Ivy']));
      engine.setupGame(room);
      const drunk = room.players.find(p => p.character === 'Drunk');
      if (!drunk) { delete botcRooms[room.code]; continue; }
      expect(CHARACTERS[drunk.believedCharacter].team).toBe('townsfolk');
      expect(room.players.map(p => p.character)).not.toContain(drunk.believedCharacter);
      return;
    }
  });

  test('the grimoire exposes the impairment a player cannot see', () => {
    const room = makeRoom(P5);
    firstNight(room, ['Empath', 'Chef', 'Soldier', 'Poisoner', 'Imp']);
    engine.applyNightChoice(room, 'p3', 'p0');
    engine.advanceNight(room);

    const grim = botcGrimoire(room);
    const empath = grim.players.find(p => p.name === 'Ana');
    expect(empath.poisoned).toBe(true);
    expect(empath.abilityWorking).toBe(false);
    expect(empath.fakeBoard).not.toBeNull();
    // The player's own view gives no hint at all.
    expect(JSON.stringify(botcGameState(room, 'p0'))).not.toContain('poison');
  });
});

// ── Phase 2: registration ─────────────────────────────────────────────────

describe('registration', () => {
  test('a misregistering Recluse reads as a Minion', () => {
    const room = makeRoom(P5);
    engine.setupGame(room);
    setCharacters(room, ['Investigator', 'Recluse', 'Soldier', 'Scarlet Woman', 'Imp']);
    room.registration = { recluseMisregisters: true, recluseAs: 'Poisoner', spyMisregisters: false, spyAs: 'Chef' };
    expect(engine.registeredCharacter(room, 'p1', realBoard(room))).toBe('Poisoner');
  });

  test('a truthful Recluse reads as themselves', () => {
    const room = makeRoom(P5);
    engine.setupGame(room);
    setCharacters(room, ['Investigator', 'Recluse', 'Soldier', 'Scarlet Woman', 'Imp']);
    room.registration = { recluseMisregisters: false, recluseAs: 'Poisoner', spyMisregisters: false, spyAs: 'Chef' };
    expect(engine.registeredCharacter(room, 'p1', realBoard(room))).toBe('Recluse');
  });

  test('a misregistering Spy reads as good', () => {
    const room = makeRoom(P5);
    engine.setupGame(room);
    setCharacters(room, ['Empath', 'Chef', 'Soldier', 'Spy', 'Imp']);
    room.registration = { recluseMisregisters: false, recluseAs: 'Imp', spyMisregisters: true, spyAs: 'Chef' };
    expect(engine.registeredCharacter(room, 'p3', realBoard(room))).toBe('Chef');
  });

  test('the Fortune Teller takes two picks and pings on the red herring', () => {
    const room = makeRoom(P5);
    engine.setupGame(room);
    setCharacters(room, ['Fortune Teller', 'Chef', 'Soldier', 'Scarlet Woman', 'Imp']);
    room.redHerring = 'p1';                                  // a good player
    engine.beginNight(room);
    engine.advanceNight(room);
    expect(room.night.awaiting.type).toBe('fortune');
    expect(room.night.awaiting.picks).toBe(2);

    engine.applyNightChoice(room, 'p0', ['p1', 'p2']);
    expect(infoOf(room, 'p0').pop()).toContain('One of them is the Demon');
  });

  test('the Fortune Teller rejects a single pick', () => {
    const room = makeRoom(P5);
    engine.setupGame(room);
    setCharacters(room, ['Fortune Teller', 'Chef', 'Soldier', 'Scarlet Woman', 'Imp']);
    engine.beginNight(room);
    engine.advanceNight(room);
    expect(engine.applyNightChoice(room, 'p0', ['p1'])).toBe(false);
    expect(engine.applyNightChoice(room, 'p0', ['p1', 'p1'])).toBe(false);
  });

  test('the Spy sees the whole grimoire', () => {
    const room = makeRoom(P5);
    engine.setupGame(room);
    setCharacters(room, ['Empath', 'Chef', 'Soldier', 'Spy', 'Imp']);
    engine.beginNight(room);
    engine.advanceNight(room);
    const spy = infoOf(room, 'p3').join(' ');
    expect(spy).toContain('The Grimoire');
    expect(spy).toContain('Eve: Imp');
  });
});

// ── Phase 3: day-triggered characters ─────────────────────────────────────

describe('day-triggered characters', () => {
  function atDay(room, chars) {
    engine.setupGame(room);
    setCharacters(room, chars);
    engine.beginNight(room);
    engine.advanceNight(room);
    engine.beginDay(room);
  }

  test('the Virgin executes a Townsfolk nominator, once', () => {
    const room = makeRoom(P5);
    atDay(room, ['Virgin', 'Chef', 'Soldier', 'Scarlet Woman', 'Imp']);
    engine.nominate(room, 'p1', 'p0');
    expect(room.players.find(p => p.id === 'p1').alive).toBe(false);
    expect(room.phase).toBe('day');                          // no vote happens
    expect(room.virginUsed).toBe(true);
  });

  test('the Virgin does nothing against an evil nominator', () => {
    const room = makeRoom(P5);
    atDay(room, ['Virgin', 'Chef', 'Soldier', 'Scarlet Woman', 'Imp']);
    engine.nominate(room, 'p3', 'p0');
    expect(room.players.find(p => p.id === 'p3').alive).toBe(true);
    expect(room.phase).toBe('nomination');
  });

  test('a poisoned Virgin does not fire', () => {
    const room = makeRoom(P5);
    atDay(room, ['Virgin', 'Chef', 'Soldier', 'Poisoner', 'Imp']);
    room.players.find(p => p.id === 'p0').statuses.poisoned = true;
    engine.nominate(room, 'p1', 'p0');
    expect(room.players.find(p => p.id === 'p1').alive).toBe(true);
    expect(room.phase).toBe('nomination');
  });

  test('the Slayer kills the Demon, and only once', () => {
    const room = makeRoom(P5);
    atDay(room, ['Slayer', 'Chef', 'Soldier', 'Scarlet Woman', 'Imp']);
    expect(engine.slay(room, 'p0', 'p4')).toBeNull();
    expect(room.players.find(p => p.id === 'p4').alive).toBe(false);
    expect(engine.slay(room, 'p0', 'p3')).toMatch(/already used/);
  });

  test('the Slayer shooting a non-Demon does nothing', () => {
    const room = makeRoom(P5);
    atDay(room, ['Slayer', 'Chef', 'Soldier', 'Scarlet Woman', 'Imp']);
    engine.slay(room, 'p0', 'p1');
    expect(room.players.find(p => p.id === 'p1').alive).toBe(true);
  });

  test('a poisoned Slayer misses the Demon', () => {
    const room = makeRoom(P5);
    atDay(room, ['Slayer', 'Chef', 'Soldier', 'Poisoner', 'Imp']);
    room.players.find(p => p.id === 'p0').statuses.poisoned = true;
    engine.slay(room, 'p0', 'p4');
    expect(room.players.find(p => p.id === 'p4').alive).toBe(true);
  });

  test('the Mayor wins on three alive with no execution', () => {
    const room = makeRoom(P5);
    atDay(room, ['Mayor', 'Chef', 'Soldier', 'Scarlet Woman', 'Imp']);
    ['p1', 'p2'].forEach(id => { room.players.find(p => p.id === id).alive = false; });
    engine.endDay(room);
    expect(engine.checkWin(room)).toBe(true);
    expect(room.winner).toBe('good');
    expect(room.winReason).toMatch(/Mayor/);
  });

  test('the Mayor does not win if someone was executed', () => {
    const room = makeRoom(P5);
    atDay(room, ['Mayor', 'Chef', 'Soldier', 'Scarlet Woman', 'Imp']);
    room.players.find(p => p.id === 'p1').alive = false;
    room.onTheBlock = { playerId: 'p2', name: 'Cara', votes: 2 };
    engine.endDay(room);
    engine.checkWin(room);
    expect(room.winner).not.toBe('good');
  });

  test('the Butler may not vote yes without their master', () => {
    const room = makeRoom(P5);
    atDay(room, ['Butler', 'Chef', 'Soldier', 'Scarlet Woman', 'Imp']);
    room.players.find(p => p.id === 'p0').statuses.master = 'p1';
    engine.nominate(room, 'p1', 'p2');
    expect(engine.castNominationVote(room, 'p0', true)).toBe(false);   // master hasn't voted
    engine.castNominationVote(room, 'p1', true);
    expect(engine.castNominationVote(room, 'p0', true)).toBe(true);
  });
});

// ── Setup ─────────────────────────────────────────────────────────────────

describe('setup across the full range', () => {
  test('the Baron adds two Outsiders at the expense of Townsfolk', () => {
    for (let i = 0; i < 300; i++) {
      const room = makeRoom(P5.concat(['Fay', 'Gus', 'Hal', 'Ivy']));
      engine.setupGame(room);
      const teams = t => room.players.filter(p => CHARACTERS[p.character].team === t).length;
      if (room.players.some(p => p.character === 'Baron')) {
        const [tf, out] = COUNTS[9];
        expect(teams('outsider')).toBe(out + 2);
        expect(teams('townsfolk')).toBe(tf - 2);
        return;
      }
      delete botcRooms[room.code];
    }
    throw new Error('Baron never dealt in 300 setups');
  });

  test('every count from 5 to 15 deals a full, duplicate-free board', () => {
    const NAMES = 'ABCDEFGHIJKLMNO'.split('');
    for (let n = 5; n <= 15; n++) {
      const room = makeRoom(NAMES.slice(0, n));
      engine.setupGame(room);
      expect(room.players.every(p => !!p.character)).toBe(true);
      expect(new Set(room.players.map(p => p.character)).size).toBe(n);
      expect(room.players.filter(p => CHARACTERS[p.character].team === 'demon')).toHaveLength(1);
      delete botcRooms[room.code];
    }
  });
});
