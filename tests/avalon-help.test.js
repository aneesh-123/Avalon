// The "Ask a question" helper answers from a curated list, so these pin the
// questions players actually ask (including dictation slips) to the right answer.
const { create } = require('../public/ask.js');
const { ENTRIES, suggest, whatNow, myRoleAnswer } = require('../public/avalon-help.js');

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
});
