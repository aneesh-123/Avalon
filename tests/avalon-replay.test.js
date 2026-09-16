/**
 * Replaying a room, and changing the setup while people are still gathering.
 *
 * Before this, a finished room was destroyed the moment everyone tapped through
 * the game-over screen — which killed the invite link and the QR with it. These
 * tests exist mostly to catch state leaking from one game into the next.
 */

const registerHandlers = require('../server/socketHandlers');
const { rooms }        = require('../server/rooms');
const { lobbyState }   = require('../server/state');
const { makeIo, connectSocket, buildRoom, startGame, clearRooms } = require('./helpers');

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

const makePlayers = n => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, name: `Player${i + 1}` }));

function finishedRoom(code = 'DONE1') {
  const players = makePlayers(5);
  const room = buildRoom(code, players, { state: 'playing' });
  startGame(room);
  // Leave a thoroughly dirty room behind, so a lazy reset shows up.
  room.phase = 'game-over';
  room.winner = 'evil';
  room.winReason = '5 teams rejected in a row';
  room.consecutiveRejections = 5;
  room.campaignResults = ['pass', 'fail', 'pass'];
  room.questHistory = [{ campaign: 0, fails: 0 }];
  room.currentCampaign = 3;
  room.proposedTeam = ['s1', 's2'];
  room.teamVotes = { s1: 'approve' };
  room.questVotes = { s1: 'pass' };
  room.lastTeamVoteResult = { approved: false };
  room.lastQuestResult = { fails: 1 };
  room.ladyHolder = 's3';
  room.ladyUsed = ['s3'];
  room.ladyHistory = [{ from: 's3', to: 's4' }];
  room.pendingDispute = { campaign: 1 };

  const sockets = players.map(p => { const s = connectSocket(io, p.id); s.join(code); return s; });
  return { room, sockets, players };
}

// ── Replay ────────────────────────────────────────────────────────────────

describe('playing again in the same room', () => {
  test('the room survives and keeps its code', () => {
    const { room, sockets } = finishedRoom();
    sockets[0].trigger('play-again');

    expect(rooms['DONE1']).toBeDefined();
    expect(room.code).toBe('DONE1');
    expect(room.state).toBe('lobby');
    expect(room.players).toHaveLength(5);
  });

  test('nothing from the last game leaks into the next one', () => {
    const { room, sockets } = finishedRoom();
    sockets[0].trigger('play-again');

    expect(room.winner).toBeNull();
    expect(room.winReason).toBeNull();
    expect(room.phase).toBeNull();
    expect(room.consecutiveRejections).toBe(0);
    expect(room.campaignResults).toEqual([]);
    expect(room.questHistory).toEqual([]);
    expect(room.currentCampaign).toBe(0);
    expect(room.proposedTeam).toEqual([]);
    expect(room.teamVotes).toEqual({});
    expect(room.questVotes).toEqual({});
    expect(room.lastTeamVoteResult).toBeNull();
    expect(room.lastQuestResult).toBeNull();
    expect(room.ladyHolder).toBeNull();
    expect(room.ladyUsed).toEqual([]);
    expect(room.ladyHistory).toEqual([]);
    expect(room.pendingDispute).toBeNull();
    expect(room.assassinId).toBeNull();
    expect(room.players.every(p => p.role === null)).toBe(true);
    expect(room.players.every(p => p.ready === false)).toBe(true);
  });

  test('the settings carry over so the host does not reconfigure', () => {
    const { room, sockets } = finishedRoom();
    const beforeCount = room.playerCount;
    const beforeEvil  = room.roleConfig.evilCount;
    sockets[0].trigger('play-again');

    expect(room.playerCount).toBe(beforeCount);
    expect(room.roleConfig.evilCount).toBe(beforeEvil);
    expect(room.campaignsConfig).toBeTruthy();
  });

  test('everyone is sent back to the lobby', () => {
    const { sockets } = finishedRoom();
    sockets.forEach(s => { s.emitLog.length = 0; });
    sockets[0].trigger('play-again');

    expect(sockets[3].received('back-to-lobby')).toBe(true);
    expect(sockets[3].received('lobby-update')).toBe(true);
  });

  test('players who walked out during the game are not carried over', () => {
    const { room, sockets } = finishedRoom();
    room.disconnected = ['Player4'];
    sockets[0].trigger('play-again');

    expect(room.players.map(p => p.name)).not.toContain('Player4');
    expect(room.players).toHaveLength(4);
    expect(room.disconnected).toEqual([]);
  });

  test('only the host can start another game', () => {
    const { room, sockets } = finishedRoom();
    sockets[2].trigger('play-again');
    expect(room.state).toBe('playing');
    expect(sockets[2].last('action-error')).toMatch(/host/i);
  });

  test('it cannot be used to reset a game in progress', () => {
    const { room, sockets } = finishedRoom();
    room.phase = 'team-select';
    sockets[0].trigger('play-again');
    expect(room.state).toBe('playing');
    expect(room.phase).toBe('team-select');
  });

  test('a second game can actually be started in the reused room', () => {
    const { room, sockets } = finishedRoom();
    sockets[0].trigger('play-again');
    sockets.forEach(s => s.trigger('toggle-ready'));

    expect(room.state).toBe('playing');
    expect(room.players.every(p => p.role !== null)).toBe(true);
    expect(rooms['DONE1']).toBeDefined();          // same room, same code
  });
});

// ── Lobby settings ────────────────────────────────────────────────────────

describe('changing the setup from the lobby', () => {
  function lobby(code = 'LOB1', n = 5, target = 6) {
    const players = makePlayers(n);
    const room = buildRoom(code, players, { state: 'lobby', playerCount: target });
    const sockets = players.map(p => { const s = connectSocket(io, p.id); s.join(code); return s; });
    return { room, sockets };
  }
  const settings = (count, evil) => ({
    playerCount: count,
    roleConfig: { evilCount: evil, goodSpecials: [], evilSpecials: [] },
    campaignsConfig: Array.from({ length: 5 }, () => ({ teamSize: 2, failsNeeded: 1 })),
  });

  test('the host can drop the target when someone bails', () => {
    const { room, sockets } = lobby();               // 5 here, 6 expected
    sockets[0].trigger('update-settings', settings(5, 2));
    expect(room.playerCount).toBe(5);
  });

  test('the target cannot go below the people already here', () => {
    const { room, sockets } = lobby('LOB2', 6, 6);
    sockets[0].trigger('update-settings', settings(5, 2));
    expect(room.playerCount).toBe(6);
    expect(sockets[0].last('action-error')).toMatch(/already joined/i);
  });

  test('the target cannot go below the minimum of 5 the game itself requires', () => {
    const { room, sockets } = lobby('LOB3', 4, 5);
    sockets[0].trigger('update-settings', settings(4, 2));
    expect(room.playerCount).toBe(5);
    expect(sockets[0].last('action-error')).toMatch(/at least 5/i);
  });

  test('changing the setup un-readies everyone', () => {
    const { room, sockets } = lobby();
    room.players.forEach(p => { p.ready = true; });
    sockets[0].trigger('update-settings', settings(5, 2));
    expect(room.players.every(p => p.ready === false)).toBe(true);
  });

  test('only the host may change it', () => {
    const { room, sockets } = lobby();
    sockets[2].trigger('update-settings', settings(5, 2));
    expect(room.playerCount).toBe(6);
    expect(sockets[2].last('action-error')).toMatch(/host/i);
  });

  test('an impossible good/evil split is refused', () => {
    const { room, sockets } = lobby();
    sockets[0].trigger('update-settings', settings(6, 6));    // no good players left
    expect(room.roleConfig.evilCount).not.toBe(5);
    expect(sockets[0].last('action-error')).toMatch(/split/i);
  });

  test('more specials than slots is refused', () => {
    const { room, sockets } = lobby();
    // 6 players with 3 evil leaves 3 good, so Merlin plus two specials is the
    // ceiling — three overflows it.
    sockets[0].trigger('update-settings', {
      playerCount: 6,
      roleConfig: { evilCount: 3, goodSpecials: ['Percival', 'Cleric', 'Untrustworthy Servant'], evilSpecials: [] },
      campaignsConfig: Array.from({ length: 5 }, () => ({ teamSize: 2, failsNeeded: 1 })),
    });
    expect(sockets[0].last('action-error')).toMatch(/special/i);
  });

  test('settings reach everyone, not just the host', () => {
    const { sockets } = lobby();
    sockets.forEach(s => { s.emitLog.length = 0; });
    sockets[0].trigger('update-settings', settings(5, 2));
    expect(sockets[3].last('lobby-update').playerCount).toBe(5);
  });

  test('the setup is exposed in lobby state so the host can render it', () => {
    const { room } = lobby();
    const view = lobbyState(room);
    expect(view.roleConfig).toBeTruthy();
    expect(view.campaignsConfig).toBeTruthy();
    expect(typeof view.playerCount).toBe('number');
  });
});

// ── Kicking ───────────────────────────────────────────────────────────────

describe('removing a player from the lobby', () => {
  function lobby(code = 'KICK1') {
    const players = makePlayers(4);
    const room = buildRoom(code, players, { state: 'lobby', playerCount: 5 });
    const sockets = players.map(p => { const s = connectSocket(io, p.id); s.join(code); return s; });
    return { room, sockets };
  }

  test('the host can remove someone, and that person is told', () => {
    const { room, sockets } = lobby();
    sockets[0].trigger('kick-player', { playerId: 's3' });
    expect(room.players.map(p => p.id)).not.toContain('s3');
    expect(sockets[2].received('kicked')).toBe(true);
  });

  test('removing someone un-readies the rest', () => {
    const { room, sockets } = lobby();
    room.players.forEach(p => { p.ready = true; });
    sockets[0].trigger('kick-player', { playerId: 's3' });
    expect(room.players.every(p => p.ready === false)).toBe(true);
  });

  test('a non-host cannot remove anyone', () => {
    const { room, sockets } = lobby();
    sockets[1].trigger('kick-player', { playerId: 's3' });
    expect(room.players).toHaveLength(4);
    expect(sockets[1].last('action-error')).toMatch(/host/i);
  });

  test('the host cannot remove themselves', () => {
    const { room, sockets } = lobby();
    sockets[0].trigger('kick-player', { playerId: 's1' });
    expect(room.players.map(p => p.id)).toContain('s1');
  });

  test('nobody can be removed mid-game', () => {
    const players = makePlayers(5);
    const room = buildRoom('KICK2', players, { state: 'playing' });
    startGame(room);
    const host = connectSocket(io, 's1'); host.join('KICK2');
    host.trigger('kick-player', { playerId: 's3' });
    expect(room.players).toHaveLength(5);
  });
});

// ── Setup validation ──────────────────────────────────────────────────────

describe('the setup validator guards both the create and edit paths', () => {
  const { validateRoleConfig } = require('../server/roles');

  test('accepts every role the picker actually offers', () => {
    expect(validateRoleConfig(10, {
      evilCount: 3,
      goodSpecials: ['Percival', 'Cleric', 'Untrustworthy Servant'],
      evilSpecials: ['Morgana', 'Trickster'],
    })).toBeNull();
  });

  test('refuses a role that does not exist', () => {
    expect(validateRoleConfig(7, {
      evilCount: 3, goodSpecials: ['Archmage'], evilSpecials: [],
    })).toMatch(/Unknown good role/);
    expect(validateRoleConfig(7, {
      evilCount: 3, goodSpecials: [], evilSpecials: ['Warlock'],
    })).toMatch(/Unknown evil role/);
  });

  test('refuses a good role smuggled onto the evil side', () => {
    expect(validateRoleConfig(7, {
      evilCount: 3, goodSpecials: [], evilSpecials: ['Percival'],
    })).toMatch(/Unknown evil role/);
  });

  test('refuses duplicates', () => {
    expect(validateRoleConfig(9, {
      evilCount: 3, goodSpecials: ['Percival', 'Percival'], evilSpecials: [],
    })).toMatch(/Duplicate/);
  });

  test('refuses more specials than the split has slots', () => {
    expect(validateRoleConfig(5, {
      evilCount: 2, goodSpecials: ['Percival', 'Cleric', 'Untrustworthy Servant'], evilSpecials: [],
    })).toMatch(/Too many good/);
    expect(validateRoleConfig(5, {
      evilCount: 2, goodSpecials: [], evilSpecials: ['Morgana', 'Mordred'],
    })).toMatch(/Too many evil/);
  });

  test('refuses an impossible split or a sub-minimum table', () => {
    expect(validateRoleConfig(5, { evilCount: 5, goodSpecials: [], evilSpecials: [] })).toMatch(/split/);
    expect(validateRoleConfig(5, { evilCount: 0, goodSpecials: [], evilSpecials: [] })).toMatch(/split/);
    expect(validateRoleConfig(4, { evilCount: 2, goodSpecials: [], evilSpecials: [] })).toMatch(/at least 5/);
  });

  test('create-room refuses an invalid setup rather than storing it', () => {
    const socket = connectSocket(io, 'badsetup');
    socket.trigger('create-room', {
      playerCount: 5, campaignsConfig: [{ teamSize: 2, failsNeeded: 1 }],
      roleConfig: { evilCount: 2, goodSpecials: ['NotARole'], evilSpecials: [] },
      name: 'X', token: 't', orderMode: 'random',
    });
    expect(socket.received('room-created')).toBe(false);
    expect(socket.last('join-error')).toMatch(/Unknown good role/);
  });

  test('the host can add roles from the lobby, and they stick', () => {
    const players = makePlayers(7);
    const room = buildRoom('EDIT1', players, { state: 'lobby', playerCount: 7 });
    const host = connectSocket(io, 's1'); host.join('EDIT1');

    host.trigger('update-settings', {
      playerCount: 7,
      roleConfig: { evilCount: 3, goodSpecials: ['Percival', 'Cleric'], evilSpecials: ['Morgana', 'Trickster'] },
      campaignsConfig: Array.from({ length: 5 }, () => ({ teamSize: 3, failsNeeded: 1 })),
    });

    expect(room.roleConfig.goodSpecials).toEqual(['Percival', 'Cleric']);
    expect(room.roleConfig.evilSpecials).toEqual(['Morgana', 'Trickster']);
    expect(room.roleConfig.evilCount).toBe(3);
  });

  test('edited quest sizes are what the game actually deals', () => {
    const players = makePlayers(7);
    const room = buildRoom('EDIT2', players, { state: 'lobby', playerCount: 7 });
    const host = connectSocket(io, 's1'); host.join('EDIT2');
    const sizes = [2, 3, 4, 3, 4];

    host.trigger('update-settings', {
      playerCount: 7,
      roleConfig: { evilCount: 3, goodSpecials: [], evilSpecials: [] },
      campaignsConfig: sizes.map((t, i) => ({ teamSize: t, failsNeeded: i === 3 ? 2 : 1 })),
    });

    expect(room.campaignsConfig.map(c => c.teamSize)).toEqual(sizes);
    expect(room.campaignsConfig[3].failsNeeded).toBe(2);
  });

  test('roles edited in the lobby are dealt in the game that follows', () => {
    const { buildRoleList } = require('../server/roles');
    const players = makePlayers(7);
    const room = buildRoom('EDIT3', players, { state: 'lobby', playerCount: 7 });
    const host = connectSocket(io, 's1'); host.join('EDIT3');
    players.forEach(p => { const s = connectSocket(io, p.id); s.join('EDIT3'); });

    host.trigger('update-settings', {
      playerCount: 7,
      roleConfig: { evilCount: 3, goodSpecials: ['Cleric'], evilSpecials: ['Lunatic', 'Trickster'] },
      campaignsConfig: Array.from({ length: 5 }, () => ({ teamSize: 3, failsNeeded: 1 })),
    });
    const dealt = buildRoleList(room.playerCount, room.roleConfig);
    expect(dealt).toContain('Cleric');
    expect(dealt).toContain('Lunatic');
    expect(dealt).toContain('Trickster');
    expect(dealt).toHaveLength(7);
  });
});
