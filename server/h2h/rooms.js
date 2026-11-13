// Head to Head rooms live in their own map so the other games' room lookups
// never see them, and vice versa.
const h2hRooms = {};

function getH2hRoom(code) { return h2hRooms[String(code || '').trim().toUpperCase()]; }

function getH2hRoomOf(sockId) {
  return Object.values(h2hRooms).find(r => r.players.some(p => p.id === sockId));
}

function randomH2hCode() {
  let code;
  do { code = Math.random().toString(36).substring(2, 7).toUpperCase(); }
  while (code.length !== 5 || h2hRooms[code]);
  return code;
}

let pidSeq = 0;
const newPid = () => 'h' + Date.now().toString(36) + (pidSeq++).toString(36);

module.exports = { h2hRooms, getH2hRoom, getH2hRoomOf, randomH2hCode, newPid };
