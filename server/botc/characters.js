// Trouble Brewing — the complete 22-character script.
//
// `info` names a generator in engine.js; `choice` names a night prompt the
// player must answer. A character with neither is passive (Soldier, Saint) or
// triggers off a day event (Virgin, Slayer).

const CHARACTERS = {
  // ── Townsfolk (13) ─────────────────────────────────────────────────────
  Washerwoman: {
    team: 'townsfolk', alignment: 'good', firstNight: true, info: 'detectTownsfolk',
    blurb: 'You start knowing that one of two players is a particular Townsfolk.',
  },
  Librarian: {
    team: 'townsfolk', alignment: 'good', firstNight: true, info: 'detectOutsider',
    blurb: 'You start knowing that one of two players is a particular Outsider — or that there are none.',
  },
  Investigator: {
    team: 'townsfolk', alignment: 'good', firstNight: true, info: 'detectMinion',
    blurb: 'You start knowing that one of two players is a particular Minion.',
  },
  Chef: {
    team: 'townsfolk', alignment: 'good', firstNight: true, info: 'chef',
    blurb: 'You start knowing how many pairs of evil players are sitting next to each other.',
  },
  Empath: {
    team: 'townsfolk', alignment: 'good', firstNight: true, otherNight: true, info: 'empath',
    blurb: 'Each night, you learn how many of your two living neighbours are evil.',
  },
  'Fortune Teller': {
    team: 'townsfolk', alignment: 'good', firstNight: true, otherNight: true, choice: 'fortune', picks: 2,
    blurb: 'Each night, choose two players — you learn if either is the Demon. One good player registers as the Demon to you.',
  },
  Undertaker: {
    team: 'townsfolk', alignment: 'good', otherNight: true, info: 'undertaker',
    blurb: 'Each night (except the first), you learn which character died by execution today.',
  },
  Monk: {
    team: 'townsfolk', alignment: 'good', otherNight: true, choice: 'protect',
    blurb: 'Each night (except the first), choose a player other than yourself — they are safe from the Demon tonight.',
  },
  Ravenkeeper: {
    team: 'townsfolk', alignment: 'good', onNightDeath: true, choice: 'ravenkeeper',
    blurb: 'If you die at night, you wake and choose a player — you learn their character.',
  },
  Virgin: {
    team: 'townsfolk', alignment: 'good',
    blurb: 'The first time you are nominated, if the nominator is a Townsfolk, they are executed immediately.',
  },
  Slayer: {
    team: 'townsfolk', alignment: 'good', dayAction: 'slay',
    blurb: 'Once per game, during the day, publicly choose a player — if they are the Demon, they die.',
  },
  Soldier: {
    team: 'townsfolk', alignment: 'good',
    blurb: 'You are safe from the Demon.',
  },
  Mayor: {
    team: 'townsfolk', alignment: 'good',
    blurb: 'If only three players live and no execution occurs, your team wins. If you would die at night, another player might die instead.',
  },

  // ── Outsiders (4) ──────────────────────────────────────────────────────
  Butler: {
    team: 'outsider', alignment: 'good', firstNight: true, otherNight: true, choice: 'master',
    blurb: 'Each night, choose a player (not yourself) — your master. You may only vote if they are voting too.',
  },
  Drunk: {
    team: 'outsider', alignment: 'good',
    blurb: 'You do not know you are the Drunk. You think you are a Townsfolk, but your ability does not work.',
  },
  Recluse: {
    team: 'outsider', alignment: 'good',
    blurb: 'You might register as evil, and as a Minion or Demon, even if dead.',
  },
  Saint: {
    team: 'outsider', alignment: 'good',
    blurb: 'If you die by execution, your team loses.',
  },

  // ── Minions (4) ────────────────────────────────────────────────────────
  Poisoner: {
    team: 'minion', alignment: 'evil', firstNight: true, otherNight: true, choice: 'poison',
    blurb: 'Each night, choose a player — their ability malfunctions and their information is wrong tonight and tomorrow day.',
  },
  Spy: {
    team: 'minion', alignment: 'evil', firstNight: true, otherNight: true, info: 'spy',
    blurb: 'Each night, you see everyone’s character. You might register as good, and as a Townsfolk or Outsider, even if dead.',
  },
  'Scarlet Woman': {
    team: 'minion', alignment: 'evil',
    blurb: 'If there are five or more players alive and the Demon dies, you become the Demon.',
  },
  Baron: {
    team: 'minion', alignment: 'evil', setupModifier: true,
    blurb: 'There are two extra Outsiders in play.',
  },

  // ── Demon (1) ──────────────────────────────────────────────────────────
  Imp: {
    team: 'demon', alignment: 'evil', otherNight: true, choice: 'kill',
    blurb: 'Each night (except the first), choose a player — they die. If you kill yourself, a Minion becomes the Imp.',
  },
};

const BY_TEAM = team => Object.keys(CHARACTERS).filter(c => CHARACTERS[c].team === team);

// Standard Trouble Brewing setup: [townsfolk, outsiders, minions, demons]
const COUNTS = {
  5:  [3, 0, 1, 1],
  6:  [3, 1, 1, 1],
  7:  [5, 0, 1, 1],
  8:  [5, 1, 1, 1],
  9:  [5, 2, 1, 1],
  10: [7, 0, 2, 1],
  11: [7, 1, 2, 1],
  12: [7, 2, 2, 1],
  13: [9, 0, 3, 1],
  14: [9, 1, 3, 1],
  15: [9, 2, 3, 1],
};

const MIN_PLAYERS = 5;
const MAX_PLAYERS = 15;

// Official Trouble Brewing night order. MINION_INFO and DEMON_INFO aren't
// characters — evil learning each other happens at a fixed point regardless.
const FIRST_NIGHT = [
  'MINION_INFO', 'DEMON_INFO',
  'Poisoner', 'Washerwoman', 'Librarian', 'Investigator',
  'Chef', 'Empath', 'Fortune Teller', 'Butler', 'Spy',
];

const OTHER_NIGHT = [
  'Poisoner', 'Monk', 'Imp', 'Ravenkeeper',
  'Undertaker', 'Empath', 'Fortune Teller', 'Butler', 'Spy',
];

function isEvil(character)  { return CHARACTERS[character]?.alignment === 'evil'; }
function isDemon(character) { return CHARACTERS[character]?.team === 'demon'; }
function teamOf(character)  { return CHARACTERS[character]?.team; }

module.exports = {
  CHARACTERS, BY_TEAM, COUNTS, MIN_PLAYERS, MAX_PLAYERS,
  FIRST_NIGHT, OTHER_NIGHT, isEvil, isDemon, teamOf,
};
