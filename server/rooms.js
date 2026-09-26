const rooms = {};

function getRoom(code)     { return rooms[code]; }
function getRoomOf(sockId) { return Object.values(rooms).find(r => r.players.some(p => p.id === sockId)); }
function getRoomOfToken(token) { return token ? Object.values(rooms).find(r => r.players.some(p => p.token === token)) : null; }

// Always exactly five characters — the client rejects any other length, and
// Math.random().toString(36) occasionally yields fewer digits — and never a
// code already in use, which would silently replace a live room.
function randomCode() {
  let code;
  do { code = Math.random().toString(36).substring(2, 7).toUpperCase(); }
  while (code.length !== 5 || rooms[code]);
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

module.exports = { rooms, getRoom, getRoomOf, getRoomOfToken, randomCode, shuffle };
