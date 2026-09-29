// Trivia rooms live in their own map so the Avalon and Imposter handlers'
// room lookups never see them, and vice versa.
const trivRooms = {};

function getTrivRoom(code) { return trivRooms[String(code || '').trim().toUpperCase()]; }

// The room a socket is seated in, if any. Trivia allows one seat per socket.
function getTrivRoomOf(sockId) {
  return Object.values(trivRooms).find(r => r.players.some(p => p.id === sockId));
}

// The same token can only hold one seat, but may have one in several rooms
// over an evening; the caller narrows by code where it has one.
function getTrivRoomOfToken(token) {
  if (!token) return null;
  return Object.values(trivRooms).find(r => r.players.some(p => p.token === token));
}

function randomTrivCode() {
  let code;
  do { code = Math.random().toString(36).substring(2, 7).toUpperCase(); }
  while (code.length !== 5 || trivRooms[code]);   // the join form requires five
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

module.exports = { trivRooms, getTrivRoom, getTrivRoomOf, getTrivRoomOfToken, randomTrivCode, shuffle };
