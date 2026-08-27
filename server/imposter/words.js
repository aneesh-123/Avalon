// Word bank for the Imposter game.
// Each entry: word (what regulars see), related (a close-but-different word
// for the Confused Player / Double Agent), hint (a vague hint for hint mode).

const CATEGORIES = {
  'Food': [
    { word: 'Pizza',      related: 'Pasta',        hint: 'Italian food' },
    { word: 'Sushi',      related: 'Ramen',        hint: 'Japanese food' },
    { word: 'Tacos',      related: 'Burritos',     hint: 'Mexican food' },
    { word: 'Pancakes',   related: 'Waffles',      hint: 'Breakfast food' },
    { word: 'Ice Cream',  related: 'Frozen Yogurt',hint: 'Cold dessert' },
    { word: 'Burger',     related: 'Hot Dog',      hint: 'Fast food' },
    { word: 'Popcorn',    related: 'Nachos',       hint: 'Movie snack' },
    { word: 'Chocolate',  related: 'Candy',        hint: 'Sweet treat' },
    { word: 'Salad',      related: 'Soup',         hint: 'Light meal' },
    { word: 'Fried Rice', related: 'Noodles',      hint: 'Asian dish' },
    { word: 'Donut',      related: 'Muffin',       hint: 'Bakery item' },
    { word: 'Cheese',     related: 'Butter',       hint: 'Dairy product' },
    { word: 'Spaghetti',         related: 'Lasagna',               hint: 'Pasta dish' },
    { word: 'Pretzel',           related: 'Bagel',                 hint: 'Baked and twisted' },
    { word: 'Watermelon',        related: 'Cantaloupe',            hint: 'Summer fruit' },
    { word: 'Curry',             related: 'Stew',                  hint: 'Spiced saucy dish' },
    { word: 'Omelette',          related: 'Scrambled Eggs',        hint: 'Egg dish' },
    { word: 'Smoothie',          related: 'Milkshake',             hint: 'Blended drink' },
    { word: 'Dumplings',         related: 'Spring Rolls',          hint: 'Small wrapped bites' },
    { word: 'Cereal',            related: 'Oatmeal',               hint: 'Breakfast in a bowl' },
    { word: 'Steak',             related: 'Ribs',                  hint: 'Grilled meat' },
    { word: 'Apple Pie',         related: 'Cheesecake',            hint: 'Classic dessert' },
  ],
  'Animals': [
    { word: 'Tiger',      related: 'Lion',         hint: 'Big cat' },
    { word: 'Dolphin',    related: 'Whale',        hint: 'Ocean animal' },
    { word: 'Elephant',   related: 'Rhino',        hint: 'Large land animal' },
    { word: 'Penguin',    related: 'Seal',         hint: 'Cold-climate animal' },
    { word: 'Kangaroo',   related: 'Koala',        hint: 'Australian animal' },
    { word: 'Eagle',      related: 'Hawk',         hint: 'Bird of prey' },
    { word: 'Snake',      related: 'Lizard',       hint: 'Reptile' },
    { word: 'Monkey',     related: 'Gorilla',      hint: 'Primate' },
    { word: 'Shark',      related: 'Crocodile',    hint: 'Feared predator' },
    { word: 'Rabbit',     related: 'Hamster',      hint: 'Small fluffy pet' },
    { word: 'Owl',        related: 'Bat',          hint: 'Nocturnal animal' },
    { word: 'Horse',      related: 'Donkey',       hint: 'Farm animal you can ride' },
    { word: 'Wolf',              related: 'Fox',                   hint: 'Wild canine' },
    { word: 'Bear',              related: 'Panda',                 hint: 'Big furry mammal' },
    { word: 'Giraffe',           related: 'Zebra',                 hint: 'Tall African animal' },
    { word: 'Octopus',           related: 'Squid',                 hint: 'Many-armed sea creature' },
    { word: 'Turtle',            related: 'Tortoise',              hint: 'Shelled animal' },
    { word: 'Frog',              related: 'Toad',                  hint: 'Amphibian' },
    { word: 'Camel',             related: 'Llama',                 hint: 'Desert or mountain pack animal' },
    { word: 'Peacock',           related: 'Flamingo',              hint: 'Showy bird' },
    { word: 'Hippo',             related: 'Rhino',                 hint: 'Heavy river animal' },
    { word: 'Squirrel',          related: 'Chipmunk',              hint: 'Small tree-climbing animal' },
  ],
  'Places': [
    { word: 'Beach',      related: 'Desert',       hint: 'Sandy place' },
    { word: 'Library',    related: 'Bookstore',    hint: 'Quiet place with books' },
    { word: 'Airport',    related: 'Train Station',hint: 'Travel hub' },
    { word: 'Hospital',   related: 'Pharmacy',     hint: 'Medical place' },
    { word: 'Gym',        related: 'Swimming Pool',hint: 'Exercise place' },
    { word: 'Cinema',     related: 'Theater',      hint: 'Entertainment venue' },
    { word: 'School',     related: 'University',   hint: 'Learning place' },
    { word: 'Museum',     related: 'Art Gallery',  hint: 'Cultural place' },
    { word: 'Restaurant', related: 'Cafe',         hint: 'Eating place' },
    { word: 'Zoo',        related: 'Aquarium',     hint: 'Animal attraction' },
    { word: 'Casino',     related: 'Arcade',       hint: 'Games are played here' },
    { word: 'Farm',       related: 'Garden',       hint: 'Things grow here' },
    { word: 'Park',              related: 'Playground',            hint: 'Open green space' },
    { word: 'Stadium',           related: 'Arena',                 hint: 'Big crowd venue' },
    { word: 'Shopping Mall',     related: 'Market',                hint: 'Lots of shops together' },
    { word: 'Bridge',            related: 'Tunnel',                hint: 'Gets you across or through' },
    { word: 'Lighthouse',        related: 'Windmill',              hint: 'Tall lonely structure' },
    { word: 'Campsite',          related: 'Cabin',                 hint: 'Outdoor overnight spot' },
    { word: 'Church',            related: 'Temple',                hint: 'Place of worship' },
    { word: 'Subway Station',    related: 'Bus Stop',              hint: 'Where you wait to travel' },
    { word: 'Waterfall',         related: 'Volcano',               hint: 'Dramatic natural feature' },
    { word: 'Parking Garage',    related: 'Petrol Station',        hint: 'Somewhere cars stop' },
  ],
  'Countries': [
    { word: 'Japan',      related: 'China',        hint: 'Asian country' },
    { word: 'Brazil',     related: 'Argentina',    hint: 'South American country' },
    { word: 'Egypt',      related: 'Morocco',      hint: 'African country' },
    { word: 'France',     related: 'Italy',        hint: 'European country' },
    { word: 'Australia',  related: 'New Zealand',  hint: 'Island nation' },
    { word: 'Canada',     related: 'Russia',       hint: 'Cold northern country' },
    { word: 'India',      related: 'Pakistan',     hint: 'Very populous country' },
    { word: 'Mexico',     related: 'Spain',        hint: 'Spanish-speaking country' },
    { word: 'Greece',     related: 'Turkey',       hint: 'Mediterranean country' },
    { word: 'Switzerland',related: 'Austria',      hint: 'Mountainous country' },
    { word: 'Italy',             related: 'Spain',                 hint: 'European country' },
    { word: 'Germany',           related: 'Netherlands',           hint: 'Northern European country' },
    { word: 'China',             related: 'South Korea',           hint: 'East Asian country' },
    { word: 'Thailand',          related: 'Vietnam',               hint: 'Southeast Asian country' },
    { word: 'Kenya',             related: 'Nigeria',               hint: 'African country' },
    { word: 'Norway',            related: 'Sweden',                hint: 'Scandinavian country' },
    { word: 'Argentina',         related: 'Chile',                 hint: 'South American country' },
    { word: 'Portugal',          related: 'Ireland',               hint: 'Coastal European country' },
    { word: 'Turkey',            related: 'Iran',                  hint: 'Country spanning cultures' },
    { word: 'Iceland',           related: 'Greenland',             hint: 'Cold island country' },
  ],
  'Sports': [
    { word: 'Basketball', related: 'Volleyball',   hint: 'Ball sport with a net or hoop' },
    { word: 'Soccer',     related: 'Rugby',        hint: 'Field sport' },
    { word: 'Tennis',     related: 'Badminton',    hint: 'Racket sport' },
    { word: 'Swimming',   related: 'Diving',       hint: 'Water sport' },
    { word: 'Boxing',     related: 'Wrestling',    hint: 'Combat sport' },
    { word: 'Golf',       related: 'Cricket',      hint: 'Sport with clubs or bats' },
    { word: 'Skiing',     related: 'Snowboarding', hint: 'Winter sport' },
    { word: 'Baseball',   related: 'Softball',     hint: 'Bat-and-ball sport' },
    { word: 'Hockey',     related: 'Lacrosse',     hint: 'Stick sport' },
    { word: 'Marathon',   related: 'Triathlon',    hint: 'Endurance event' },
    { word: 'Volleyball',        related: 'Handball',              hint: 'Team ball sport' },
    { word: 'Cycling',           related: 'Rowing',                hint: 'Endurance racing' },
    { word: 'Gymnastics',        related: 'Figure Skating',        hint: 'Judged routine sport' },
    { word: 'Surfing',           related: 'Skateboarding',         hint: 'Board sport' },
    { word: 'Archery',           related: 'Fencing',               hint: 'Precision target or duel sport' },
    { word: 'Rugby',             related: 'American Football',     hint: 'Heavy contact team sport' },
    { word: 'Table Tennis',      related: 'Squash',                hint: 'Small indoor racket sport' },
    { word: 'Rock Climbing',     related: 'Bouldering',            hint: 'Climbing sport' },
    { word: 'Karate',            related: 'Judo',                  hint: 'Martial art' },
    { word: 'Formula 1',         related: 'NASCAR',                hint: 'Motor racing' },
  ],
  'Jobs': [
    { word: 'Doctor',     related: 'Nurse',        hint: 'Medical profession' },
    { word: 'Teacher',    related: 'Professor',    hint: 'Education profession' },
    { word: 'Chef',       related: 'Baker',        hint: 'Kitchen profession' },
    { word: 'Pilot',      related: 'Flight Attendant', hint: 'Aviation profession' },
    { word: 'Firefighter',related: 'Police Officer',   hint: 'Emergency service' },
    { word: 'Lawyer',     related: 'Judge',        hint: 'Legal profession' },
    { word: 'Farmer',     related: 'Fisherman',    hint: 'Works outdoors' },
    { word: 'Dentist',    related: 'Surgeon',      hint: 'Works with precise tools' },
    { word: 'Actor',      related: 'Musician',     hint: 'Performer' },
    { word: 'Plumber',    related: 'Electrician',  hint: 'Trade profession' },
    { word: 'Nurse',             related: 'Paramedic',             hint: 'Cares for the sick' },
    { word: 'Architect',         related: 'Engineer',              hint: 'Designs how things are built' },
    { word: 'Journalist',        related: 'Photographer',          hint: 'Reports on events' },
    { word: 'Barber',            related: 'Tailor',                hint: 'Works on your appearance' },
    { word: 'Mechanic',          related: 'Carpenter',             hint: 'Works with tools and hands' },
    { word: 'Librarian',         related: 'Archivist',             hint: 'Looks after collections' },
    { word: 'Scientist',         related: 'Researcher',            hint: 'Works in a lab' },
    { word: 'Waiter',            related: 'Bartender',             hint: 'Serves customers' },
    { word: 'Police Officer',    related: 'Security Guard',        hint: 'Keeps order' },
    { word: 'Accountant',        related: 'Banker',                hint: 'Works with money' },
  ],
  'Household Objects': [
    { word: 'Microwave',  related: 'Oven',         hint: 'Kitchen appliance' },
    { word: 'Pillow',     related: 'Blanket',      hint: 'Bedroom item' },
    { word: 'Mirror',     related: 'Window',       hint: 'You can see through or in it' },
    { word: 'Umbrella',   related: 'Raincoat',     hint: 'Rain protection' },
    { word: 'Scissors',   related: 'Knife',        hint: 'Cutting tool' },
    { word: 'Toothbrush', related: 'Hairbrush',    hint: 'Bathroom item' },
    { word: 'Ladder',     related: 'Stool',        hint: 'Helps you reach high places' },
    { word: 'Candle',     related: 'Flashlight',   hint: 'Light source' },
    { word: 'Vacuum',     related: 'Broom',        hint: 'Cleaning tool' },
    { word: 'Kettle',     related: 'Coffee Maker', hint: 'Makes hot drinks' },
    { word: 'Fridge',            related: 'Freezer',               hint: 'Keeps things cold' },
    { word: 'Sofa',              related: 'Armchair',              hint: 'You sit on it' },
    { word: 'Lamp',              related: 'Chandelier',            hint: 'Lights a room' },
    { word: 'Clock',             related: 'Calendar',              hint: 'Tells you the time or date' },
    { word: 'Towel',             related: 'Bathrobe',              hint: 'Used after a shower' },
    { word: 'Curtains',          related: 'Blinds',                hint: 'Covers a window' },
    { word: 'Toaster',           related: 'Blender',               hint: 'Small kitchen appliance' },
    { word: 'Bucket',            related: 'Mop',                   hint: 'Used for cleaning up' },
    { word: 'Bookshelf',         related: 'Wardrobe',              hint: 'Stores your things' },
    { word: 'Iron',              related: 'Hairdryer',             hint: 'Heats up and you hold it' },
  ],
  'Technology': [
    { word: 'Smartphone', related: 'Tablet',       hint: 'Handheld device' },
    { word: 'Laptop',     related: 'Desktop',      hint: 'Computer' },
    { word: 'Headphones', related: 'Speakers',     hint: 'Audio device' },
    { word: 'Drone',      related: 'Robot',        hint: 'Modern gadget' },
    { word: 'Keyboard',   related: 'Mouse',        hint: 'Computer accessory' },
    { word: 'WiFi',       related: 'Bluetooth',    hint: 'Wireless connection' },
    { word: 'Camera',     related: 'Projector',    hint: 'Deals with images' },
    { word: 'Printer',    related: 'Scanner',      hint: 'Office machine' },
    { word: 'Smartwatch', related: 'Fitness Tracker', hint: 'Wearable tech' },
    { word: 'Charger',    related: 'Battery',      hint: 'Powers your devices' },
    { word: 'Television',        related: 'Monitor',               hint: 'Screen you look at' },
    { word: 'Router',            related: 'Modem',                 hint: 'Gets you online' },
    { word: 'USB Drive',         related: 'Hard Drive',            hint: 'Stores files' },
    { word: 'Game Console',      related: 'Controller',            hint: 'For playing games' },
    { word: 'Electric Car',      related: 'Hybrid',                hint: 'Modern vehicle' },
    { word: 'Solar Panel',       related: 'Wind Turbine',          hint: 'Generates clean power' },
    { word: 'Password',          related: 'Fingerprint',           hint: 'Unlocks something' },
    { word: 'Podcast',           related: 'Radio',                 hint: 'You listen to it' },
    { word: 'Cloud Storage',     related: 'Backup',                hint: 'Keeps your files safe elsewhere' },
    { word: 'Bluetooth Speaker', related: 'Soundbar',              hint: 'Plays audio out loud' },
  ],
  'Movies & TV': [
    { word: 'Titanic',        related: 'The Notebook',  hint: 'Romantic movie' },
    { word: 'Harry Potter',   related: 'Lord of the Rings', hint: 'Fantasy franchise' },
    { word: 'Star Wars',      related: 'Star Trek',     hint: 'Space franchise' },
    { word: 'Spider-Man',     related: 'Batman',        hint: 'Superhero' },
    { word: 'Frozen',         related: 'Moana',         hint: 'Animated musical' },
    { word: 'Jurassic Park',  related: 'King Kong',     hint: 'Giant creature movie' },
    { word: 'The Office',     related: 'Friends',       hint: 'Sitcom' },
    { word: 'Stranger Things',related: 'The X-Files',   hint: 'Sci-fi mystery show' },
    { word: 'Shrek',          related: 'Kung Fu Panda', hint: 'Animated comedy' },
    { word: 'Avengers',       related: 'Justice League',hint: 'Superhero team' },
    { word: 'Toy Story',         related: 'Finding Nemo',          hint: 'Pixar film' },
    { word: 'Breaking Bad',      related: 'The Sopranos',          hint: 'Gritty drama series' },
    { word: 'Game of Thrones',   related: 'Vikings',               hint: 'Epic historical fantasy' },
    { word: 'The Lion King',     related: 'Tarzan',                hint: 'Disney animal film' },
    { word: 'Superman',          related: 'Batman',                hint: 'DC superhero' },
    { word: 'Indiana Jones',     related: 'Pirates of the Caribbean', hint: 'Adventure franchise' },
    { word: 'The Matrix',        related: 'Inception',             hint: 'Mind-bending sci-fi' },
    { word: 'SpongeBob',         related: 'Scooby-Doo',            hint: 'Cartoon series' },
    { word: 'Squid Game',        related: 'Money Heist',           hint: 'Foreign-language hit series' },
    { word: 'Barbie',            related: 'Oppenheimer',           hint: 'Huge 2023 release' },
  ],
  'Music': [
    { word: 'Guitar',     related: 'Violin',       hint: 'String instrument' },
    { word: 'Piano',      related: 'Organ',        hint: 'Keyboard instrument' },
    { word: 'Drums',      related: 'Tambourine',   hint: 'Percussion instrument' },
    { word: 'Concert',    related: 'Festival',     hint: 'Live music event' },
    { word: 'Rap',        related: 'Rock',         hint: 'Music genre' },
    { word: 'Karaoke',    related: 'Choir',        hint: 'Group singing' },
    { word: 'DJ',         related: 'Conductor',    hint: 'Leads the music' },
    { word: 'Trumpet',    related: 'Saxophone',    hint: 'Brass or wind instrument' },
    { word: 'Opera',      related: 'Ballet',       hint: 'Classical performance' },
    { word: 'Microphone', related: 'Amplifier',    hint: 'Stage equipment' },
    { word: 'Violin',            related: 'Cello',                 hint: 'String instrument' },
    { word: 'Saxophone',         related: 'Clarinet',              hint: 'Woodwind instrument' },
    { word: 'Choir',             related: 'Band',                  hint: 'Group that performs together' },
    { word: 'Festival',          related: 'Tour',                  hint: 'Live music event' },
    { word: 'Lyrics',            related: 'Melody',                hint: 'Part of a song' },
    { word: 'Vinyl',             related: 'Cassette',              hint: 'Old music format' },
    { word: 'Jazz',              related: 'Blues',                 hint: 'Music genre' },
    { word: 'Album',             related: 'Playlist',              hint: 'Collection of songs' },
    { word: 'Encore',            related: 'Soundcheck',            hint: 'Happens around a performance' },
    { word: 'Busker',            related: 'Street Performer',      hint: 'Plays in public for coins' },
  ],
  'School': [
    { word: 'Homework',   related: 'Exam',         hint: 'Students dread it' },
    { word: 'Recess',     related: 'Lunch Break',  hint: 'Free time at school' },
    { word: 'Backpack',   related: 'Locker',       hint: 'Holds your school stuff' },
    { word: 'Math',       related: 'Physics',      hint: 'Subject with numbers' },
    { word: 'Whiteboard', related: 'Projector',    hint: 'Front of the classroom' },
    { word: 'Principal',  related: 'Counselor',    hint: 'School authority figure' },
    { word: 'Graduation', related: 'Prom',         hint: 'End-of-school event' },
    { word: 'Detention',  related: 'Suspension',   hint: 'School punishment' },
    { word: 'Field Trip', related: 'Assembly',     hint: 'Break from normal classes' },
    { word: 'Report Card',related: 'Diploma',      hint: 'School document' },
    { word: 'Exam',              related: 'Quiz',                  hint: 'Tests what you know' },
    { word: 'Classroom',         related: 'Lecture Hall',          hint: 'Room in a school' },
    { word: 'Uniform',           related: 'Locker',                hint: 'School-specific thing' },
    { word: 'Cafeteria',         related: 'Common Room',           hint: 'Where students gather' },
    { word: 'Textbook',          related: 'Notebook',              hint: 'You read or write in it' },
    { word: 'Science Lab',       related: 'Art Room',              hint: 'Specialist classroom' },
    { word: 'School Bus',        related: 'Bike Rack',             hint: 'How you get there' },
    { word: 'Assembly',          related: 'Parents Evening',       hint: 'Scheduled school gathering' },
    { word: 'Substitute Teacher', related: 'Head of Year',          hint: 'Adult at school' },
    { word: 'Group Project',     related: 'Presentation',          hint: 'Assigned work' },
  ],
  'Travel': [
    { word: 'Passport',   related: 'Visa',         hint: 'Travel document' },
    { word: 'Suitcase',   related: 'Backpack',     hint: 'Carries your belongings' },
    { word: 'Hotel',      related: 'Hostel',       hint: 'Place to stay' },
    { word: 'Cruise',     related: 'Ferry',        hint: 'Trip on water' },
    { word: 'Road Trip',  related: 'Camping',      hint: 'Adventure by land' },
    { word: 'Jet Lag',    related: 'Layover',      hint: 'Annoyance of long flights' },
    { word: 'Souvenir',   related: 'Postcard',     hint: 'Reminder of a trip' },
    { word: 'Tourist',    related: 'Tour Guide',   hint: 'Person on vacation sights' },
    { word: 'Map',        related: 'Compass',      hint: 'Helps you navigate' },
    { word: 'Luggage',    related: 'Boarding Pass',hint: 'Airport essential' },
    { word: 'Visa',              related: 'Boarding Pass',         hint: 'Document you need' },
    { word: 'Beach Resort',      related: 'Ski Lodge',             hint: 'Holiday accommodation' },
    { word: 'Sightseeing',       related: 'Hiking',                hint: 'Holiday activity' },
    { word: 'Currency Exchange', related: 'Duty Free',             hint: 'Found at airports' },
    { word: 'Delay',             related: 'Turbulence',            hint: 'Travel annoyance' },
    { word: 'Postcard',          related: 'Fridge Magnet',         hint: 'Bought on holiday' },
    { word: 'Sunscreen',         related: 'Insect Repellent',      hint: 'Packed for hot places' },
    { word: 'Layover',           related: 'Connecting Flight',     hint: 'Part of a long journey' },
    { word: 'Guidebook',         related: 'Phrasebook',            hint: 'Read before you go' },
  ],
};

function categoryNames() {
  return Object.keys(CATEGORIES);
}

// Just the words per category, for the host to preview while setting up a game.
// Deliberately omits `related` and `hint`, which are imposter-facing.
function categoryWords() {
  return Object.fromEntries(
    Object.entries(CATEGORIES).map(([name, entries]) => [name, entries.map(e => e.word)]));
}

// Words the host adds themselves become a category like any other, so they can
// be toggled on and off — and, unlike custom-word mode, the host does not learn
// which one was drawn and can still play.
const CUSTOM_CATEGORY = 'Your Words';

function buildBank(customWords) {
  const clean = (customWords || []).map(w => String(w).trim()).filter(Boolean);
  if (!clean.length) return CATEGORIES;
  return {
    ...CATEGORIES,
    [CUSTOM_CATEGORY]: clean.map(word => ({ word, related: null, hint: 'A word the host added' })),
  };
}

const randomOf = arr => arr[Math.floor(Math.random() * arr.length)];

// Pick a random word entry. `allowedCategories` limits the pool (empty/null = all).
function pickWord(allowedCategories, customWords) {
  const bank = buildBank(customWords);
  const all = Object.keys(bank);
  const names = all.filter(c =>
    !allowedCategories || allowedCategories.length === 0 || allowedCategories.includes(c));
  const pool = names.length ? names : all;
  const category = randomOf(pool);
  const entries = bank[category];
  const entry = randomOf(entries);

  // Host-added words have no paired `related`, which the Confused player and
  // Double Agent are built from — without one the Confused player would be
  // handed the true word and silently become an ordinary Regular. Borrow a
  // different word to stand in.
  let related = entry.related;
  if (!related) {
    const siblings = entries.filter(e => e.word !== entry.word);
    const fallbackPool = siblings.length
      ? siblings
      : Object.values(CATEGORIES).flat().filter(e => e.word !== entry.word);
    related = fallbackPool.length ? randomOf(fallbackPool).word : null;
  }
  return { category, ...entry, related };
}

module.exports = { CATEGORIES, CUSTOM_CATEGORY, categoryNames, categoryWords, pickWord };
