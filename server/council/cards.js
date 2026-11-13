// The problem deck. Every card has the same shape on purpose: one choice that
// costs the treasury (gold) and one that costs the people. The numbers never
// live here: every choice costs exactly 1, and a trap costs 1 extra. A card
// only supplies the story.
//
// The story follows the table. A card can name what comes NEXT after each
// choice (`next.gold` / `next.people`): pay the hunters and the hunters come
// back for more; let the farmers fight and the farmers want a reward. Those
// follow-up cards (`follow: true`) are never dealt on their own. Cards with no
// `next` are one-off problems; after them a fresh problem is dealt.

const CARDS = [
  // ── Wolves ────────────────────────────────────────────────────────────
  { id: 'wolves', icon: '🐺', title: 'Wolf Winter',
    text: 'Wolves are taking sheep from every farm.',
    gold: 'Hire hunters', people: 'Let the farmers fight',
    next: { gold: 'hunters-return', people: 'farmers-reward' } },
  { id: 'hunters-return', follow: true, icon: '🏹', title: 'The Hunters Want More',
    text: 'The hunters you hired are back. Pay them again, or they say they will let the wolves in.',
    gold: 'Pay them again', people: 'Chase them out of town' },
  { id: 'farmers-reward', follow: true, icon: '🧑‍🌾', title: 'The Farmers Want a Reward',
    text: 'The farmers who fought the wolves are hurt and angry. They want something for it.',
    gold: 'Give them coin', people: 'Refuse, and lose some to the city' },

  // ── Bandits ───────────────────────────────────────────────────────────
  { id: 'bandits', icon: '🗡️', title: 'Bandits at the Gate',
    text: 'Bandits demand payment, or they will raid the villages.',
    gold: 'Pay them off', people: 'Let them raid the villages',
    next: { gold: 'bandits-greedy', people: 'villages-burned' } },
  { id: 'bandits-greedy', follow: true, icon: '💰', title: 'The Bandits Got Greedy',
    text: 'The bandits liked your gold. Now they want twice as much.',
    gold: 'Pay them again', people: 'Arm the townsfolk' },
  { id: 'villages-burned', follow: true, icon: '🏚️', title: 'The Burned Villages',
    text: 'The raided villages need new homes before winter comes.',
    gold: 'Rebuild with royal coin', people: 'Let them rebuild alone' },

  // ── Sickness ──────────────────────────────────────────────────────────
  { id: 'plague', icon: '🤒', title: 'Sickness in the Lower Town',
    text: 'A fever is spreading through the poorest streets.',
    gold: 'Pay for healers', people: 'Close the gates and wait',
    next: { gold: 'fake-cures', people: 'fever-spreads' } },
  { id: 'fake-cures', follow: true, icon: '🧪', title: 'Fake Cures',
    text: 'One of the healers you paid is selling colored water as medicine.',
    gold: 'Buy real medicine from abroad', people: 'Throw him out, let the sick wait' },
  { id: 'fever-spreads', follow: true, icon: '🏰', title: 'Fever in the Castle',
    text: 'Behind the closed gates, the fever reached the castle kitchens.',
    gold: 'Hire doctors', people: 'Lock the servants in their rooms' },

  // ── Dragon ────────────────────────────────────────────────────────────
  { id: 'dragon', icon: '🐉', title: 'The Dragon’s Toll',
    text: 'A dragon has landed on the hill and wants a gift.',
    gold: 'Offer it treasure', people: 'Send knights to fight it',
    next: { gold: 'dragon-returns', people: 'dragon-angry' } },
  { id: 'dragon-returns', follow: true, icon: '🐲', title: 'The Dragon Came Back',
    text: 'The dragon liked your treasure. It is back on the hill, and hungry for more.',
    gold: 'Give it more gold', people: 'Send the knights this time' },
  { id: 'dragon-angry', follow: true, icon: '🔥', title: 'An Angry Dragon',
    text: 'The knights came home burned, and now the dragon is circling the farms.',
    gold: 'Pay a famous dragon slayer', people: 'Send the next squad' },

  // ── Harvest ───────────────────────────────────────────────────────────
  { id: 'harvest', icon: '🌾', title: 'The Harvest Failed',
    text: 'Rain rotted the crops. Winter is coming.',
    gold: 'Buy grain from abroad', people: 'Ration the food',
    next: { gold: 'grain-merchant', people: 'hungry-crowd' } },
  { id: 'grain-merchant', follow: true, icon: '⚖️', title: 'The Grain Merchant',
    text: 'The merchant who sold you grain says the next load costs double.',
    gold: 'Pay his price', people: 'Make everyone farm the castle fields' },
  { id: 'hungry-crowd', follow: true, icon: '🍞', title: 'A Hungry Crowd',
    text: 'People on short rations are gathering at the castle gates.',
    gold: 'Open the royal pantry', people: 'Send the guards' },

  // ── Bridge ────────────────────────────────────────────────────────────
  { id: 'bridge', icon: '🌉', title: 'The Bridge Collapsed',
    text: 'The only bridge to the market town fell into the river.',
    gold: 'Hire builders', people: 'Make the villagers rebuild it',
    next: { gold: 'bridge-toll', people: 'shaky-bridge' } },
  { id: 'bridge-toll', follow: true, icon: '🚧', title: 'A Toll on the Bridge',
    text: 'The builders kept the key to the new bridge gate, and now they charge a toll.',
    gold: 'Buy the key from them', people: 'Tear the gate down by hand' },
  { id: 'shaky-bridge', follow: true, icon: '🪵', title: 'The Shaky Bridge',
    text: 'The villagers’ bridge wobbles. A cart full of apples fell through.',
    gold: 'Hire real engineers', people: 'Close it and walk the long way' },

  // ── Pirates ───────────────────────────────────────────────────────────
  { id: 'pirates', icon: '🏴‍☠️', title: 'Pirates in the Harbor',
    text: 'Pirate ships are blocking the fishing boats.',
    gold: 'Bribe the pirate captain', people: 'Let the fishermen fight',
    next: { gold: 'pirate-friends', people: 'wrecked-boats' } },
  { id: 'pirate-friends', follow: true, icon: '⛵', title: 'The Captain Told His Friends',
    text: 'Word got out that you pay pirates. Now there are three ships in the harbor.',
    gold: 'Bribe them all', people: 'Arm the harbor' },
  { id: 'wrecked-boats', follow: true, icon: '🛶', title: 'Wrecked Boats',
    text: 'The fishermen won, but half the boats are wrecked.',
    gold: 'Buy new boats', people: 'Let the families mend them' },

  // ── Fire ──────────────────────────────────────────────────────────────
  { id: 'fire', icon: '🔥', title: 'The Great Fire',
    text: 'A fire burned down half the market square.',
    gold: 'Rebuild with royal coin', people: 'Let families rebuild alone',
    next: { gold: 'grand-opening', people: 'merchants-leave' } },
  { id: 'grand-opening', follow: true, icon: '🎪', title: 'The Grand Opening',
    text: 'The new market is beautiful. The guilds want a royal festival to open it.',
    gold: 'Pay for the festival', people: 'Skip it, and the guilds sulk' },
  { id: 'merchants-leave', follow: true, icon: '🧳', title: 'The Merchants Are Leaving',
    text: 'With no help to rebuild, merchants are packing up for the next kingdom.',
    gold: 'Pay them to stay', people: 'Let the market shrink' },

  // ── One-off problems ─────────────────────────────────────────────────
  { id: 'rival', icon: '👑', title: 'A Rival King’s Insult',
    text: 'The king next door mocked your crown in front of his court.',
    gold: 'Send gifts to keep the peace', people: 'March the army to his border' },
  { id: 'mine', icon: '⛏️', title: 'The Mine Caved In',
    text: 'Miners are trapped deep underground.',
    gold: 'Pay to dig them out', people: 'Seal the mine' },
  { id: 'revolt', icon: '✊', title: 'Tax Revolt',
    text: 'Angry crowds refuse to pay this year’s taxes.',
    gold: 'Lower the taxes', people: 'Arrest the leaders' },
  { id: 'ransom', icon: '🤴', title: 'The Kidnapped Prince',
    text: 'Outlaws took the prince and want a ransom.',
    gold: 'Pay the ransom', people: 'Send a rescue party' },
  { id: 'rats', icon: '🐀', title: 'Rats in the Granary',
    text: 'Giant rats are eating the winter grain.',
    gold: 'Hire rat catchers', people: 'Make the townsfolk hunt them' },
  { id: 'spies', icon: '🕵️', title: 'Foreign Spies',
    text: 'Spies have been seen near the castle walls.',
    gold: 'Pay informants', people: 'Search every house' },
  { id: 'flood', icon: '🌊', title: 'Flood Season',
    text: 'The river is rising toward the farms.',
    gold: 'Build a dam', people: 'Move the river towns' },
];

const BY_ID = Object.fromEntries(CARDS.map(c => [c.id, c]));
const cardById = id => BY_ID[id] || null;
// Problems that can be dealt fresh (not a follow-up to an earlier choice).
const SEEDS = CARDS.filter(c => !c.follow).map(c => c.id);
// Story problems first: a game should usually see a follow-up or two.
const STORY_SEEDS = CARDS.filter(c => !c.follow && c.next).map(c => c.id);

module.exports = { CARDS, SEEDS, STORY_SEEDS, cardById };
