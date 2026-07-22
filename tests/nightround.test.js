/**
 * Night Round tests — the optional scripted eyes-open/eyes-closed reveal
 * that plays out between role assignment and the first quest.
 */

const registerHandlers = require('../server/socketHandlers');
const { rooms }        = require('../server/rooms');
const { buildNightRoundScript } = require('../server/roles');
const { makeIo, connectSocket, buildRoom, clearRooms } = require('./helpers');

jest.mock('../server/db', () => ({
  saveRoom:   () => Promise.resolve(),
  deleteRoom: () => Promise.resolve(),
  loadRooms:  () => Promise.resolve([]),
}));

let io;
beforeEach(() => {
  clearRooms();
  ({ io } = makeIo());
  registerHandlers(io);
});

function makePlayers(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, name: `Player${i + 1}` }));
}

function connectAll(io, playerDefs, roomCode) {
  return playerDefs.map(({ id }) => {
    const socket = connectSocket(io, id);
    if (roomCode) socket.join(roomCode);
    return socket;
  });
}

test('toggle-ready enters night-round phase instead of team-select when enabled', () => {
  const playerDefs = makePlayers(5);
  const room = buildRoom('NIGHT1', playerDefs, {
    roleConfig: { evilCount: 2, goodSpecials: [], evilSpecials: [], ladyOfLake: false, nightRound: true },
  });
  const sockets = connectAll(io, playerDefs, room.code);

  sockets.forEach(s => s.trigger('toggle-ready'));

  expect(room.state).toBe('playing');
  expect(room.phase).toBe('night-round');
});

test('toggle-ready goes straight to team-select when disabled (default)', () => {
  const playerDefs = makePlayers(5);
  const room = buildRoom('NIGHT2', playerDefs, {
    roleConfig: { evilCount: 2, goodSpecials: [], evilSpecials: [], ladyOfLake: false },
  });
  const sockets = connectAll(io, playerDefs, room.code);

  sockets.forEach(s => s.trigger('toggle-ready'));

  expect(room.phase).toBe('team-select');
});

test('only the starting leader can dismiss the night round, moving to team-select', () => {
  const playerDefs = makePlayers(5);
  const room = buildRoom('NIGHT3', playerDefs, {
    roleConfig: { evilCount: 2, goodSpecials: [], evilSpecials: [], ladyOfLake: false, nightRound: true },
  });
  const sockets = connectAll(io, playerDefs, room.code);
  sockets.forEach(s => s.trigger('toggle-ready'));

  const leaderSocket = sockets[room.currentLeaderIndex];
  const otherSocket  = sockets[(room.currentLeaderIndex + 1) % 5];

  // Non-leader tapping the button is a no-op.
  otherSocket.trigger('night-round-continue');
  expect(room.phase).toBe('night-round');

  leaderSocket.trigger('night-round-continue');
  expect(room.phase).toBe('team-select');
});

describe('buildNightRoundScript', () => {
  test('includes Percival/Merlin exclusion notes only when those roles are in play', () => {
    const base = buildNightRoundScript({ evilCount: 2, goodSpecials: [], evilSpecials: [] });
    expect(base.join(' ')).not.toMatch(/Percival/);
    expect(base.join(' ')).not.toMatch(/EXCEPT Mordred/);

    const full = buildNightRoundScript({
      evilCount: 3, goodSpecials: ['Percival'], evilSpecials: ['Morgana', 'Mordred', 'Oberon'],
    });
    expect(full.join(' ')).toMatch(/Merlin and Morgana, put your thumbs up\. Percival, open your eyes/);
    expect(full.join(' ')).toMatch(/Percival, close your eyes\. Merlin and Morgana, put your thumbs down/);
    expect(full.join(' ')).toMatch(/EXCEPT Mordred, put your thumbs up/);
    expect(full.join(' ')).toMatch(/Oberon: thumb up too/);
    expect(full.join(' ')).toMatch(/Merlin, close your eyes\. Everyone evil, put your thumbs down/);
    expect(full.join(' ')).toMatch(/EXCEPT Oberon/);
    expect(full.join(' ')).toMatch(/Oberon: keep your eyes closed/);
  });

  test('skips the minions step entirely when there is only one evil player', () => {
    const script = buildNightRoundScript({ evilCount: 1, goodSpecials: [], evilSpecials: [] });
    expect(script.join(' ')).not.toMatch(/Minions of Mordred/);
  });
});
