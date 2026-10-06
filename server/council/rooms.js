// Council rooms live in their own map so the other games' room lookups never
// see them, and vice versa.
const councilRooms = {};

function getCouncilRoom(code) { return councilRooms[String(code || '').trim().toUpperCase()]; }

function getCouncilRoomOf(sockId) {
  return Object.values(councilRooms).find(r => r.players.some(p => p.id === sockId));
}

function randomCouncilCode() {
  let code;
  do { code = Math.random().toString(36).substring(2, 7).toUpperCase(); }
  while (code.length !== 5 || councilRooms[code]);
  return code;
}

let pidSeq = 0;
const newPid = () => 'p' + Date.now().toString(36) + (pidSeq++).toString(36);

module.exports = { councilRooms, getCouncilRoom, getCouncilRoomOf, randomCouncilCode, newPid };
