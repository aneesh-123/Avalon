// The "Ask a question" helper answers from a curated list, so these pin the
// questions players actually ask (including dictation slips) to the right answer.
const { create } = require('../public/ask.js');
const { ENTRIES, suggest, whatNow, myRoleAnswer, countIn } = require('../public/avalon-help.js');

const ask = create({ entries: ENTRIES, context: () => ({}) });
const match = q => ask.match(q)?.id || null;

describe('Avalon ask helper', () => {
  test.each([
    ['how do I win', 'win'],
    ['how do you play', 'round'],
    ['explain the game', 'round'],
    ["I don't understand", 'round'],
    ['what does percival do', 'role-percival'],
    ['what does marlin do', 'role-merlin'],
    ['whats the assassin', 'role-assassin'],
    ['what is a minion', 'role-minion-of-mordred'],
    ['what is the untrustworthy servant', 'role-untrustworthy-servant'],
    ['can good players fail', 'can-good-fail'],
    ['why is my fail button greyed out', 'can-good-fail'],
    ['what happens if the team gets rejected', 'rejected'],
    ['how many evil players', 'how-many-evil'],
    ['can I lie', 'lying'],
    ['what is the lady of the lake', 'lady'],
    ['who picks the team', 'leader'],
    ['who goes first', 'leader'],
    ['how many people go on the quest', 'team-size'],
    ['what if my phone dies', 'rejoin'],
    ['how many people do I need', 'players'],
    ['how does voting work', 'vote'],
    ['tips for evil', 'evil-tips'],
    ['how do I not get caught as merlin', 'merlin-tips'],
    ['what should I do now', 'now'],
    ['what is my role', 'my-role'],
    ['who is evil', 'who-evil'],
    ['quest 4 needs two fails?', 'two-fails'],
    ['what happens at the end', 'assassination'],
    ['can the leader change the team', 'withdraw'],
    ['is there a timer', 'clock'],
    ['what is the proper amount of players', 'setup'],
    ['recommended setup for 8 players', 'setup'],
    ['how many good and bad people', 'setup'],
    ['what are the denominations for each round', 'setup'],
    ['how many people go on each round', 'team-size'],
    ['how many fails does a quest need', 'two-fails'],
  ])('%s → %s', (q, id) => expect(match(q)).toBe(id));

  test('gibberish gets no answer rather than a wrong one', () => {
    expect(match('banana')).toBeNull();
  });

  test('every related link points at a real entry', () => {
    const ids = new Set(ENTRIES.map(e => e.id));
    for (const e of ENTRIES) for (const r of e.related) expect(ids).toContain(r);
    expect(ids.size).toBe(ENTRIES.length);
  });

  test('every entry has an answer outside a game', () => {
    for (const e of ENTRIES) expect(ask.answer(e)).toBeTruthy();
  });

  test('"what now" reads the phase and whose turn it is', () => {
    const state = {
      phase: 'team-select', leaderId: 'me', leaderName: 'Ann', currentCampaign: 0,
      campaignsConfig: [{ teamSize: 2, failsNeeded: 1 }], proposedTeam: [],
    };
    expect(whatNow({ inGame: true, state, myId: 'me' })).toMatch(/You're the leader.*\*\*2\*\*/);
    expect(whatNow({ inGame: true, state, myId: 'x' })).toMatch(/Ann/);

    const quest = { ...state, phase: 'quest-vote', proposedTeam: ['me'] };
    expect(whatNow({ inGame: true, state: quest, myId: 'me', role: { role: 'Merlin', isEvil: false } }))
      .toMatch(/only play \*\*Pass\*\*/);
    expect(whatNow({ inGame: true, state: quest, myId: 'me', role: { role: 'Lunatic', isEvil: true } }))
      .toMatch(/must play \*\*Fail\*\*/);
    expect(whatNow({ inGame: true, state: { ...state, phase: 'team-vote', consecutiveRejections: 4 }, myId: 'x' }))
      .toMatch(/5th vote/);
  });

  test('"my role" only repeats what the player\'s own card shows', () => {
    const a = myRoleAnswer({ role: { role: 'Merlin', isEvil: false, known: [{ name: 'Dan', label: 'evil' }] } });
    expect(a).toMatch(/You are \*\*Merlin\*\*/);
    expect(a).toMatch(/Dan \(evil\)/);
    expect(myRoleAnswer({})).toBeNull();
  });

  test('suggestions change with the phase', () => {
    expect(suggest({ inGame: false })).toContain('round');
    expect(suggest({ inGame: true, state: { phase: 'team-vote' }, role: { isEvil: true } }))
      .toEqual(expect.arrayContaining(['now', 'vote', 'evil-tips']));
  });

  describe('recommended setup', () => {
    const entry = ENTRIES.find(e => e.id === 'setup');
    const setupAsk = count => create({ entries: ENTRIES, context: () => ({ setupCount: count }) });

    test('answers for the count being set up', () => {
      const a = setupAsk(7).answer(entry, '');
      expect(a).toMatch(/\*\*7 players\*\*/);
      expect(a).toMatch(/4 Good\*\* vs 💀 \*\*3 Evil/);
      expect(a).toMatch(/2 · 3 · 3 · 4 · 4/);
      expect(a).toMatch(/quest 4 needs 2 Fails/);
    });

    test('a count in the question wins, in digits or words', () => {
      expect(setupAsk(7).answer(entry, 'setup for 5 players')).toMatch(/3 Good.*2 Evil[\s\S]*2 · 3 · 2 · 3 · 3[\s\S]*One Fail sinks any quest/);
      expect(setupAsk(null).answer(entry, 'what about ten people')).toMatch(/6 Good.*4 Evil/);
      expect(countIn('eight of us')).toBe(8);
      expect(countIn('how many evil')).toBeNull();
    });

    test('without a count it lists every size; outside 5-10 it says so', () => {
      const all = setupAsk(null).answer(entry, '');
      for (const n of [5, 6, 7, 8, 9, 10]) expect(all).toContain(`**${n}:**`);
      expect(setupAsk(null).answer(entry, 'setup for 12')).toMatch(/5 to 10 players/);
    });
  });
});
