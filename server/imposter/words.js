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
  ],
};

function categoryNames() {
  return Object.keys(CATEGORIES);
}

// Pick a random word entry. `allowedCategories` limits the pool (empty/null = all).
function pickWord(allowedCategories) {
  const names = categoryNames().filter(c =>
    !allowedCategories || allowedCategories.length === 0 || allowedCategories.includes(c));
  const pool = names.length ? names : categoryNames();
  const category = pool[Math.floor(Math.random() * pool.length)];
  const entries = CATEGORIES[category];
  const entry = entries[Math.floor(Math.random() * entries.length)];
  return { category, ...entry };
}

module.exports = { CATEGORIES, categoryNames, pickWord };
