// Head to Head question packs.
//
// Curated and checked into the repo, never generated during a match: a wrong
// answer key costs a player a match with no appeal. Most packs are shared with
// Trivia Night (read from its bank, never edited here); the packs below are
// Head to Head's own.
//
// Entry format: [question, answer, [three wrong answers]]
// A flag entry is [flagEmoji, answer, [three wrong answers]] and is shown big
// under "Which country's flag is this?".
//
// `brand: true` marks packs named after someone else's franchise. They are
// fine on the website, but an App Store listing should not lean on those
// names — flip BRANDED_PACKS off to hide them all at once.
const trivia = require('../trivia/questions');

const BRANDED_PACKS = true;

const OWN = [
  {
    id: 'us-states', name: 'US States', icon: '🗽',
    questions: [
      ['Which is the largest US state by area?', 'Alaska', ['Texas', 'California', 'Montana']],
      ['Which is the smallest US state by area?', 'Rhode Island', ['Delaware', 'Connecticut', 'New Jersey']],
      ['What is the capital of California?', 'Sacramento', ['Los Angeles', 'San Francisco', 'San Diego']],
      ['What is the capital of Texas?', 'Austin', ['Houston', 'Dallas', 'San Antonio']],
      ['What is the capital of New York State?', 'Albany', ['New York City', 'Buffalo', 'Syracuse']],
      ['What is the capital of Florida?', 'Tallahassee', ['Miami', 'Orlando', 'Tampa']],
      ['Which state is nicknamed the Lone Star State?', 'Texas', ['Arizona', 'Nevada', 'Oklahoma']],
      ['Which state was the first to join the United States?', 'Delaware', ['Pennsylvania', 'Virginia', 'Massachusetts']],
      ['Which was the 50th and last state to join?', 'Hawaii', ['Alaska', 'Arizona', 'New Mexico']],
      ['The Grand Canyon is in which state?', 'Arizona', ['Utah', 'Colorado', 'Nevada']],
      ['Mount Rushmore is in which state?', 'South Dakota', ['North Dakota', 'Wyoming', 'Montana']],
      ['Which state is nicknamed the Peach State?', 'Georgia', ['South Carolina', 'Alabama', 'California']],
      ['Which state has the most people?', 'California', ['Texas', 'Florida', 'New York']],
      ['What is the capital of Illinois?', 'Springfield', ['Chicago', 'Peoria', 'Rockford']],
      ['What is the capital of Washington State?', 'Olympia', ['Seattle', 'Spokane', 'Tacoma']],
      ['Las Vegas is in which state?', 'Nevada', ['Arizona', 'California', 'Utah']],
      ['Which state is nicknamed the Golden State?', 'California', ['Nevada', 'Colorado', 'Alaska']],
      ['How many states are in the United States?', '50', ['48', '51', '52']],
      ['Most of Yellowstone National Park is in which state?', 'Wyoming', ['Montana', 'Idaho', 'Colorado']],
      ['Which state is nicknamed the Bluegrass State?', 'Kentucky', ['Tennessee', 'Virginia', 'Kansas']],
      ['Which state is famous for its potatoes?', 'Idaho', ['Iowa', 'Ohio', 'Maine']],
      ['What is the capital of Massachusetts?', 'Boston', ['Cambridge', 'Worcester', 'Springfield']],
      ['Which state is shaped like a mitten?', 'Michigan', ['Wisconsin', 'Minnesota', 'Ohio']],
      ['What is the capital of Colorado?', 'Denver', ['Boulder', 'Colorado Springs', 'Aspen']],
      ['Which state is nicknamed the Empire State?', 'New York', ['Pennsylvania', 'New Jersey', 'Massachusetts']],
      ['Which state calls itself the Land of 10,000 Lakes?', 'Minnesota', ['Michigan', 'Wisconsin', 'Maine']],
      ['What is the capital of Pennsylvania?', 'Harrisburg', ['Philadelphia', 'Pittsburgh', 'Scranton']],
      ['The Everglades are in which state?', 'Florida', ['Louisiana', 'Georgia', 'Mississippi']],
    ],
  },
  {
    id: 'pokemon', name: 'Pokémon', icon: '🔴', brand: true,
    questions: [
      ['Which Pokémon is Ash’s partner in the TV show?', 'Pikachu', ['Eevee', 'Charmander', 'Squirtle']],
      ['What type is Pikachu?', 'Electric', ['Fire', 'Normal', 'Psychic']],
      ['What does Charmander evolve into?', 'Charmeleon', ['Charizard', 'Cyndaquil', 'Vulpix']],
      ['What is Squirtle’s final evolution?', 'Blastoise', ['Wartortle', 'Gyarados', 'Totodile']],
      ['Which Pokémon is number 1 in the Pokédex?', 'Bulbasaur', ['Pikachu', 'Mew', 'Charmander']],
      ['What does Magikarp evolve into?', 'Gyarados', ['Seaking', 'Milotic', 'Dragonite']],
      ['Which Poké Ball never fails to catch a Pokémon?', 'The Master Ball', ['The Ultra Ball', 'The Great Ball', 'The Quick Ball']],
      ['Which Pokémon travels with Team Rocket and can talk?', 'Meowth', ['Persian', 'Ekans', 'Koffing']],
      ['Which Pokémon sings everyone to sleep, then draws on their faces?', 'Jigglypuff', ['Clefairy', 'Chansey', 'Togepi']],
      ['Which type is super effective against Fire?', 'Water', ['Grass', 'Ice', 'Bug']],
      ['Which huge Pokémon is famous for sleeping in the road?', 'Snorlax', ['Wailord', 'Onix', 'Slowpoke']],
      ['Which professor gives you your first Pokémon in Kanto?', 'Professor Oak', ['Professor Elm', 'Professor Birch', 'Professor Rowan']],
      ['What is Ash’s hometown?', 'Pallet Town', ['Viridian City', 'Cerulean City', 'Pewter City']],
      ['How many Pokémon were in the very first games?', '151', ['150', '100', '251']],
      ['Which Pokémon was made by cloning Mew?', 'Mewtwo', ['Deoxys', 'Genesect', 'Celebi']],
      ['Which stone turns Eevee into Vaporeon?', 'Water Stone', ['Fire Stone', 'Thunder Stone', 'Moon Stone']],
      ['Which of Eevee’s evolutions is Electric type?', 'Jolteon', ['Flareon', 'Espeon', 'Umbreon']],
      ['Gengar is which type?', 'Ghost', ['Dark', 'Psychic', 'Fairy']],
      ['Brock’s gym uses which type of Pokémon?', 'Rock', ['Steel', 'Fighting', 'Water']],
      ['Misty’s gym uses which type of Pokémon?', 'Water', ['Ice', 'Grass', 'Psychic']],
      ['Which of these is a Grass-type starter?', 'Chikorita', ['Cyndaquil', 'Totodile', 'Piplup']],
      ['What does Pikachu evolve into?', 'Raichu', ['Pichu', 'Plusle', 'Jolteon']],
      ['Which legendary Pokémon is on the cover of Pokémon Silver?', 'Lugia', ['Ho-Oh', 'Suicune', 'Rayquaza']],
      ['Charizard is Fire and which other type?', 'Flying', ['Dragon', 'Fighting', 'Rock']],
      ['What is the gadget that records every Pokémon you meet?', 'A Pokédex', ['A PokéNav', 'A Poké Ball', 'A PC']],
      ['Who is Ash’s first rival in the TV show?', 'Gary', ['Brock', 'Paul', 'Silver']],
    ],
  },
  {
    id: 'flags', name: 'World Flags', icon: '🚩',
    flags: [
      ['🇯🇵', 'Japan', ['China', 'South Korea', 'Bangladesh']],
      ['🇨🇦', 'Canada', ['Peru', 'Austria', 'Denmark']],
      ['🇧🇷', 'Brazil', ['Portugal', 'Argentina', 'Jamaica']],
      ['🇮🇳', 'India', ['Ireland', 'Niger', 'Italy']],
      ['🇩🇪', 'Germany', ['Belgium', 'Spain', 'Austria']],
      ['🇫🇷', 'France', ['Italy', 'The Netherlands', 'Russia']],
      ['🇮🇹', 'Italy', ['Ireland', 'Mexico', 'Hungary']],
      ['🇬🇧', 'The United Kingdom', ['Norway', 'Iceland', 'The United States']],
      ['🇲🇽', 'Mexico', ['Italy', 'Ireland', 'Hungary']],
      ['🇰🇷', 'South Korea', ['Japan', 'North Korea', 'Taiwan']],
      ['🇨🇭', 'Switzerland', ['Denmark', 'Austria', 'Turkey']],
      ['🇸🇪', 'Sweden', ['Norway', 'Finland', 'Denmark']],
      ['🇳🇴', 'Norway', ['Iceland', 'Denmark', 'Sweden']],
      ['🇬🇷', 'Greece', ['Israel', 'Finland', 'Uruguay']],
      ['🇹🇷', 'Turkey', ['Tunisia', 'Pakistan', 'Algeria']],
      ['🇦🇺', 'Australia', ['New Zealand', 'The United Kingdom', 'Fiji']],
      ['🇳🇿', 'New Zealand', ['Australia', 'Fiji', 'The United Kingdom']],
      ['🇿🇦', 'South Africa', ['Kenya', 'Jamaica', 'Nigeria']],
      ['🇯🇲', 'Jamaica', ['South Africa', 'Ghana', 'Brazil']],
      ['🇦🇷', 'Argentina', ['Uruguay', 'Greece', 'Honduras']],
      ['🇪🇬', 'Egypt', ['Iraq', 'Yemen', 'Syria']],
      ['🇮🇪', 'Ireland', ['Italy', 'Ivory Coast', 'India']],
      ['🇳🇱', 'The Netherlands', ['France', 'Russia', 'Croatia']],
      ['🇨🇳', 'China', ['Vietnam', 'Turkey', 'Japan']],
      ['🇵🇹', 'Portugal', ['Spain', 'Brazil', 'Mozambique']],
      ['🇪🇸', 'Spain', ['Portugal', 'Colombia', 'Germany']],
      ['🇳🇬', 'Nigeria', ['Ireland', 'Pakistan', 'Ghana']],
      ['🇮🇱', 'Israel', ['Greece', 'Finland', 'Argentina']],
      ['🇫🇮', 'Finland', ['Sweden', 'Iceland', 'Greece']],
      ['🇨🇺', 'Cuba', ['Chile', 'Panama', 'Greece']],
      ['🇺🇦', 'Ukraine', ['Sweden', 'Colombia', 'Kazakhstan']],
    ],
  },
  {
    id: 'space', name: 'Space', icon: '🚀',
    questions: [
      ['Which planet is best known for its bright rings?', 'Saturn', ['Jupiter', 'Uranus', 'Neptune']],
      ['Who was the first person to walk on the Moon?', 'Neil Armstrong', ['Buzz Aldrin', 'Yuri Gagarin', 'John Glenn']],
      ['Who was the first person in space?', 'Yuri Gagarin', ['Neil Armstrong', 'Alan Shepard', 'John Glenn']],
      ['In what year did people first land on the Moon?', '1969', ['1965', '1972', '1959']],
      ['Which is the hottest planet in our solar system?', 'Venus', ['Mercury', 'Mars', 'Jupiter']],
      ['What is the closest star to Earth?', 'The Sun', ['Proxima Centauri', 'Sirius', 'The North Star']],
      ['What is the name of our galaxy?', 'The Milky Way', ['Andromeda', 'The Whirlpool', 'The Sombrero']],
      ['Which planet spins on its side?', 'Uranus', ['Neptune', 'Saturn', 'Venus']],
      ['What is the largest moon of Saturn?', 'Titan', ['Europa', 'Ganymede', 'Io']],
      ['In 2006, Pluto was renamed as what?', 'A dwarf planet', ['An asteroid', 'A comet', 'A moon']],
      ['About how long does sunlight take to reach Earth?', '8 minutes', ['8 seconds', '8 hours', '1 minute']],
      ['Which NASA rover landed on Mars in 2021?', 'Perseverance', ['Curiosity', 'Opportunity', 'Spirit']],
      ['What is the giant storm on Jupiter called?', 'The Great Red Spot', ['The Great Dark Spot', 'The Big Eye', 'The Red Ring']],
      ['Which planet is called the Morning Star?', 'Venus', ['Mars', 'Mercury', 'Jupiter']],
      ['A light-year measures what?', 'Distance', ['Time', 'Speed', 'Brightness']],
      ['Which giant space telescope launched in 2021?', 'James Webb', ['Hubble', 'Kepler', 'Spitzer']],
      ['How many moons does Earth have?', '1', ['0', '2', '3']],
      ['What is the Sun mostly made of?', 'Hydrogen', ['Helium', 'Oxygen', 'Carbon']],
      ['Which country launched Sputnik, the first satellite?', 'The Soviet Union', ['The United States', 'China', 'Germany']],
      ['A space rock that lands on the ground is called what?', 'A meteorite', ['A meteor', 'A comet', 'A meteoroid']],
      ['What was Apollo 11’s Moon lander called?', 'Eagle', ['Columbia', 'Falcon', 'Odyssey']],
      ['Which planet is the smallest in our solar system?', 'Mercury', ['Mars', 'Venus', 'Pluto']],
    ],
  },
];

// Trivia Night packs that carry a franchise name.
const TRIVIA_BRANDS = new Set(['harry-potter', 'percy-jackson', 'marvel', 'disney']);

// The order players see. 'mixed' draws from every pack shown.
const ORDER = ['harry-potter', 'pokemon', 'us-states', 'flags', 'geography', 'space', 'science',
  'history', 'movies', 'disney', 'marvel', 'percy-jackson', 'tv', 'music', 'sports', 'animals', 'food', 'spelling'];

const PACKS = {};
for (const cat of OWN) {
  const rows = cat.flags
    ? cat.flags.map(([flag, a, wrong]) => ({ q: 'Which country’s flag is this?', art: flag, a, wrong }))
    : cat.questions.map(([q, a, wrong]) => ({ q, a, wrong }));
  PACKS[cat.id] = { id: cat.id, name: cat.name, icon: cat.icon, brand: !!cat.brand,
    questions: rows.map((r, i) => ({ id: `${cat.id}-${i}`, ...r })) };
}
for (const cat of trivia.CATEGORIES) {
  if (PACKS[cat.id]) continue;
  PACKS[cat.id] = { id: cat.id, name: cat.name, icon: cat.icon, brand: TRIVIA_BRANDS.has(cat.id),
    questions: trivia.questionsIn(cat.id).map(q => ({ id: q.id, q: q.q, a: q.a, wrong: q.wrong })) };
}

const shown = id => PACKS[id] && (BRANDED_PACKS || !PACKS[id].brand);
const visible = () => [...ORDER, ...Object.keys(PACKS).filter(id => !ORDER.includes(id))].filter(shown);

function categoryList() {
  const list = visible().map(id => ({ id, name: PACKS[id].name, icon: PACKS[id].icon }));
  return [{ id: 'mixed', name: 'A bit of everything', icon: '🎲' }, ...list];
}

function isCategory(id) { return id === 'mixed' || !!shown(id); }

function category(id) {
  if (id === 'mixed') return { id, name: 'A bit of everything', icon: '🎲' };
  const p = shown(id) ? PACKS[id] : null;
  return p ? { id, name: p.name, icon: p.icon } : null;
}

function questionsIn(id) {
  if (id === 'mixed') return visible().flatMap(c => PACKS[c].questions);
  return shown(id) ? PACKS[id].questions : [];
}

module.exports = { categoryList, isCategory, category, questionsIn, PACKS };
