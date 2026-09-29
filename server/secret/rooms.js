// Secret Hitler rooms live in their own map so the other games' room lookups
// never see them, and vice versa.
const secRooms = {};

function getSecRoom(code) { return secRooms[String(code || '').trim().toUpperCase()]; }

// The room a socket is seated in, if any. One seat per socket.
function getSecRoomOf(sockId) {
  return Object.values(secRooms).find(r => r.players.some(p => p.id === sockId));
}

function randomSecCode() {
  let code;
  do { code = Math.random().toString(36).substring(2, 7).toUpperCase(); }
  while (code.length !== 5 || secRooms[code]);   // the join form requires five
  return code;
}

module.exports = { secRooms, getSecRoom, getSecRoomOf, randomSecCode };
