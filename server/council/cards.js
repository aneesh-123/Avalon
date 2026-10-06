// The problem deck. Every card is the same shape on purpose: one option that
// costs the treasury, one that costs the people. The numbers never live here —
// every choice costs exactly 1, and the engine adds the extras (a trap, a
// sabotage). A card only supplies the story.

const CARDS = [
  { id: 'bandits',  icon: '🗡️', title: 'Bandits at the Gate',
    text: 'Bandits demand payment, or they will raid the villages.',
    gold: 'Pay them off', people: 'Let them raid the villages' },
  { id: 'bridge',   icon: '🌉', title: 'The Bridge Collapsed',
    text: 'The only bridge to the market town fell into the river.',
    gold: 'Hire builders', people: 'Make the villagers rebuild it' },
  { id: 'plague',   icon: '🤒', title: 'Sickness in the Lower Town',
    text: 'A fever is spreading through the poorest streets.',
    gold: 'Pay for healers', people: 'Close the gates and wait' },
  { id: 'dragon',   icon: '🐉', title: 'The Dragon’s Toll',
    text: 'A dragon has landed on the hill and wants a gift.',
    gold: 'Offer it treasure', people: 'Send knights to fight it' },
  { id: 'harvest',  icon: '🌾', title: 'The Harvest Failed',
    text: 'Rain rotted the crops. Winter is coming.',
    gold: 'Buy grain from abroad', people: 'Ration the food' },
  { id: 'flood',    icon: '🌊', title: 'Flood Season',
    text: 'The river is rising toward the farms.',
    gold: 'Build a dam', people: 'Move the river towns' },
  { id: 'wolves',   icon: '🐺', title: 'Wolf Winter',
    text: 'Wolves are taking sheep from every farm.',
    gold: 'Pay the hunters', people: 'Let the farmers fend for themselves' },
  { id: 'rival',    icon: '👑', title: 'A Rival King’s Insult',
    text: 'The king next door mocked your crown in front of his court.',
    gold: 'Send gifts to keep the peace', people: 'March the army to his border' },
  { id: 'mine',     icon: '⛏️', title: 'The Mine Caved In',
    text: 'Miners are trapped deep underground.',
    gold: 'Pay to dig them out', people: 'Seal the mine' },
  { id: 'pirates',  icon: '🏴‍☠️', title: 'Pirates in the Harbor',
    text: 'Pirate ships are blocking the fishing boats.',
    gold: 'Bribe the pirate captain', people: 'Let the fishermen fight' },
  { id: 'fire',     icon: '🔥', title: 'The Great Fire',
    text: 'A fire burned down half the market square.',
    gold: 'Rebuild with royal coin', people: 'Let families rebuild alone' },
  { id: 'revolt',   icon: '✊', title: 'Tax Revolt',
    text: 'Angry crowds refuse to pay this year’s taxes.',
    gold: 'Lower the taxes', people: 'Arrest the leaders' },
  { id: 'ransom',   icon: '🏰', title: 'The Kidnapped Prince',
    text: 'Outlaws took the prince and want a ransom.',
    gold: 'Pay the ransom', people: 'Send a rescue party' },
  { id: 'rats',     icon: '🐀', title: 'Rats in the Granary',
    text: 'Giant rats are eating the winter grain.',
    gold: 'Hire rat catchers', people: 'Make the townsfolk hunt them' },
  { id: 'comet',    icon: '☄️', title: 'A Strange Comet',
    text: 'A red comet in the sky has everyone afraid.',
    gold: 'Pay astrologers to calm them', people: 'Ignore it and let fear spread' },
  { id: 'spies',    icon: '🕵️', title: 'Foreign Spies',
    text: 'Spies have been seen near the castle walls.',
    gold: 'Pay informants', people: 'Search every house' },
];

const BY_ID = Object.fromEntries(CARDS.map(c => [c.id, c]));
const cardById = id => BY_ID[id] || null;

module.exports = { CARDS, cardById };
