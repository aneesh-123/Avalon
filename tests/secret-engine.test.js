/**
 * Rules engine for the Secret Hitler game mode. Roles are dealt at random, so
 * every test reads who is who from the room rather than assuming a seat.
 */
const E = require('../server/secret/engine');

function makeRoom(n) {
  const room = { code: 'TEST1', state: 'lobby', players: [] };
  for (let i = 0; i < n; i++) room.players.push({ id: 's' + i, name: 'P' + i, token: 't' + i });
  E.startGame(room);
  room.players.forEach((_, i) => E.markReady(room, i));
  return room;
}

const seatOf = (room, role) => room.players.findIndex(p => p.role === role);
const allVote = (room, ja) => E.aliveSeats(room).forEach(s => E.castVote(room, s, ja));

// Elect the current president with the first eligible chancellor (or `chancellor`).
function elect(room, chancellor) {
  const g = room.g;
  const c = chancellor ?? E.eligibleChancellors(room)[0];
  expect(E.nominate(room, g.president, c)).toBe(true);
  allVote(room, true);
  return c;
}

// Run a full legislative session that enacts `policy`, rigging the draw.
function passPolicy(room, policy, chancellor) {
  const g = room.g;
  const other = policy === 'liberal' ? 'fascist' : 'liberal';
  g.deck.unshift(policy, other, other);
  const c = elect(room, chancellor);
  if (g.phase === 'over') return c;
  expect(g.phase).toBe('president-discard');
  E.presidentDiscard(room, g.president, g.hand.indexOf(other));
  E.chancellorEnact(room, c, g.hand.indexOf(policy));
  return c;
}

function failElection(room) {
  const g = room.g;
  E.nominate(room, g.president, E.eligibleChancellors(room)[0]);
  allVote(room, false);
}

describe('setup', () => {
  test.each([[5, 3, 1], [6, 4, 1], [7, 4, 2], [8, 5, 2], [9, 5, 3], [10, 6, 3]])(
    '%i players: %i liberals, %i fascists and Hitler', (n, libs, fas) => {
      const room = makeRoom(n);
      const count = r => room.players.filter(p => p.role === r).length;
      expect(count('liberal')).toBe(libs);
      expect(count('fascist')).toBe(fas);
      expect(count('hitler')).toBe(1);
      expect(room.g.deck.length).toBe(17);
      expect(room.g.deck.filter(c => c === 'liberal').length).toBe(6);
    });

  test('refuses fewer than five or more than ten', () => {
    for (const n of [4, 11]) {
      const room = { players: Array.from({ length: n }, (_, i) => ({ id: 'x' + i, name: 'N' + i })) };
      expect(E.startGame(room)).toBe(false);
    }
  });

  test('play starts once everyone has seen their role', () => {
    const room = { code: 'R', state: 'lobby', players: Array.from({ length: 5 }, (_, i) => ({ id: 'x' + i, name: 'N' + i })) };
    E.startGame(room);
    expect(room.g.phase).toBe('reveal');
    for (let i = 0; i < 4; i++) E.markReady(room, i);
    expect(room.g.phase).toBe('reveal');
    E.markReady(room, 4);
    expect(room.g.phase).toBe('nominate');
  });
});

describe('who knows whom', () => {
  test('5–6 players: fascist and Hitler know each other, liberals know nobody', () => {
    const room = makeRoom(6);
    const h = seatOf(room, 'hitler'), f = seatOf(room, 'fascist'), l = seatOf(room, 'liberal');
    expect(E.knownTo(room, f)).toEqual([{ seat: h, role: 'hitler' }]);
    expect(E.knownTo(room, h)).toEqual([{ seat: f, role: 'fascist' }]);
    expect(E.knownTo(room, l)).toEqual([]);
  });

  test('7+ players: fascists see Hitler and each other, Hitler sees nobody', () => {
    const room = makeRoom(7);
    const h = seatOf(room, 'hitler'), f = seatOf(room, 'fascist');
    expect(E.knownTo(room, h)).toEqual([]);
    const seen = E.knownTo(room, f);
    expect(seen).toHaveLength(2);
    expect(seen.some(x => x.seat === h && x.role === 'hitler')).toBe(true);
  });
});

describe('elections', () => {
  test('a tie fails; a majority passes', () => {
    const room = makeRoom(6);
    const g = room.g;
    E.nominate(room, g.president, E.eligibleChancellors(room)[0]);
    E.aliveSeats(room).forEach((s, i) => E.castVote(room, s, i % 2 === 0));
    expect(g.lastVote.passed).toBe(false);
    expect(g.tracker).toBe(1);
    expect(g.phase).toBe('nominate');
  });

  test('the presidency passes to the left after a failed vote', () => {
    const room = makeRoom(5);
    const first = room.g.president;
    failElection(room);
    expect(room.g.president).toBe((first + 1) % 5);
  });

  test('last elected president and chancellor are term-limited; with 5 alive only the chancellor', () => {
    const room = makeRoom(7);
    const g = room.g;
    const pres = g.president;
    const chanc = passPolicy(room, 'liberal');
    expect(g.phase).toBe('nominate');
    const el = E.eligibleChancellors(room);
    expect(el).not.toContain(pres);
    expect(el).not.toContain(chanc);
    expect(el).not.toContain(g.president);

    const five = makeRoom(5);
    const p5 = five.g.president;
    const c5 = passPolicy(five, 'liberal');
    const el5 = E.eligibleChancellors(five);
    expect(el5).not.toContain(c5);
    if (five.g.president !== p5) expect(el5).toContain(p5);
  });

  test('a failed vote does not change term limits', () => {
    const room = makeRoom(7);
    const chanc = passPolicy(room, 'liberal');
    failElection(room);
    expect(E.eligibleChancellors(room)).not.toContain(chanc);
  });

  test('nominating an ineligible player is refused', () => {
    const room = makeRoom(5);
    const g = room.g;
    expect(E.nominate(room, g.president, g.president)).toBe(false);
    expect(E.nominate(room, (g.president + 1) % 5, (g.president + 2) % 5)).toBe(false);   // not the president
    expect(E.nominate(room, g.president, 99)).toBe(false);
  });

  test('dead players cannot vote and are not counted', () => {
    const room = makeRoom(5);
    room.players[(room.g.president + 1) % 5].alive = false;
    const g = room.g;
    E.nominate(room, g.president, E.eligibleChancellors(room)[0]);
    expect(E.castVote(room, (g.president + 1) % 5, true)).toBe(false);
    allVote(room, true);
    expect(g.phase).toBe('president-discard');
  });
});

describe('election tracker and chaos', () => {
  test('three failed governments enact the top policy, reset the tracker and term limits', () => {
    const room = makeRoom(7);
    const g = room.g;
    passPolicy(room, 'liberal');
    expect(g.lastElected).not.toBeNull();
    g.deck.unshift('fascist');
    failElection(room); failElection(room);
    expect(g.tracker).toBe(2);
    failElection(room);
    expect(g.tracker).toBe(0);
    expect(g.fascist).toBe(1);
    expect(g.lastElected).toBeNull();
    expect(g.lastEvent).toMatchObject({ t: 'enacted', policy: 'fascist', chaos: true });
  });

  test('a policy forced by chaos grants no power', () => {
    const room = makeRoom(9);             // first fascist policy would investigate
    const g = room.g;
    g.deck.unshift('fascist');
    failElection(room); failElection(room); failElection(room);
    expect(g.fascist).toBe(1);
    expect(g.phase).toBe('nominate');
    expect(g.power).toBeNull();
  });

  test('a successful enactment resets the tracker', () => {
    const room = makeRoom(5);
    failElection(room); failElection(room);
    passPolicy(room, 'liberal');
    expect(room.g.tracker).toBe(0);
  });
});

describe('legislative session', () => {
  test('president discards one of three, chancellor enacts one of two, the rest are discarded', () => {
    const room = makeRoom(5);
    const g = room.g;
    g.deck.unshift('liberal', 'fascist', 'fascist');
    const c = elect(room);
    expect(g.hand).toEqual(['liberal', 'fascist', 'fascist']);
    expect(E.chancellorEnact(room, c, 0)).toBe(false);   // not their turn yet
    E.presidentDiscard(room, g.president, 1);
    expect(g.hand).toEqual(['liberal', 'fascist']);
    E.chancellorEnact(room, c, 0);
    expect(g.liberal).toBe(1);
    expect(g.discard).toEqual(['fascist', 'fascist']);
  });

  test('the discard pile is shuffled back in when fewer than three cards remain', () => {
    const room = makeRoom(5);
    const g = room.g;
    g.discard = g.deck.splice(3);          // leave three: after this session none
    expect(g.deck.length).toBe(3);
    const total = g.deck.length + g.discard.length;
    elect(room);
    E.presidentDiscard(room, g.president, 0);
    E.chancellorEnact(room, g.chancellor, 0);
    expect(g.deck.length + g.discard.length + g.liberal + g.fascist).toBe(total);
    expect(g.deck.length).toBeGreaterThanOrEqual(3);
    expect(g.discard).toEqual([]);
  });
});

describe('powers', () => {
  test('track by player count', () => {
    expect(E.powerTrack(5)).toEqual([null, null, 'peek', 'execute', 'execute']);
    expect(E.powerTrack(8)).toEqual([null, 'investigate', 'special', 'execute', 'execute']);
    expect(E.powerTrack(10)).toEqual(['investigate', 'investigate', 'special', 'execute', 'execute']);
  });

  test('peek shows the president the top three, then moves on', () => {
    const room = makeRoom(5);
    const g = room.g;
    g.fascist = 2;
    // Avoid Hitler as chancellor, which would end the game at three fascist policies.
    const c = E.eligibleChancellors(room).find(s => room.players[s].role !== 'hitler');
    passPolicy(room, 'fascist', c);
    expect(g.phase).toBe('power');
    expect(g.power.type).toBe('peek');
    expect(g.power.cards).toEqual(g.deck.slice(0, 3));
    const pres = g.president;
    expect(E.powerDone(room, pres)).toBe(true);
    expect(g.phase).toBe('nominate');
    expect(g.president).not.toBe(pres);
  });

  test('investigate reveals party (Hitler shows fascist) and a player cannot be investigated twice', () => {
    const room = makeRoom(9);
    const g = room.g;
    passPolicy(room, 'fascist');
    expect(g.power.type).toBe('investigate');
    const pres = g.president;
    const h = seatOf(room, 'hitler');
    const target = h !== pres ? h : E.powerTargets(room)[0];
    E.usePower(room, pres, target);
    expect(g.power.result).toBe(E.partyOf(room.players[target].role));
    if (target === h) expect(g.power.result).toBe('fascist');
    E.powerDone(room, pres);
    passPolicy(room, 'fascist');
    expect(g.power.type).toBe('investigate');
    expect(E.powerTargets(room)).not.toContain(target);
  });

  test('special election: chosen player is president, then rotation resumes left of the caller', () => {
    const room = makeRoom(7);
    const g = room.g;
    g.fascist = 2;
    const c = E.eligibleChancellors(room).find(s => room.players[s].role !== 'hitler');
    passPolicy(room, 'fascist', c);
    expect(g.power.type).toBe('special');
    const caller = g.president;
    const pick = (caller + 3) % 7;
    E.usePower(room, caller, pick);
    expect(g.president).toBe(pick);
    failElection(room);
    expect(g.president).toBe((caller + 1) % 7);
  });

  test('executing Hitler wins for the liberals; executing anyone else removes them', () => {
    const room = makeRoom(5);
    const g = room.g;
    g.fascist = 3;
    g.lastElected = null;
    const c = E.eligibleChancellors(room).find(s => room.players[s].role !== 'hitler');
    passPolicy(room, 'fascist', c);
    expect(g.power.type).toBe('execute');
    const h = seatOf(room, 'hitler');
    if (h === g.president) {
      const victim = E.powerTargets(room)[0];
      E.usePower(room, g.president, victim);
      expect(room.players[victim].alive).toBe(false);
      expect(g.phase).toBe('nominate');
      expect(E.aliveSeats(room)).not.toContain(victim);
    } else {
      E.usePower(room, g.president, h);
      expect(g.phase).toBe('over');
      expect(g.winner).toBe('liberal');
      expect(g.winReason).toBe('hitler-executed');
    }
  });
});

describe('veto', () => {
  function toVeto() {
    const room = makeRoom(5);
    const g = room.g;
    g.fascist = 5;
    g.deck.unshift('fascist', 'fascist', 'liberal');
    const c = E.eligibleChancellors(room).find(s => room.players[s].role !== 'hitler');
    elect(room, c);
    E.presidentDiscard(room, g.president, 2);
    return { room, g, c };
  }

  test('only unlocked at five fascist policies', () => {
    const room = makeRoom(5);
    const g = room.g;
    const c = elect(room);
    E.presidentDiscard(room, g.president, 0);
    expect(E.proposeVeto(room, c)).toBe(false);
  });

  test('accepted veto discards both and advances the tracker', () => {
    const { room, g, c } = toVeto();
    expect(E.proposeVeto(room, c)).toBe(true);
    E.answerVeto(room, g.president, true);
    expect(g.tracker).toBe(1);
    expect(g.fascist).toBe(5);
    expect(g.phase).toBe('nominate');
  });

  test('declined veto: the chancellor must enact and cannot ask again', () => {
    const { room, g, c } = toVeto();
    E.proposeVeto(room, c);
    E.answerVeto(room, g.president, false);
    expect(g.phase).toBe('chancellor-enact');
    expect(E.proposeVeto(room, c)).toBe(false);
    E.chancellorEnact(room, c, 0);
    expect(g.phase).toBe('over');
    expect(g.winner).toBe('fascist');
  });
});

describe('winning', () => {
  test('five liberal policies', () => {
    const room = makeRoom(5);
    room.g.liberal = 4;
    passPolicy(room, 'liberal');
    expect(room.g.winner).toBe('liberal');
    expect(room.g.winReason).toBe('policies');
  });

  test('six fascist policies', () => {
    const room = makeRoom(5);
    room.g.fascist = 5;
    const c = E.eligibleChancellors(room).find(s => room.players[s].role !== 'hitler');
    passPolicy(room, 'fascist', c);
    expect(room.g.winner).toBe('fascist');
  });

  test('Hitler elected chancellor after three fascist policies', () => {
    const room = makeRoom(5);
    const g = room.g;
    g.fascist = 3;
    const h = seatOf(room, 'hitler');
    while (!E.eligibleChancellors(room).includes(h)) { g.tracker = 0; failElection(room); }
    g.tracker = 0;
    E.nominate(room, g.president, h);
    allVote(room, true);
    expect(g.winner).toBe('fascist');
    expect(g.winReason).toBe('hitler-elected');
  });

  test('Hitler elected chancellor before three fascist policies is just a government', () => {
    const room = makeRoom(5);
    const g = room.g;
    g.fascist = 2;
    const h = seatOf(room, 'hitler');
    while (!E.eligibleChancellors(room).includes(h)) { g.tracker = 0; failElection(room); }
    g.tracker = 0;
    E.nominate(room, g.president, h);
    allVote(room, true);
    expect(g.phase).toBe('president-discard');
  });
});
