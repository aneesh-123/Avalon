/**
 * Head to Head engine: scoring, the clock, and the question packs.
 * Question order and option order are random, so every check reads the right
 * answer from the room rather than assuming it.
 */
const E = require('../server/h2h/engine');
const Q = require('../server/h2h/questions');

function room(category = 'us-states') {
  return {
    code: 'TEST1', state: 'lobby', phase: null, game: null, category, seen: [],
    players: [{ pid: 'a', name: 'Ana', score: 0 }, { pid: 'b', name: 'Ben', score: 0 }],
  };
}

function toQuestion(r, t0 = 0) {
  E.startMatch(r, t0);
  E.tick(r, t0 + E.T.INTRO_MS);
  return t0 + E.T.INTRO_MS;
}

describe('question packs', () => {
  test('every pack has enough well-formed questions for a match', () => {
    for (const c of Q.categoryList()) {
      const qs = Q.questionsIn(c.id);
      expect(qs.length).toBeGreaterThanOrEqual(E.QUESTIONS);
      for (const q of qs) {
        expect(typeof q.q).toBe('string');
        expect(q.wrong).toHaveLength(3);
        expect(new Set([q.a, ...q.wrong]).size).toBe(4);   // no duplicate options
      }
    }
  });
  test('question ids are unique', () => {
    const ids = Q.questionsIn('mixed').map(q => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  test('the requested packs are there', () => {
    const ids = Q.categoryList().map(c => c.id);
    ['mixed', 'harry-potter', 'pokemon', 'us-states', 'flags'].forEach(id => expect(ids).toContain(id));
  });
});

describe('match flow', () => {
  test('needs two players to start', () => {
    const r = room();
    r.players.pop();
    expect(E.startMatch(r).error).toBeTruthy();
  });

  test('right and fast scores more than right and slow; wrong scores nothing', () => {
    const r = room();
    const t = toQuestion(r);
    const q = r.game.questions[0];
    expect(E.answer(r, 'a', q.answer, 500, t + 500)).toBe(true);
    expect(E.answer(r, 'b', q.answer, 8000, t + 8000)).toBe(true);
    const { a, b } = r.game.answers;
    expect(a.points).toBeGreaterThan(b.points);
    expect(a.points).toBeLessThanOrEqual(E.BASE_POINTS + E.SPEED_POINTS);
    expect(b.points).toBeGreaterThanOrEqual(E.BASE_POINTS);

    const r2 = room();
    const t2 = toQuestion(r2);
    const q2 = r2.game.questions[0];
    E.answer(r2, 'a', (q2.answer + 1) % 4, 100, t2 + 100);
    expect(r2.game.answers.a.points).toBe(0);
  });

  test('a player answers once, and not after the buzzer', () => {
    const r = room();
    const t = toQuestion(r);
    expect(E.answer(r, 'a', 0, 100, t + 100)).toBe(true);
    expect(E.answer(r, 'a', 1, 200, t + 200)).toBe(false);
    expect(E.answer(r, 'b', 0, 100, t + E.T.ANSWER_MS + 5000)).toBe(false);
  });

  test('the phone’s timing is trusted only within what the server saw', () => {
    const r = room();
    const t = toQuestion(r);
    // Claims an instant answer five seconds in: clamped to the lag allowance.
    E.answer(r, 'a', r.game.questions[0].answer, 0, t + 5000);
    expect(r.game.answers.a.ms).toBeGreaterThanOrEqual(3500);
  });

  test('both answering ends the question early; the clock ends it otherwise', () => {
    const r = room();
    const t = toQuestion(r);
    E.answer(r, 'a', 0, 100, t + 100);
    expect(E.settle(r, t + 100)).toBe(false);
    E.answer(r, 'b', 1, 100, t + 100);
    expect(E.settle(r, t + 100)).toBe(true);
    expect(r.phase).toBe('reveal');

    const r2 = room();
    const t2 = toQuestion(r2);
    expect(E.tick(r2, t2 + E.T.ANSWER_MS - 1)).toBe(false);
    expect(E.tick(r2, t2 + E.T.ANSWER_MS)).toBe(true);
    expect(r2.phase).toBe('reveal');
    expect(r2.game.history[0].picks.a.choice).toBe(null);
  });

  test('a full match: the last question counts double and the winner is the higher score', () => {
    const r = room();
    let t = toQuestion(r);
    for (let i = 0; i < E.QUESTIONS; i++) {
      const q = r.game.questions[r.game.index];
      E.answer(r, 'a', q.answer, 1000, t + 1000);
      E.answer(r, 'b', (q.answer + 1) % 4, 1000, t + 1000);
      E.settle(r, t + 1000);
      if (i === E.QUESTIONS - 1) expect(r.game.answers.a.points).toBe(E.pointsFor(1000, true));
      t += 1000 + E.T.REVEAL_MS;
      E.tick(r, t);
    }
    expect(r.phase).toBe('game-over');
    expect(r.game.winner).toBe('a');
    expect(r.players[1].score).toBe(0);
  });

  test('a tie is a tie', () => {
    const r = room();
    let t = toQuestion(r);
    while (r.phase !== 'game-over') { t += 60000; E.tick(r, t); }
    expect(r.game.winner).toBe('tie');
  });

  test('a rematch prefers questions not just played', () => {
    const r = room('flags');
    E.startMatch(r, 0);
    const first = new Set(r.game.questions.map(q => q.id));
    E.resetToLobby(r);
    E.startMatch(r, 0);
    expect(r.game.questions.some(q => first.has(q.id))).toBe(false);
  });

  test('category changes only in the lobby, and only to a real pack', () => {
    const r = room();
    expect(E.setCategory(r, 'nope')).toBe(false);
    expect(E.setCategory(r, 'pokemon')).toBe(true);
    E.startMatch(r, 0);
    expect(E.setCategory(r, 'space')).toBe(false);
  });
});
