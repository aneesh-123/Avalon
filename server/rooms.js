const rooms = {};

function getRoom(code)     { return rooms[code]; }
function getRoomOf(sockId) { return Object.values(rooms).find(r => r.players.some(p => p.id === sockId)); }
function getRoomOfToken(token) { return token ? Object.values(rooms).find(r => r.players.some(p => p.token === token)) : null; }

function randomCode() { return Math.random().toString(36).substring(2, 7).toUpperCase(); }

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = { rooms, getRoom, getRoomOf, getRoomOfToken, randomCode, shuffle };
