/**
 * Trivia Night engine — pure game logic, with time passed in explicitly.
 *
 * The buzzer tests are the point of this file: they check that a buzz is
 * ranked by when the player tapped (their clock, converted to server time),
 * not by when the packet happened to arrive, and that the stamp can't be used
 * to jump the gun.
 */
const E = require('../server/trivia/engine');
const { categoryList, questionById, questionsIn } = require('../server/trivia/questions');

function room(config = {}) {
  const r = {
    gameType: 'trivia', code: 'TEST1', hostId: 'host',
    config: E.sanitizeConfig({ mode: 'host', categories: ['geography'], rounds: 2, perRound: 3, ...config }),
    players: [{ id: 'host', name: 'Quizmaster', token: 'th', teamId: null }],
    teams: [], teamSeq: 0, state: 'lobby',
  };
  return r;
}

function seatTeams(r, n = 2) {
  const players = [];
  for (let i = 0; i < n; i++) {
    const p = { id: 'p' + i, name: 'Player' + i, token: 't' + i, teamId: null };
    r.players.push(p);
    const { team } = E.createTeam(r, 'Team ' + i);
    E.setPlayerTeam(r, p, team.id);
    players.push(p);
  }
  return players;
}

describe('question bank', () => {
  test('every question has one answer and three distinct wrong answers', () => {
    for (const c of categoryList()) {
      for (const q of questionsIn(c.id)) {
        expect(q.q).toBeTruthy();
        expect(q.a).toBeTruthy();
        expect(q.wrong).toHaveLength(3);
        expect(new Set([q.a, ...q.wrong]).size).toBe(4);
      }
    }
  });

  test('ids are unique and resolve back to their question', () => {
    const all = categoryList().flatMap(c => questionsIn(c.id));
    expect(new Set(all.map(q => q.id)).size).toBe(all.length);
    all.forEach(q => expect(questionById(q.id)).toBe(q));
  });

  test('spelling questions never show the word on the phone', () => {
    for (const q of questionsIn('spelling')) {
      expect(q.q.toLowerCase()).not.toContain(q.a.toLowerCase());
      expect(q.phoneHostQ.toLowerCase()).not.toContain(q.a.toLowerCase());
      expect(q.hostQ).toContain(q.a);
    }
  });
});

describe('config and plan', () => {
  test('sanitizeConfig clamps everything and drops unknown categories', () => {
    const c = E.sanitizeConfig({ mode: 'nope', categories: ['marvel', 'bogus', 'marvel'], rounds: 99, perRound: -4, seconds: 7 });
    expect(c).toMatchObject({ mode: 'host', categories: ['marvel'], rounds: 8, perRound: 3, seconds: 20 });
  });

  test('no categories means all of them', () => {
    expect(E.sanitizeConfig({}).categories.length).toBe(categoryList().length);
  });

  test('themed rounds cycle through the picks and never repeat a question', () => {
    const cfg = E.sanitizeConfig({ categories: ['marvel', 'science'], rounds: 4, perRound: 5 });
    const plan = E.buildPlan(cfg);
    expect(plan.map(r => r.category)).toEqual(['marvel', 'science', 'marvel', 'science']);
    const ids = plan.flatMap(r => r.questionIds);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
    plan.forEach(r => r.questionIds.forEach(id => expect(questionById(id).category).toBe(r.category)));
  });

  test('a category that runs dry is topped up rather than shortening the round', () => {
    const cfg = E.sanitizeConfig({ categories: ['spelling'], rounds: 3, perRound: 15 });
    const plan = E.buildPlan(cfg);
    const ids = plan.flatMap(r => r.questionIds);
    expect(ids).toHaveLength(45);
    expect(new Set(ids).size).toBe(45);
  });
});

describe('teams', () => {
  test('names are unique, and empty teams disappear in the lobby', () => {
    const r = room();
    const p = { id: 'x', name: 'X', teamId: null };
    r.players.push(p);
    const a = E.createTeam(r, 'Owls').team;
    expect(E.createTeam(r, 'owls').error).toMatch(/taken/);
    E.setPlayerTeam(r, p, a.id);
    const b = E.createTeam(r, '').team;               // falls back to a suggestion
    expect(b.name).toBeTruthy();
    E.setPlayerTeam(r, p, b.id);
    expect(r.teams.map(t => t.id)).toEqual([b.id]);   // Owls emptied and went
  });

  test('at most eight teams', () => {
    const r = room();
    for (let i = 0; i < E.MAX_TEAMS; i++) expect(E.createTeam(r, 'T' + i).team).toBeTruthy();
    expect(E.createTeam(r, 'one too many').error).toBeTruthy();
  });
});

describe('host mode buzzer', () => {
  function atQuestion() {
    const r = room();
    const players = seatTeams(r, 3);
    E.startGame(r, 0);
    E.advance(r, 0);                     // round intro -> question 1
    expect(r.phase).toBe('question');
    return { r, players };
  }

  test('buzzers are locked until the host opens them', () => {
    const { r, players } = atQuestion();
    expect(E.registerBuzz(r, players[0], { openId: r.buzz.openId, at: 10 }, 10).ok).toBe(false);
    expect(E.openBuzzers(r, 1000)).toBe(true);
    expect(E.registerBuzz(r, players[0], { openId: r.buzz.openId, at: 1050 }, 1080).ok).toBe(true);
  });

  test('a buzz carrying an old opening id never counts', () => {
    const { r, players } = atQuestion();
    E.openBuzzers(r, 1000);
    const stale = r.buzz.openId - 1;
    expect(E.registerBuzz(r, players[0], { openId: stale, at: 1050 }, 1080)).toMatchObject({ ok: false, reason: 'closed' });
  });

  test('the earlier tap wins even when it arrives later (skewed, slow connection)', () => {
    const { r, players } = atQuestion();
    const [fastNet, slowNet] = players;
    E.openBuzzers(r, 1000);
    // fastNet taps at 1090 and its packet lands at 1100.
    const a = E.registerBuzz(r, fastNet, { openId: r.buzz.openId, at: 1090 }, 1100);
    expect(a).toMatchObject({ ok: true, first: true });
    // slowNet tapped earlier, at 1060, but its packet only lands at 1300.
    const b = E.registerBuzz(r, slowNet, { openId: r.buzz.openId, at: 1060 }, 1300);
    expect(b).toMatchObject({ ok: true, first: false });
    E.closeBuzzWindow(r);
    expect(r.buzz.answeringTeamId).toBe(slowNet.teamId);
    expect(r.buzz.order.map(o => o.teamId)).toEqual([slowNet.teamId, fastNet.teamId]);
    expect(r.buzz.order[1].delta).toBe(30);
  });

  test('a stamp from before the buzzers opened is pinned to the opening, never earlier', () => {
    const { r, players } = atQuestion();
    E.openBuzzers(r, 1000);
    E.registerBuzz(r, players[0], { openId: r.buzz.openId, at: 700 }, 1040);     // clock error
    E.registerBuzz(r, players[1], { openId: r.buzz.openId, at: 1000 }, 1045);
    expect(r.buzz.candidates[0].t).toBe(1000);
    // Tied on time: arrival order breaks it.
    E.closeBuzzWindow(r);
    expect(r.buzz.answeringTeamId).toBe(players[0].teamId);
  });

  test('a stamp far before the opening is not a tap on this question', () => {
    const { r, players } = atQuestion();
    E.openBuzzers(r, 5000);
    expect(E.registerBuzz(r, players[0], { openId: r.buzz.openId, at: 100 }, 5050)).toMatchObject({ ok: false, reason: 'early' });
  });

  test('a tampered stamp can gain at most the trusted lag', () => {
    const { r, players } = atQuestion();
    E.openBuzzers(r, 1000);
    // Arrives 3s after opening claiming it tapped 1ms after opening.
    E.registerBuzz(r, players[0], { openId: r.buzz.openId, at: 1001 }, 4000);
    expect(r.buzz.candidates[0].t).toBe(4000 - E.MAX_TRUSTED_LAG_MS);
  });

  test('a stamp from the future is capped at arrival', () => {
    const { r, players } = atQuestion();
    E.openBuzzers(r, 1000);
    E.registerBuzz(r, players[0], { openId: r.buzz.openId, at: 99999 }, 1200);
    expect(r.buzz.candidates[0].t).toBe(1200);
  });

  test('no stamp at all falls back to arrival time', () => {
    const { r, players } = atQuestion();
    E.openBuzzers(r, 1000);
    E.registerBuzz(r, players[0], { openId: r.buzz.openId, at: null }, 1234);
    expect(r.buzz.candidates[0].t).toBe(1234);
  });

  test('buzzes after the window closes are turned away', () => {
    const { r, players } = atQuestion();
    E.openBuzzers(r, 1000);
    E.registerBuzz(r, players[0], { openId: r.buzz.openId, at: 1100 }, 1100);
    const late = E.registerBuzz(r, players[1], { openId: r.buzz.openId, at: 1100 }, 1100 + E.BUZZ_WINDOW_MS + 1);
    expect(late).toMatchObject({ ok: false, reason: 'too-late' });
  });

  test('one buzz per team, even from two phones on the same team', () => {
    const { r, players } = atQuestion();
    const teammate = { id: 'mate', name: 'Mate', teamId: players[0].teamId };
    r.players.push(teammate);
    E.openBuzzers(r, 1000);
    expect(E.registerBuzz(r, players[0], { openId: r.buzz.openId, at: 1050 }, 1060).ok).toBe(true);
    expect(E.registerBuzz(r, teammate, { openId: r.buzz.openId, at: 1040 }, 1070)).toMatchObject({ ok: false, reason: 'already' });
  });

  test('once every team has buzzed there is no need to wait out the window', () => {
    const { r, players } = atQuestion();
    E.openBuzzers(r, 1000);
    E.registerBuzz(r, players[0], { openId: r.buzz.openId, at: 1050 }, 1060);
    E.registerBuzz(r, players[1], { openId: r.buzz.openId, at: 1052 }, 1062);
    const last = E.registerBuzz(r, players[2], { openId: r.buzz.openId, at: 1054 }, 1064);
    expect(last.allIn).toBe(true);
  });

  test('correct scores the team and reveals', () => {
    const { r, players } = atQuestion();
    E.openBuzzers(r, 1000);
    E.registerBuzz(r, players[1], { openId: r.buzz.openId, at: 1050 }, 1060);
    E.closeBuzzWindow(r);
    E.judge(r, true, 2000);
    expect(r.phase).toBe('reveal');
    expect(r.teams.find(t => t.id === players[1].teamId).score).toBe(E.POINTS);
    expect(r.roundScores[0][players[1].teamId]).toBe(E.POINTS);
  });

  test('wrong locks that team out and reopens for everyone else', () => {
    const { r, players } = atQuestion();
    E.openBuzzers(r, 1000);
    const firstOpen = r.buzz.openId;
    E.registerBuzz(r, players[0], { openId: firstOpen, at: 1050 }, 1060);
    E.closeBuzzWindow(r);
    E.judge(r, false, 2000);
    expect(r.phase).toBe('question');
    expect(r.buzz.open).toBe(true);
    expect(r.buzz.openId).not.toBe(firstOpen);
    expect(E.registerBuzz(r, players[0], { openId: r.buzz.openId, at: 2100 }, 2100)).toMatchObject({ ok: false, reason: 'locked-out' });
    expect(E.registerBuzz(r, players[1], { openId: r.buzz.openId, at: 2100 }, 2100).ok).toBe(true);
  });

  test('when every team has missed, the answer is revealed with no winner', () => {
    const { r, players } = atQuestion();
    for (const p of players) {
      E.openBuzzers(r, 1000);
      E.registerBuzz(r, p, { openId: r.buzz.openId, at: null }, 1100);
      E.closeBuzzWindow(r);
      E.judge(r, false, 1200);
    }
    expect(r.phase).toBe('reveal');
    expect(r.result.correctTeamIds).toEqual([]);
    expect(r.result.wrongTeamIds).toHaveLength(3);
    expect(r.teams.every(t => t.score === 0)).toBe(true);
  });

  test('host can fix a score by hand', () => {
    const { r, players } = atQuestion();
    expect(E.adjustScore(r, players[0].teamId, 50)).toBe(true);
    expect(E.adjustScore(r, players[0].teamId, 'x')).toBe(false);
    expect(E.adjustScore(r, 'nope', 50)).toBe(false);
    expect(r.teams[0].score).toBe(50);
  });
});

describe('flow', () => {
  test('advance walks intro → questions → round end → … → game over', () => {
    const r = room({ rounds: 2, perRound: 3 });
    seatTeams(r, 2);
    E.startGame(r, 0);
    const seen = [r.phase];
    let guard = 0;
    while (r.phase !== 'game-over' && guard++ < 50) { E.advance(r, 0); seen.push(r.phase); }
    expect(seen).toEqual([
      'round-intro', 'question', 'reveal', 'question', 'reveal', 'question', 'reveal',
      'round-end', 'round-intro', 'question', 'reveal', 'question', 'reveal', 'question', 'reveal',
      'game-over',
    ]);
    expect(E.advance(r, 0)).toBe(false);
  });

  test('play again returns to the lobby with the teams kept and scores cleared', () => {
    const r = room();
    seatTeams(r, 2);
    E.startGame(r, 0);
    r.teams[0].score = 300;
    E.endGameEarly(r, 0);
    E.resetToLobby(r);
    expect(r.state).toBe('lobby');
    expect(r.teams).toHaveLength(2);
    expect(r.teams.every(t => t.score === 0)).toBe(true);
  });
});

describe('auto mode', () => {
  function atQuestion() {
    const r = room({ mode: 'auto', seconds: 20 });
    const players = seatTeams(r, 2);
    E.startGame(r, 0);
    expect(r.phaseEndsAt).toBe(E.ROUND_INTRO_MS);
    E.advance(r, 1000);
    expect(r.phase).toBe('question');
    expect(r.phaseEndsAt).toBe(1000 + 20000);
    return { r, players };
  }

  test('first tap per team is the answer; the rest are refused', () => {
    const { r, players } = atQuestion();
    const mate = { id: 'mate', name: 'Mate', teamId: players[0].teamId };
    r.players.push(mate);
    expect(E.submitAnswer(r, players[0], 2, 2000).ok).toBe(true);
    expect(E.submitAnswer(r, mate, 1, 2100)).toMatchObject({ ok: false, reason: 'already' });
    expect(r.answers[players[0].teamId].choice).toBe(2);
  });

  test('bad choices and late answers are refused', () => {
    const { r, players } = atQuestion();
    expect(E.submitAnswer(r, players[0], 7, 2000).ok).toBe(false);
    expect(E.submitAnswer(r, players[0], 'a', 2000).ok).toBe(false);
    expect(E.submitAnswer(r, players[0], 0, 1000 + 20000 + 1000)).toMatchObject({ ok: false, reason: 'too-late' });
  });

  test('all teams in resolves; faster correct answers earn a bigger bonus', () => {
    const { r, players } = atQuestion();
    const right = r.current.correctIndex;
    const wrong = (right + 1) % 4;
    E.submitAnswer(r, players[0], right, 1000);            // instantly
    const res = E.submitAnswer(r, players[1], wrong, 5000);
    expect(res.allIn).toBe(true);
    E.resolveAutoQuestion(r, 5000);
    expect(r.phase).toBe('reveal');
    expect(r.result.gained[players[0].teamId]).toBe(E.POINTS + E.SPEED_BONUS);
    expect(r.result.byTeam[players[1].teamId]).toMatchObject({ correct: false, points: 0 });
    expect(r.teams.find(t => t.id === players[1].teamId).score).toBe(0);
  });

  test('a correct answer at the buzzer still scores the base points', () => {
    const { r, players } = atQuestion();
    E.submitAnswer(r, players[0], r.current.correctIndex, r.phaseEndsAt);
    E.resolveAutoQuestion(r, r.phaseEndsAt);
    expect(r.result.gained[players[0].teamId]).toBe(E.POINTS);
  });

  test('choices are the answer plus the three wrong ones, shuffled', () => {
    const { r } = atQuestion();
    const q = questionById(r.current.id);
    expect([...r.current.choices].sort()).toEqual([q.a, ...q.wrong].sort());
    expect(r.current.choices[r.current.correctIndex]).toBe(q.a);
  });
});
