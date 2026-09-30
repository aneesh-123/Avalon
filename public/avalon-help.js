// avalon-help.js — Avalon's answers for the "Ask a question" helper (ask.js).
//
// Answers are written the way you'd explain it across the table: the short
// version first, one or two sentences, then a follow-up to tap if they want
// more. Context-aware entries read only what this player's own client already
// holds (their role card and the public game state) — never anything hidden.
(function () {
  'use strict';

  const EVIL_ROLES = ['Assassin', 'Morgana', 'Mordred', 'Oberon', 'Minion of Mordred',
    'Lunatic', 'Brute', 'Trickster', 'Revealer'];
  const DEFAULT_EVIL = { 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 4 };

  // ── Roles ──
  const ROLES = [
    { role: 'Merlin', aliases: ['merlin', 'marlin', 'merlyn', 'wizard'],
      a: '**Merlin** is Good and sees who is Evil (except Mordred). Your job is to steer Good away from Evil players without making it obvious, because at the end the Assassin gets one guess at who Merlin is. If they guess right, Evil wins.',
      related: ['merlin-tips', 'assassination'] },
    { role: 'Percival', aliases: ['percival', 'perceval', 'percy', 'parsifal'],
      a: '**Percival** is Good and sees two players marked "Merlin or Morgana" without knowing which is which. Work out which one is the real Merlin and protect them, even by acting like Merlin yourself so the Assassin picks you.',
      related: ['morgana', 'merlin'] },
    { role: 'Loyal Servant', aliases: ['loyal servant', 'servant of arthur', 'loyal', 'arthur'],
      a: '**Loyal Servant** is Good with no secret information. Watch who fails quests, who approves suspicious teams, and who seems to know too much. Your votes are how Good wins.',
      related: ['good-tips', 'votes-clue'] },
    { role: 'Assassin', aliases: ['assassin', 'assasin', 'asassin', 'killer'],
      a: '**The Assassin** is Evil and knows the other Evil players. If Good passes 3 quests, you get one final guess at who Merlin is. Guess right and Evil wins anyway, so watch who always seems to know who is bad.',
      related: ['assassination', 'evil-tips'] },
    { role: 'Morgana', aliases: ['morgana', 'morgan', 'morganna'],
      a: '**Morgana** is Evil and shows up to Percival as a possible Merlin. Act the way Merlin would so Percival trusts you instead of the real one.',
      related: ['percival'] },
    { role: 'Mordred', aliases: ['mordred', 'modred', 'mordread', 'mordrid'],
      a: '**Mordred** is Evil but hidden from Merlin. Merlin will never point at you, so you can safely act like a trustworthy Good player.',
      related: ['merlin'] },
    { role: 'Oberon', aliases: ['oberon', 'oberlin', 'oberron'],
      a: '**Oberon** is Evil but alone: you don\'t know the other Evil players and they don\'t know you. Merlin can still see you. Fail quests and watch for players failing alongside you.',
      related: ['evil-tips'] },
    { role: 'Minion of Mordred', aliases: ['minion of mordred', 'minion', 'minions', 'evil servant'],
      a: '**Minion of Mordred** is a regular Evil player. You know your Evil teammates. Get onto quests, fail them when it counts, and help the Assassin work out who Merlin is.',
      related: ['evil-tips', 'should-fail'] },
    { role: 'Cleric', aliases: ['cleric', 'priest', 'clerk'],
      a: '**The Cleric** is Good and learns one fact at the start: whether the very first leader is Good or Evil. Use it to anchor your early reads.',
      related: ['good-tips'] },
    { role: 'Untrustworthy Servant', aliases: ['untrustworthy servant', 'untrustworthy', 'untrusted servant', 'mirror'],
      a: '**The Untrustworthy Servant** is Good and plays as Good all game, but the Assassin knows who you are. At the end the Assassin may hand you the final guess at Merlin. If you then name Merlin correctly, you win with Evil.',
      related: ['assassination'] },
    { role: 'Lunatic', aliases: ['lunatic', 'lunatik', 'crazy'],
      a: '**The Lunatic** is Evil and must play Fail on every quest they go on. You can\'t pass to look innocent, so talk your way onto teams.',
      related: ['quest-cards'] },
    { role: 'Brute', aliases: ['brute', 'brut', 'brutus'],
      a: '**The Brute** is Evil but can only play Fail on the first three quests. On quests 4 and 5 you have to play Pass.',
      related: ['quest-cards'] },
    { role: 'Trickster', aliases: ['trickster', 'tricksters', 'trickstar'],
      a: '**The Trickster** is Evil, but the Lady of the Lake always reads you as Good. If someone "proves" you are Good with the Lady, lean into it.',
      related: ['lady'] },
    { role: 'Revealer', aliases: ['revealer', 'revealed', 'reveler'],
      a: '**The Revealer** is Evil. After three quests are finished, the whole table is told you are Evil, so do your damage early.',
      related: ['evil-tips'] },
  ];

  const ROLE_ID = r => 'role-' + r.toLowerCase().replace(/[^a-z]+/g, '-');
  const roleEntry = name => ROLES.find(r => r.role === name);

  // ── Context helpers ──
  const teamSizeNow = c => c.state?.campaignsConfig?.[c.state.currentCampaign]?.teamSize;
  const failsNow = c => c.state?.campaignsConfig?.[c.state.currentCampaign]?.failsNeeded || 1;
  const onTeam = c => (c.state?.proposedTeam || []).includes(c.myId);

  function whatNow(c) {
    const s = c.state;
    if (!c.inGame || !s) return null;
    const role = c.role?.role;
    const leader = s.leaderId === c.myId;
    const lead = leader ? 'You are' : `**${s.leaderName}** is`;
    switch (s.phase) {
      case 'night-round':
        return 'It\'s the night round. Follow the script being read out: close your eyes and only open them when your role is called.';
      case 'team-select':
        return leader
          ? `You're the leader. Tap **${teamSizeNow(c) || 'the right number of'}** players to send on this quest (you can pick yourself), then propose the team. Everyone votes on it next.`
          : `${lead} the leader and is picking **${teamSizeNow(c) || 'a'}** players for this quest. Talk it over: say who you trust and who you don't. You vote next.`;
      case 'team-vote': {
        const r = s.consecutiveRejections || 0;
        const warn = r >= 4
          ? ' **This is the 5th vote in a row. If it is rejected, Evil wins.**'
          : r ? ` ${r} team${r === 1 ? ' has' : 's have'} been rejected in a row; at 5, Evil wins.` : '';
        return `Vote **Approve** if you trust this whole team, **Reject** if you don't. Majority wins; a tie is a reject.${warn}`;
      }
      case 'team-vote-result':
        return 'The votes are in. Notice who approved and who rejected: those votes stay on record and are one of your best clues later.';
      case 'quest-vote':
      case 'quest-vote-ready':
        if (!onTeam(c)) return 'The team is on the quest, secretly playing Pass or Fail. You just wait. Watch the result: every Fail came from someone on that team.';
        if (!c.role?.isEvil) return 'You\'re on the quest. As a Good player you can only play **Pass**.';
        if (role === 'Lunatic') return 'You\'re on the quest. As the Lunatic you must play **Fail**.';
        if (role === 'Brute' && s.currentCampaign >= 3) return 'You\'re on the quest. The Brute can\'t sabotage after quest 3, so you must play **Pass**.';
        return `You're on the quest and you're Evil, so you choose: **Fail** to sabotage it, or **Pass** to look trustworthy. This quest needs ${failsNow(c)} Fail${failsNow(c) > 1 ? 's' : ''} to fail.`;
      case 'quest-result':
        return 'The cards are shuffled, so you only see how many Fails there were, not who played them. Anyone on the team could be the culprit. Discuss, then continue.';
      case 'lady-of-lake':
        return s.ladyHolder === c.myId
          ? 'You hold the Lady of the Lake. Pick one player to secretly learn if they are Good or Evil. Then you tell the table what you saw (you may lie), and the Lady passes to them.'
          : `**${s.ladyHolderName || 'Someone'}** is using the Lady of the Lake to secretly check one player. They'll announce the result, but they could be lying.`;
      case 'assassination':
        if (s.killerId === c.myId) return 'Good passed 3 quests, but you get one guess. Tap the player you think is **Merlin**. Guess right and Evil wins.';
        if (c.role?.isEvil) return 'The Assassin is picking who they think Merlin is. Help them out loud: who seemed to know too much?';
        return 'The Assassin is trying to guess who Merlin is. Act natural. If they miss, Good wins.';
      case 'game-over':
        return `Game over: **${s.winner === 'good' ? 'Good' : 'Evil'} wins**${s.winReason ? ` (${s.winReason})` : ''}. Everyone's roles are shown now.`;
      default:
        return null;
    }
  }

  function myRoleAnswer(c) {
    if (!c.role) return null;
    const { role, isEvil, known = [] } = c.role;
    const r = roleEntry(role);
    const seen = known.length
      ? `\nYou can see: ${known.map(k => `${k.name} (${k.label})`).join(', ')}.`
      : '\nYou don\'t get to see anyone else\'s role.';
    return `You are **${role}**, on the ${isEvil ? 'Evil' : 'Good'} side. ${r ? r.a : ''}${seen}\nTap **Role** at the top any time to look at your card again.`;
  }

  const ENTRIES = [
    // ── Context-aware ──
    { id: 'now', q: 'What should I do right now?',
      keys: ['what now', 'do now', 'what do i do', 'what should i do', 'my turn', 'what is happening', 'going on', 'next', 'stuck', 'waiting', 'help'],
      a: whatNow,
      fallback: 'Once you\'re in a game I can tell you exactly what to do at each step. For now: each round a leader picks a team, everyone votes on it, and the team secretly passes or fails a quest.',
      related: ['round', 'win'] },
    { id: 'my-role', q: 'What is my role?',
      keys: ['my role', 'who am i', 'what am i', 'my card', 'my character', 'am i good', 'am i evil', 'which side', 'my team'],
      a: myRoleAnswer,
      fallback: 'You get your secret role when the game starts. Tap your card to see it, and tap **Role** at the top any time to see it again.',
      related: ['now', 'roles'] },
    { id: 'who-evil', q: 'Who is Evil?',
      keys: ['who is evil', 'whos evil', 'who are the bad', 'who is bad', 'who is the spy', 'who are the spies', 'tell me who'],
      a: c => {
        const k = (c.role?.known || []);
        if (!c.role) return null;
        return k.length
          ? `That's the game! All I know is what your card shows you: ${k.map(x => `${x.name} (${x.label})`).join(', ')}. Everything else you work out from votes and quest results.`
          : 'That\'s the game! Your card doesn\'t show you anyone, so work it out from who fails quests and how people vote.';
      },
      fallback: 'That\'s the whole game! Nobody tells you. You work it out from who ends up on failed quests and how people vote.',
      related: ['good-tips', 'votes-clue'] },

    // ── The basics ──
    { id: 'win', q: 'How do I win?',
      keys: ['win', 'winning', 'goal', 'point', 'whats the point', 'objective', 'point of the', 'how does it end', 'end the', 'victory', 'lose', 'losing'],
      a: '**Good** wins by passing **3 of the 5 quests**.\n**Evil** wins by failing 3 quests, or if 5 teams in a row get rejected.\nThe twist: if Good passes 3, the Assassin gets one guess at who Merlin is. A right guess steals the win for Evil.',
      related: ['round', 'assassination'] },
    { id: 'round', q: 'How does a round work?',
      keys: ['how to play', 'how do you play', 'new', 'dont understand', 'confused', 'understand', 'lost', 'what is avalon', 'the game', 'new to', 'never played', 'first time', 'how do i play', 'round', 'turn', 'rules', 'how does it work', 'basics', 'explain', 'steps', 'quickly', 'overview', 'summary', 'teach'],
      a: 'Every round has three steps:\n1. **Pick.** The leader chooses a team for the quest.\n2. **Vote.** Everyone approves or rejects that team.\n3. **Quest.** If approved, the team secretly plays Pass or Fail. One Fail and the quest fails.\nThen the next player becomes leader. First side to 3 quests wins.',
      related: ['win', 'leader', 'quest-cards'] },
    { id: 'sides', q: 'What are Good and Evil?',
      keys: ['good and evil', 'good vs evil', 'evil do', 'does evil', 'evil team', 'evil know', 'good team', 'good do', 'sides', 'teams', 'alignment', 'spies', 'resistance', 'loyal', 'what is good', 'what is evil', 'hidden role'],
      a: 'Everyone is secretly on a side. **Good** is the majority but doesn\'t know who anyone is. **Evil** is outnumbered but knows who its teammates are. Evil wins by blending in and sabotaging quests.',
      related: ['how-many-evil', 'win'] },
    { id: 'how-many-evil', q: 'How many Evil players are there?',
      keys: ['how many evil', 'number of evil', 'how many bad', 'how many spies', 'evil count', 'how many are evil'],
      a: c => {
        const roles = c.state?.rolesInGame;
        if (c.inGame && roles?.length) {
          const n = roles.filter(r => EVIL_ROLES.includes(r)).length;
          return `In this game, **${n} of ${roles.length}** players are Evil.`;
        }
        return null;
      },
      fallback: 'Usually 2 Evil with 5 or 6 players, 3 with 7 to 9, and 4 with 10. The host can change this when setting up.',
      related: ['sides'] },
    { id: 'leader', q: 'What does the leader do?',
      keys: ['leader', 'crown', 'goes first', 'who starts', 'first leader', 'go first', 'who picks', 'pick team', 'pick the team', 'choose team', 'choose the team', 'propose', 'proposal', 'king'],
      a: 'The leader (👑) picks who goes on the quest, then everyone votes on that team. The leader can pick themselves. Leadership moves to the next player every round; tap **👑 Order** to see who\'s next.',
      related: ['team-size', 'vote', 'withdraw'] },
    { id: 'team-size', q: 'How many players go on a quest?',
      keys: ['how many go', 'how many players go', 'go on the quest', 'go on a quest', 'people go', 'numbers', 'number on', 'track', 'circles', 'team size', 'how many on', 'size of the team', 'how big'],
      a: c => {
        const n = teamSizeNow(c);
        if (!c.inGame || !n) return null;
        return `This quest needs **${n}** players. Each quest's size is the number on the track at the top.`;
      },
      fallback: 'It changes each quest. The number on each circle of the quest track is how many go. With 5 players it\'s 2, 3, 2, 3, 3.',
      related: ['leader'] },
    { id: 'vote', q: 'How does team voting work?',
      keys: ['vote', 'voting', 'approve', 'approval', 'majority', 'tie', 'yes or no', 'should i approve'],
      a: 'Everyone votes **Approve** or **Reject** at the same time. More approves than rejects sends the team on the quest; a tie counts as a reject. Everyone sees how everyone voted afterwards.',
      related: ['rejected', 'votes-clue'] },
    { id: 'rejected', q: 'What happens if a team is rejected?',
      keys: ['rejected', 'nobody agrees', 'agree', 'disagree', 'reject', 'rejection', 'five rejections', '5 rejections', 'five in a row', '5 in a row', 'hammer', 'rejects'],
      a: 'The next player becomes leader and proposes a new team. If **5 teams in a row** are rejected, Evil wins on the spot, so the 5th proposal is almost always approved. The counter at the top shows how close you are.',
      related: ['vote', 'leader'] },
    { id: 'quest-cards', q: 'How do Pass and Fail work?',
      keys: ['pass', 'fail', 'quest card', 'mission', 'sabotage', 'success', 'succeed', 'play fail', 'play pass', 'quest', 'campaign'],
      a: 'Only the players on the team play a card, in secret. **Good must play Pass.** Evil can play Pass or Fail. The cards are shuffled, so the table only learns how many Fails there were, not who played them. One Fail and the quest fails.',
      related: ['two-fails', 'should-fail'] },
    { id: 'two-fails', q: 'Does one Fail always sink a quest?',
      keys: ['two fails', '2 fails', 'double fail', 'how many fails', 'fourth quest', 'quest 4', 'quest four', 'one fail', 'star'],
      a: 'Almost always. The exception: with **7 or more players**, quest 4 needs **two** Fails. The quest track marks any quest that needs more than one.',
      related: ['quest-cards'] },
    { id: 'can-good-fail', q: 'Can Good players play Fail?',
      keys: ['can good fail', 'merlin fail', 'good fail', 'good players fail', 'good player fail', 'can good', 'good play fail', 'fail button', 'fail greyed', 'cant fail', 'cannot fail', 'fail disabled'],
      a: 'No. Good players can only play Pass, so the Fail button is greyed out for them. That\'s why every Fail points to an Evil player on the team.',
      related: ['quest-cards'] },

    // ── The ending ──
    { id: 'assassination', q: 'What is the assassination?',
      keys: ['assassination', 'good wins', 'if good wins', 'assassinate', 'kill', 'final shot', 'last guess', 'final guess', 'guess merlin', 'end of the game', 'at the end', 'steal the win', 'shoot'],
      a: 'If Good passes 3 quests, the game isn\'t over yet. The Evil players can talk it over, then the **Assassin** points at one player. If that player is **Merlin**, Evil wins. If not, Good wins.',
      related: ['merlin-tips', 'role-assassin'] },

    // ── Strategy ──
    { id: 'merlin-tips', q: 'How do I play Merlin without getting caught?',
      keys: ['merlin tips', 'play merlin', 'as merlin', 'hide merlin', 'hidden', 'caught', 'subtle', 'not get caught', 'without getting', 'guide good'],
      a: 'Point at evidence everyone can see ("Dave was on both failed quests"), never at what only you know. Let others reach the right answer; sometimes vote like a normal player would. And never say you\'re Merlin.',
      related: ['assassination', 'role-merlin'] },
    { id: 'good-tips', q: 'Tips for playing Good?',
      keys: ['tips good', 'good tips', 'tips for good', 'for good', 'strategy', 'strategies', 'tips', 'advice', 'figure out', 'find evil', 'find the evil', 'deduce', 'clues', 'how do i know', 'how to tell', 'catch'],
      a: '1. Track who was on each failed quest.\n2. Watch votes: Evil players often approve teams that include Evil.\n3. Be suspicious of anyone pushing hard for a specific team.\n4. If someone always seems right, they might be Merlin. Don\'t say so out loud.',
      related: ['votes-clue', 'evil-tips'] },
    { id: 'votes-clue', q: 'Why do the votes matter?',
      keys: ['votes matter', 'who voted', 'vote history', 'voting pattern', 'why vote', 'clue'],
      a: 'Everyone\'s team vote is public. When a quest fails, look back at who approved that team: Evil players tend to approve teams with their teammates on them.',
      related: ['good-tips'] },
    { id: 'evil-tips', q: 'Tips for playing Evil?',
      keys: ['evil tips', 'tips evil', 'tips for evil', 'for evil', 'evil strategy', 'strategy for evil', 'as evil', 'play evil', 'when evil', 'im evil', 'i am evil', 'bad guy', 'blend in', 'deceive'],
      a: '1. Act like a confused Good player.\n2. Don\'t fail every quest you\'re on; a pass can buy trust for later.\n3. If two Evil are on one quest, only one of you usually needs to fail.\n4. Watch who seems to know too much: that\'s Merlin, and the Assassin needs to know.',
      related: ['should-fail', 'assassination'] },
    { id: 'should-fail', q: 'Should I always play Fail as Evil?',
      keys: ['always fail', 'should i fail', 'when to fail', 'when should i fail', 'fail or pass', 'pass as evil'],
      a: 'Not always. Failing an early small quest can expose you. Sometimes passing earns trust so you get picked for a bigger quest later. But if Evil already has 2 failed quests, fail: that\'s the win.',
      related: ['evil-tips', 'two-fails'] },
    { id: 'lying', q: 'Can I lie?',
      keys: ['lie', 'lying', 'bluff', 'bluffing', 'allowed', 'show my role', 'show my screen', 'show my phone', 'prove', 'cheat', 'claim'],
      a: 'Yes. Anyone can say anything, including lying about their role. The one rule: **never show anyone your screen.**',
      related: ['sides'] },

    // ── Optional rules ──
    { id: 'lady', q: 'What is the Lady of the Lake?',
      keys: ['lady', 'lady of the lake', 'lake', 'investigate', 'check someone', 'check loyalty', 'water'],
      a: 'An optional rule. After quests 2, 3 and 4, whoever holds the Lady secretly checks one player and learns if they\'re Good or Evil. They then tell the table (and may lie), and the Lady passes to the player they checked. You can\'t check someone who already held it.',
      related: ['role-trickster'] },
    { id: 'night', q: 'What is the night round?',
      keys: ['night round', 'night', 'eyes closed', 'close your eyes', 'thumbs', 'thumb', 'script'],
      a: 'An optional opening where someone reads a script aloud and everyone closes their eyes. Evil opens their eyes to see each other, and Evil raises thumbs for Merlin to see. The app already shows each person what their role knows, so it\'s just for atmosphere.',
      related: ['sides'] },
    { id: 'withdraw', q: 'Can the leader take back a team?',
      keys: ['take back', 'withdraw', 'undo', 'change the team', 'change my team', 'mistake', 'wrong team', 'cancel'],
      a: 'Yes. While the vote is still going, the leader can withdraw their team and pick again. It doesn\'t count as a rejection.',
      related: ['leader'] },
    { id: 'clock', q: 'What is the shot clock?',
      keys: ['shot clock', 'clock', 'timer', 'hurry', 'too slow', 'taking forever', 'countdown', 'time limit'],
      a: 'If someone is stalling while picking a team or voting, anyone can call for the clock. Once half the table asks, a countdown starts. If a leader runs out of time, the team is skipped and counts as a rejection. Missing votes count as Approve.',
      related: ['rejected'] },
    { id: 'rejoin', q: 'What if my phone disconnects?',
      keys: ['phone dies', 'phone died', 'disconnect', 'disconnected', 'dropped', 'rejoin', 'reconnect', 'lost connection', 'phone died', 'left', 'refresh', 'closed the app'],
      a: 'Just open the app again. You\'ll be offered **Rejoin**, and you come back as the same player with the same role. The game waits for you when it needs your vote.',
      related: ['now'] },
    { id: 'roles', q: 'What roles are there?',
      keys: ['roles', 'what roles', 'which roles', 'all roles', 'characters', 'special roles', 'role list', 'list of roles'],
      a: c => {
        const special = c.inGame && c.state?.specialRoles?.length
          ? `\nIn this game: ${c.state.specialRoles.join(', ')}. Tap **📜 Roles** at the top for a quick list.` : '';
        return 'Every game has **Merlin** (Good, sees Evil) and the **Assassin** (Evil, gets the final guess). Everyone else is a plain Loyal Servant or Minion unless the host adds extras: Percival, Cleric and Untrustworthy Servant for Good; Morgana, Mordred, Oberon, Lunatic, Brute, Trickster and Revealer for Evil. Ask me about any of them.' + special;
      },
      related: ['role-merlin', 'role-percival', 'role-morgana'] },
    { id: 'players', q: 'How many players, and how long?',
      keys: ['how long', 'how many people', 'how many players', 'player count', 'minimum', 'maximum', 'enough players', 'need to play'],
      a: '5 to 10 players, each on their own phone. It\'s best with 6 to 8, and a game takes about 30 minutes.',
      related: ['how-many-evil'] },
    { id: 'tutorial', q: 'Is there a tutorial?',
      keys: ['tutorial', 'walkthrough', 'practice', 'demo', 'learn', 'show me'],
      a: 'Yes. Tap **📖 Tutorial** on the Avalon home screen. It walks you through one round in about two minutes.',
      related: ['round'] },

    // Role entries come last so a question like "can merlin fail" prefers the
    // topic over the name.
    ...ROLES.map(r => ({ id: ROLE_ID(r.role), q: `What does ${r.role} do?`,
      keys: r.aliases, a: r.a, related: r.related })),
  ];

  // Fix up related ids that name a role by its short name ("morgana").
  const ids = new Set(ENTRIES.map(e => e.id));
  for (const e of ENTRIES) {
    e.related = (e.related || []).map(x => ids.has(x) ? x : ROLE_ID(x)).filter(x => ids.has(x));
  }

  function suggest(c) {
    if (!c.inGame) return ['round', 'win', 'roles', 'role-merlin'];
    const byPhase = {
      'team-select':   ['leader', 'good-tips'],
      'team-vote':     ['vote', 'rejected'],
      'team-vote-result': ['votes-clue', 'rejected'],
      'quest-vote':    ['quest-cards', 'should-fail'],
      'quest-vote-ready': ['quest-cards', 'two-fails'],
      'quest-result':  ['quest-cards', 'votes-clue'],
      'lady-of-lake':  ['lady'],
      'assassination': ['assassination'],
      'night-round':   ['night'],
      'game-over':     ['win', 'merlin-tips'],
    }[c.state?.phase] || [];
    const extra = c.role?.isEvil ? 'evil-tips' : c.role?.role === 'Merlin' ? 'merlin-tips' : 'good-tips';
    return [...new Set(['now', 'my-role', ...byPhase, extra])];
  }

  function intro(c) {
    return c.inGame
      ? 'Ask me anything about the rules, or what to do right now. I only know what your own screen shows, so I can\'t tell you who\'s Evil.'
      : 'Ask me anything about how Avalon works. Type or use the mic on your keyboard.';
  }

  // Everything the helper may read, gathered from client.js's own globals.
  function context() {
    /* global myRole, lastGameState, socket */
    const active = id => document.getElementById('screen-' + id)?.classList.contains('active');
    const state = typeof lastGameState !== 'undefined' ? lastGameState : null;
    const inGame = !!state && (active('game') || active('placard'));
    return {
      inGame,
      state: inGame ? state : null,
      role: inGame && typeof myRole !== 'undefined' ? myRole : null,
      myId: typeof socket !== 'undefined' ? socket.id : null,
      players: state?.players,
    };
  }

  if (typeof module !== 'undefined') {
    module.exports = { ENTRIES, ROLES, suggest, whatNow, myRoleAnswer };
  }
  if (typeof window === 'undefined' || !window.AskSheet) return;

  const ask = window.AskSheet.create({
    title: 'Ask about Avalon', entries: ENTRIES, context, suggest, intro,
    placeholder: 'e.g. "what does Percival do?"',
  });
  window.avalonAsk = ask;

  document.getElementById('btn-ask')?.addEventListener('click', () => ask.open());
  document.getElementById('lobby-ask-btn')?.addEventListener('click', () => ask.open());
  document.getElementById('tut-ask')?.addEventListener('click', () => ask.open());
  // The in-game button is re-rendered with the meta row, so listen at the root.
  document.addEventListener('click', e => {
    if (e.target.closest('#show-ask-btn')) { e.stopPropagation(); ask.open(); }
  });
})();
