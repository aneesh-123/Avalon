// secret-theme.js — every word and symbol a player sees in the Secret Hitler
// game mode. The rules engine and the screens only ever use neutral ids
// ('liberal', 'fascist', 'hitler', 'president', 'chancellor'), so renaming or
// retheming the game is an edit to this one file.
//
// The game is by Goat, Wolf & Cabbage (secrethitler.com), released under
// CC BY-NC-SA 4.0: attribution, non-commercial, share-alike.
window.SEC_THEME = {
  gameName: 'Secret Hitler',
  tagline: 'Find and stop the Secret Hitler.',
  pickerDesc: 'Pass laws, trust no one. 5–10 players.',
  pickerIcon: '🗳️',
  credit: 'Based on Secret Hitler by Goat, Wolf & Cabbage, used under CC BY-NC-SA 4.0.',

  party: {
    liberal: { name: 'Liberal', plural: 'Liberals', icon: '🕊️' },
    fascist: { name: 'Fascist', plural: 'Fascists', icon: '💀' },
  },
  role: {
    liberal: { name: 'Liberal', icon: '🕊️', goal: 'Enact five Liberal policies, or execute Hitler.' },
    fascist: { name: 'Fascist', icon: '💀', goal: 'Enact six Fascist policies, or get Hitler elected Chancellor after three Fascist policies. Keep Hitler hidden.' },
    hitler:  { name: 'Hitler',  icon: '🎭', goal: 'You are on the Fascist team. Stay hidden and get elected Chancellor once three Fascist policies are on the board.' },
  },
  policy: {
    liberal: 'Liberal',
    fascist: 'Fascist',
    one: 'policy',
    many: 'policies',
  },
  president: 'President',
  chancellor: 'Chancellor',
  ja: 'Ja!',
  nein: 'Nein',
  government: 'government',
  trackerName: 'Election tracker',
  chaos: 'The country is thrown into chaos',

  power: {
    peek:        { name: 'Policy Peek',      icon: '👁️', desc: 'The President secretly looks at the top three policies.' },
    investigate: { name: 'Investigate',      icon: '🔍', desc: 'The President sees one player’s party membership.' },
    special:     { name: 'Special Election', icon: '📜', desc: 'The President picks the next presidential candidate.' },
    execute:     { name: 'Execution',        icon: '🗡️', desc: 'The President kills a player. If it’s Hitler, the Liberals win.' },
  },
  execute: { verb: 'Execute', past: 'executed', dead: 'Dead' },

  win: {
    liberal: {
      policies: 'Five Liberal policies were enacted.',
      'hitler-executed': 'Hitler was executed.',
    },
    fascist: {
      policies: 'Six Fascist policies were enacted.',
      'hitler-elected': 'Hitler was elected Chancellor.',
    },
  },
};
