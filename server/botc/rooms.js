// Clocktower rooms live in their own map, same as Imposter's — the Avalon and
// Imposter handlers look up rooms in their own stores, so a code collision
// across games is harmless.
const botcRooms = {};

function getBotcRoom(code)     { return botcRooms[code]; }
function getBotcRoomOf(sockId) { return Object.values(botcRooms).find(r => r.players.some(p => p.id === sockId)); }

function randomBotcCode() {
  let code;
  do { code = Math.random().toString(36).substring(2, 7).toUpperCase(); }
  while (botcRooms[code]);
  return code;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = { botcRooms, getBotcRoom, getBotcRoomOf, randomBotcCode, shuffle };
