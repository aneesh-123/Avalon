/**
 * The Council — rules, without sockets. Roles are random, so every test reads
 * who is a traitor or the leader from the room rather than assuming it.
 */
const E = require('../server/council/engine');
const { viewFor } = require('../server/council/state');

function room(n = 5) {
  return {
    gameType: 'council', code: 'TEST1', hostId: 's0', state: 'lobby', phase: null, game: null,
    players: Array.from({ length: n }, (_, i) => ({ pid: 'p' + i, id: 's' + i, name: 'P' + i, token: 't' + i, role: null })),
  };
}

function started(n = 5) {
  const r = room(n);
  E.startGame(r);
  r.players.forEach(p => E.markReady(r, p.pid));
  E.beginRound(r);
  return r;
}

const loyal = r => r.players.filter(p => p.role === 'loyal');
const traitor = r => r.players.find(p => p.role === 'traitor');

// The leader proposes `option` with `partner`, and everyone votes `approve`.
function propose(r, option, partner, approve = true) {
  const leader = E.leaderPid(r);
  const res = E.propose(r, leader, { option, partner });
  expect(res.ok).toBe(true);
  r.players.forEach(p => E.castVote(r, p.pid, approve));
  expect(E.voteComplete(r, r.players.map(p => p.pid))).toBe(true);
  return E.resolveVote(r);
}

describe('setup', () => {
  test('needs 5 to 10 players', () => {
    expect(E.startGame(room(4)).error).toMatch(/at least 5/);
    expect(E.startGame(room(11)).error).toMatch(/At most 10/);
  });

  test.each([[5, 2], [6, 2], [7, 3], [9, 3], [10, 4]])('%i players get %i traitors', (n, t) => {
    const r = room(n);
    E.startGame(r);
    expect(r.players.filter(p => p.role === 'traitor')).toHaveLength(t);
    expect(r.game.gold).toBe(5);
    expect(r.game.people).toBe(5);
    expect(r.phase).toBe('roles');
  });

  test('round 1 starts once everyone has seen their role', () => {
    const r = room(5);
    E.startGame(r);
    r.players.slice(0, 4).forEach(p => E.markReady(r, p.pid));
    expect(E.allReady(r)).toBe(false);
    E.markReady(r, 'p4');
    expect(E.allReady(r)).toBe(true);
    E.beginRound(r);
    expect(r.phase).toBe('propose');
    expect(r.game.round).toBe(1);
    expect(E.SIDES).toContain(r.game.trap);
    expect(r.game.whispers).toHaveLength(2);
  });
});

describe('a round', () => {
  test('only the leader can propose, and not with themselves', () => {
    const r = started();
    const leader = E.leaderPid(r);
    const other = r.players.find(p => p.pid !== leader).pid;
    expect(E.propose(r, other, { option: 'gold', partner: leader }).error).toMatch(/leader/);
    expect(E.propose(r, leader, { option: 'gold', partner: leader }).error).toMatch(/partner/);
    expect(E.propose(r, leader, { option: 'silver', partner: other }).error).toMatch(/Gold or People/);
  });

  test('a clean plan on the safe answer costs exactly 1', () => {
    const r = started();
    const safe = r.game.trap === 'gold' ? 'people' : 'gold';
    const leader = E.leaderPid(r);
    const partner = r.players.find(p => p.pid !== leader).pid;
    expect(propose(r, safe, partner).passed).toBe(true);
    E.act(r, leader, 'help'); E.act(r, partner, 'help');
    expect(E.actsComplete(r)).toBe(true);
    E.resolveActs(r);
    expect(r.game.result).toMatchObject({ amount: 1, trapped: false, sabotages: 0 });
    expect(r.game[safe]).toBe(4);
    expect(r.phase).toBe('result');
  });

  test('the trap costs 1 extra and a sabotage 2 extra', () => {
    const r = started();
    const t = traitor(r);
    // Make the traitor the leader, so they are on the plan.
    r.game.leaderIndex = r.game.order.indexOf(t.pid);
    const partner = loyal(r)[0].pid;
    propose(r, r.game.trap, partner);
    E.act(r, t.pid, 'sabotage'); E.act(r, partner, 'help');
    E.resolveActs(r);
    expect(r.game.result).toMatchObject({ amount: 4, trapped: true, sabotages: 1 });
    expect(r.game[r.game.trap]).toBe(1);
  });

  test('loyal players cannot sabotage, even if they ask to', () => {
    const r = started();
    const l = loyal(r);
    r.game.leaderIndex = r.game.order.indexOf(l[0].pid);
    const safe = r.game.trap === 'gold' ? 'people' : 'gold';
    propose(r, safe, l[1].pid);
    E.act(r, l[0].pid, 'sabotage'); E.act(r, l[1].pid, 'sabotage');
    E.resolveActs(r);
    expect(r.game.result.sabotages).toBe(0);
    expect(r.game.result.amount).toBe(1);
  });

  test('a tie fails, passes the lead on, and three failures panic the kingdom', () => {
    const r = started(6);
    const first = E.leaderPid(r);
    for (let i = 0; i < 2; i++) {
      const leader = E.leaderPid(r);
      E.propose(r, leader, { option: 'gold', partner: r.players.find(p => p.pid !== leader).pid });
      r.players.forEach((p, k) => E.castVote(r, p.pid, k < 3));   // 3–3
      expect(E.resolveVote(r).passed).toBe(false);
      expect(r.phase).toBe('propose');
    }
    expect(E.leaderPid(r)).not.toBe(first);
    const res = propose(r, 'gold', r.players.find(p => p.pid !== E.leaderPid(r)).pid, false);
    expect(res.panic).toBe(true);
    expect(r.game).toMatchObject({ gold: 4, people: 4 });
    expect(r.game.result.kind).toBe('panic');
    expect(r.phase).toBe('result');
  });
});

describe('winning', () => {
  test('loyal win after round 5 with both above 0', () => {
    const r = started();
    for (let round = 1; round <= 5; round++) {
      const safe = r.game.trap === 'gold' ? 'people' : 'gold';
      // Spread the cost so neither side runs dry.
      const side = r.game[safe] > 1 ? safe : (safe === 'gold' ? 'people' : 'gold');
      const leader = E.leaderPid(r);
      const partner = r.players.find(p => p.pid !== leader).pid;
      propose(r, side, partner);
      E.act(r, leader, 'help'); E.act(r, partner, 'help');
      E.resolveActs(r);
      expect(r.game.round).toBe(round);
      E.nextRound(r);
    }
    expect(r.phase).toBe('game-over');
    expect(r.game.winner).toBe('loyal');
  });

  test('traitors win the moment a side hits 0', () => {
    const r = started();
    r.game.gold = 2;
    const t = traitor(r);
    r.game.leaderIndex = r.game.order.indexOf(t.pid);
    propose(r, 'gold', loyal(r)[0].pid);
    E.act(r, t.pid, 'sabotage'); E.act(r, loyal(r)[0].pid, 'help');
    E.resolveActs(r);
    expect(r.game.gold).toBe(0);
    expect(r.game.winner).toBe('traitors');
    expect(r.game.endReason).toBe('gold');
    E.nextRound(r);
    expect(r.phase).toBe('game-over');
  });
});

describe('views', () => {
  test('secrets only reach the right phone', () => {
    const r = started(7);
    const live = new Set(r.players.map(p => p.id));
    const t = traitor(r);
    const l = loyal(r)[0];
    const tv = viewFor(r, t, live), lv = viewFor(r, l, live);
    expect(tv.you.role).toBe('traitor');
    expect(tv.you.allies).toHaveLength(2);
    expect(lv.you.role).toBe('loyal');
    expect(lv.you.allies).toBeUndefined();
    // Nobody sees anyone's role mid-game.
    expect(lv.players.every(p => p.role === null)).toBe(true);
    // Whispers go only to the chosen few, and they are true.
    const whispered = r.players.filter(p => viewFor(r, p, live).whisper);
    expect(whispered.map(p => p.pid).sort()).toEqual([...r.game.whispers].sort());
    whispered.forEach(p => expect(viewFor(r, p, live).whisper.trap).toBe(r.game.trap));
    r.players.filter(p => !r.game.whispers.includes(p.pid))
      .forEach(p => expect(JSON.stringify(viewFor(r, p, live))).not.toContain('"trap"'));
  });

  test('roles are revealed at the end', () => {
    const r = started();
    r.game.people = 1;
    const leader = E.leaderPid(r);
    const partner = r.players.find(p => p.pid !== leader).pid;
    propose(r, 'people', partner);
    E.act(r, leader, 'help'); E.act(r, partner, 'help');
    E.resolveActs(r);
    E.nextRound(r);
    const v = viewFor(r, r.players[0], new Set());
    expect(v.winner).toBe('traitors');
    expect(v.roleList).toHaveLength(5);
    expect(v.players.every(p => p.role)).toBe(true);
  });
});
