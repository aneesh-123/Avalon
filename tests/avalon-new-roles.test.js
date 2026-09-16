/**
 * The added special roles: Cleric, Untrustworthy Servant, Lunatic, Brute,
 * Trickster and Revealer.
 *
 * None of them change alignment mid-game — that is Lancelot's problem, and it
 * is deliberately not here. These all fit the existing model: they only change
 * what a player knows, what card they may play, or what the Lady sees.
 */

const registerHandlers = require('../server/socketHandlers');
const { rooms }        = require('../server/rooms');
const { gameState }    = require('../server/state');
const { buildKnown, canPlayQuestCard, ladyReading, isEvil, buildRoleList, delegateTarget } = require('../server/roles');
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

// Build a started room and force a known role layout.
function roomWith(roles) {
  const players = makePlayers(roles.length);
  const room = buildRoom('R1', players, { state: 'playing' });
  startGame(room);
  room.players.forEach((p, i) => { p.role = roles[i]; });
  room.assassinId = room.players.find(p => p.role === 'Assassin')?.id || null;
  return room;
}
const find = (room, role) => room.players.find(p => p.role === role);

// ── Cleric ────────────────────────────────────────────────────────────────

describe('Cleric', () => {
  test('learns the first leader is evil when they are', () => {
    const room = roomWith(['Cleric', 'Loyal Servant', 'Merlin', 'Assassin', 'Morgana']);
    room.currentLeaderIndex = 3;                       // the Assassin leads first
    const known = buildKnown(room, find(room, 'Cleric'));
    const entry = known.find(k => k.name === 'Player4');
    expect(entry.label).toMatch(/evil/);
    expect(entry.css).toBe('known-evil');
  });

  test('learns the first leader is good when they are', () => {
    const room = roomWith(['Cleric', 'Loyal Servant', 'Merlin', 'Assassin', 'Morgana']);
    room.currentLeaderIndex = 1;                       // a Loyal Servant leads
    const entry = buildKnown(room, find(room, 'Cleric')).find(k => k.name === 'Player2');
    expect(entry.label).toMatch(/good/);
    expect(entry.css).toBe('known-good');
  });

  test('learns nothing when they lead first themselves', () => {
    const room = roomWith(['Cleric', 'Loyal Servant', 'Merlin', 'Assassin', 'Morgana']);
    room.currentLeaderIndex = 0;
    expect(buildKnown(room, find(room, 'Cleric'))).toEqual([]);
  });

  test('is good, and nobody else learns what the Cleric learned', () => {
    const room = roomWith(['Cleric', 'Loyal Servant', 'Merlin', 'Assassin', 'Morgana']);
    room.currentLeaderIndex = 3;
    expect(isEvil('Cleric')).toBe(false);
    const servant = buildKnown(room, find(room, 'Loyal Servant'));
    expect(servant).toEqual([]);
  });
});

// ── Untrustworthy Servant ─────────────────────────────────────────────────

describe('Untrustworthy Servant', () => {
  test('is shown to the Assassin, alongside their evil allies', () => {
    const room = roomWith(['Untrustworthy Servant', 'Merlin', 'Loyal Servant', 'Assassin', 'Morgana']);
    const known = buildKnown(room, find(room, 'Assassin'));
    expect(known.find(k => k.name === 'Player1')?.label).toBe('untrustworthy servant');
    expect(known.find(k => k.name === 'Player5')?.label).toBe('evil ally');   // still sees Morgana
  });

  test('counts as good and is hidden from everyone but the Assassin', () => {
    const room = roomWith(['Untrustworthy Servant', 'Merlin', 'Loyal Servant', 'Assassin', 'Morgana']);
    expect(isEvil('Untrustworthy Servant')).toBe(false);
    const morgana = buildKnown(room, find(room, 'Morgana'));
    expect(morgana.some(k => k.label === 'untrustworthy servant')).toBe(false);
  });

  test('may only pass on a quest, like any good player', () => {
    const room = roomWith(['Untrustworthy Servant', 'Merlin', 'Loyal Servant', 'Assassin', 'Morgana']);
    const us = find(room, 'Untrustworthy Servant');
    expect(canPlayQuestCard(room, us, 'pass')).toBe(true);
    expect(canPlayQuestCard(room, us, 'fail')).toBe(false);
  });
});

// ── Handing over the final shot ───────────────────────────────────────────
//
// The half of the role that makes it a role rather than a handicap: once Good
// has taken the quests, the Assassin may give the kill to the Untrustworthy
// Servant instead of taking it themselves.

const WITH_SERVANT = ['Untrustworthy Servant', 'Merlin', 'Loyal Servant', 'Assassin', 'Morgana'];
const NO_SERVANT   = ['Percival', 'Merlin', 'Loyal Servant', 'Assassin', 'Morgana'];

function atAssassination(roles) {
  const room = roomWith(roles);
  room.phase = 'assassination';
  const sockets = room.players.map(p => { const s = connectSocket(io, p.id); s.join('R1'); return s; });
  return { room, sock: id => sockets.find(s => s.id === id) };
}

describe('delegating the assassination', () => {
  test('is offered only when a Servant is in play', () => {
    expect(gameState(atAssassination(WITH_SERVANT).room).canDelegate).toBe(true);
    expect(gameState(atAssassination(NO_SERVANT).room).canDelegate).toBe(false);
  });

  test('is withdrawn when the Servant is not here to take it', () => {
    const { room } = atAssassination(WITH_SERVANT);
    room.disconnected = [find(room, 'Untrustworthy Servant').name];
    // Delegating to an absent player would stall the game on its last action.
    expect(gameState(room).canDelegate).toBe(false);
    expect(delegateTarget(room)).toBeNull();
  });

  test('is not offered before the assassination phase', () => {
    const { room } = atAssassination(WITH_SERVANT);
    room.phase = 'team-select';
    expect(gameState(room).canDelegate).toBe(false);
  });

  test('moves the shot to the Servant, and says so publicly', () => {
    const { room, sock } = atAssassination(WITH_SERVANT);
    const servant = find(room, 'Untrustworthy Servant');
    sock(room.assassinId).trigger('delegate-assassination');

    const s = gameState(room);
    expect(s.killerId).toBe(servant.id);
    expect(s.assassinDelegated).toBe(true);
    expect(s.canDelegate).toBe(false);
    expect(s.waitingOn).toEqual([servant.name]);   // the board now blocks on them
  });

  test('only the Assassin may hand it over', () => {
    const { room, sock } = atAssassination(WITH_SERVANT);
    sock(find(room, 'Morgana').id).trigger('delegate-assassination');
    sock(find(room, 'Merlin').id).trigger('delegate-assassination');
    sock(find(room, 'Untrustworthy Servant').id).trigger('delegate-assassination');
    expect(gameState(room).assassinDelegated).toBe(false);
  });

  test('cannot be taken back, and the Assassin cannot then shoot', () => {
    const { room, sock } = atAssassination(WITH_SERVANT);
    const assassin = room.assassinId;
    sock(assassin).trigger('delegate-assassination');

    // Firing anyway is ignored — the shot is no longer theirs.
    sock(assassin).trigger('assassinate', { targetId: find(room, 'Merlin').id });
    expect(room.phase).toBe('assassination');
    expect(room.winner).toBeFalsy();
  });

  test('the Servant naming Merlin turns them, and Evil takes the game', () => {
    const { room, sock } = atAssassination(WITH_SERVANT);
    const servant = find(room, 'Untrustworthy Servant');
    sock(room.assassinId).trigger('delegate-assassination');
    sock(servant.id).trigger('assassinate', { targetId: find(room, 'Merlin').id });

    expect(room.winner).toBe('evil');
    expect(room.phase).toBe('game-over');
    expect(gameState(room).servantDefected).toBe(true);
    expect(room.winReason).toMatch(/Untrustworthy Servant/);
  });

  test('the Servant missing leaves Good the winner, and the Servant with them', () => {
    const { room, sock } = atAssassination(WITH_SERVANT);
    const servant = find(room, 'Untrustworthy Servant');
    sock(room.assassinId).trigger('delegate-assassination');
    sock(servant.id).trigger('assassinate', { targetId: find(room, 'Loyal Servant').id });

    expect(room.winner).toBe('good');
    expect(gameState(room).servantDefected).toBe(false);
    expect(isEvil('Untrustworthy Servant')).toBe(false);   // still good, still won
  });

  test('the Servant cannot shoot while the Assassin still holds the knife', () => {
    const { room, sock } = atAssassination(WITH_SERVANT);
    sock(find(room, 'Untrustworthy Servant').id)
      .trigger('assassinate', { targetId: find(room, 'Merlin').id });
    expect(room.winner).toBeFalsy();
    expect(room.phase).toBe('assassination');
  });

  // resetToLobby clears its fields one by one on purpose, so a field added to
  // the engine and forgotten here shows up as a visible bug rather than a
  // silent carry-over. These three are new, so pin them.
  test('a delegated shot does not survive into the next game', () => {
    const { room, sock } = atAssassination(WITH_SERVANT);
    const servant = find(room, 'Untrustworthy Servant');
    sock(room.assassinId).trigger('delegate-assassination');
    sock(servant.id).trigger('assassinate', { targetId: find(room, 'Merlin').id });
    expect(room.servantDefected).toBe(true);

    sock(room.hostId).trigger('play-again');

    expect(room.state).toBe('lobby');
    expect(room.killerId).toBeFalsy();
    expect(room.assassinDelegated).toBeFalsy();
    expect(room.servantDefected).toBeFalsy();
  });

  test('an Assassin who keeps the shot still plays exactly as before', () => {
    const { room, sock } = atAssassination(WITH_SERVANT);
    expect(gameState(room).killerId).toBe(room.assassinId);   // defaults to them
    sock(room.assassinId).trigger('assassinate', { targetId: find(room, 'Merlin').id });
    expect(room.winner).toBe('evil');
    expect(gameState(room).servantDefected).toBe(false);
    expect(room.winReason).toBe('The Assassin identified Merlin!');
  });
});

// ── Lunatic ───────────────────────────────────────────────────────────────

describe('Lunatic', () => {
  test('cannot pass — they are compelled to fail', () => {
    const room = roomWith(['Lunatic', 'Merlin', 'Loyal Servant', 'Assassin', 'Percival']);
    const lunatic = find(room, 'Lunatic');
    expect(canPlayQuestCard(room, lunatic, 'pass')).toBe(false);
    expect(canPlayQuestCard(room, lunatic, 'fail')).toBe(true);
  });

  test('is still evil and still sees their allies', () => {
    const room = roomWith(['Lunatic', 'Merlin', 'Loyal Servant', 'Assassin', 'Percival']);
    expect(isEvil('Lunatic')).toBe(true);
    expect(buildKnown(room, find(room, 'Lunatic')).some(k => k.label === 'evil ally')).toBe(true);
  });

  test('the server refuses a pass sent over the wire', () => {
    const players = makePlayers(5);
    const room = buildRoom('R2', players, { state: 'playing' });
    startGame(room);
    room.players.forEach((p, i) => { p.role = ['Lunatic', 'Merlin', 'Loyal Servant', 'Assassin', 'Percival'][i]; });
    room.phase = 'quest-vote';
    room.proposedTeam = ['s1', 's2'];
    room.questVotes = {};
    const socket = connectSocket(io, 's1');
    socket.join('R2');

    socket.trigger('quest-vote', { vote: 'pass' });
    expect(room.questVotes['s1']).toBeUndefined();
    socket.trigger('quest-vote', { vote: 'fail' });
    expect(room.questVotes['s1']).toBe('fail');
  });
});

// ── Brute ─────────────────────────────────────────────────────────────────

describe('Brute', () => {
  test('may fail the first three quests', () => {
    const room = roomWith(['Brute', 'Merlin', 'Loyal Servant', 'Assassin', 'Percival']);
    const brute = find(room, 'Brute');
    [0, 1, 2].forEach(c => {
      room.currentCampaign = c;
      expect(canPlayQuestCard(room, brute, 'fail')).toBe(true);
    });
  });

  test('is forced to pass on quests four and five', () => {
    const room = roomWith(['Brute', 'Merlin', 'Loyal Servant', 'Assassin', 'Percival']);
    const brute = find(room, 'Brute');
    [3, 4].forEach(c => {
      room.currentCampaign = c;
      expect(canPlayQuestCard(room, brute, 'fail')).toBe(false);
      expect(canPlayQuestCard(room, brute, 'pass')).toBe(true);
    });
  });
});

// ── Trickster ─────────────────────────────────────────────────────────────

describe('Trickster', () => {
  test('reads as good to the Lady of the Lake despite being evil', () => {
    const room = roomWith(['Trickster', 'Merlin', 'Loyal Servant', 'Assassin', 'Percival']);
    const trickster = find(room, 'Trickster');
    expect(isEvil(trickster.role)).toBe(true);
    expect(ladyReading(trickster)).toBe('good');
  });

  test('every other evil role still reads as evil', () => {
    const room = roomWith(['Trickster', 'Merlin', 'Loyal Servant', 'Assassin', 'Morgana']);
    expect(ladyReading(find(room, 'Assassin'))).toBe('evil');
    expect(ladyReading(find(room, 'Morgana'))).toBe('evil');
    expect(ladyReading(find(room, 'Merlin'))).toBe('good');
  });
});

// ── Revealer ──────────────────────────────────────────────────────────────

describe('Revealer', () => {
  test('stays hidden until three quests have resolved', () => {
    const room = roomWith(['Revealer', 'Merlin', 'Loyal Servant', 'Assassin', 'Percival']);
    room.campaignResults = ['pass', 'fail'];
    expect(gameState(room).revealedEvil).toEqual([]);
  });

  test('is named to the whole table once three quests are done', () => {
    const room = roomWith(['Revealer', 'Merlin', 'Loyal Servant', 'Assassin', 'Percival']);
    room.campaignResults = ['pass', 'fail', 'pass'];
    expect(gameState(room).revealedEvil).toEqual([{ id: 's1', name: 'Player1' }]);
  });

  test('no Revealer in play means nothing is ever revealed', () => {
    const room = roomWith(['Oberon', 'Merlin', 'Loyal Servant', 'Assassin', 'Percival']);
    room.campaignResults = ['pass', 'fail', 'pass'];
    expect(gameState(room).revealedEvil).toEqual([]);
  });
});

// ── Dealing ───────────────────────────────────────────────────────────────

describe('the new roles deal correctly', () => {
  test('buildRoleList places them on the right sides', () => {
    const list = buildRoleList(7, {
      evilCount: 3,
      goodSpecials: ['Percival', 'Cleric'],
      evilSpecials: ['Morgana', 'Trickster'],
    });
    expect(list).toHaveLength(7);
    expect(list).toContain('Cleric');
    expect(list).toContain('Trickster');
    expect(list.filter(r => isEvil(r))).toHaveLength(3);
    expect(list.filter(r => !isEvil(r))).toHaveLength(4);
  });

  test('an all-specials evil side still deals the right count', () => {
    const list = buildRoleList(10, {
      evilCount: 4,
      goodSpecials: ['Percival'],
      evilSpecials: ['Morgana', 'Lunatic', 'Brute'],
    });
    expect(list).toHaveLength(10);
    expect(list.filter(r => isEvil(r))).toHaveLength(4);
    expect(list.filter(r => r === 'Minion of Mordred')).toHaveLength(0);
  });
});
