// Imposter rooms live in their own map so the Avalon handlers' room lookups
// (getRoomOf on the avalon map) never see them, and vice versa.
const impRooms = {};

function getImpRoom(code)     { return impRooms[code]; }
function getImpRoomOf(sockId) { return Object.values(impRooms).find(r => r.players.some(p => p.id === sockId)); }

function randomImpCode() {
  let code;
  do { code = Math.random().toString(36).substring(2, 7).toUpperCase(); }
  while (impRooms[code]);
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

module.exports = { impRooms, getImpRoom, getImpRoomOf, randomImpCode, shuffle };
