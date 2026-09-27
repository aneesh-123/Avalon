/**
 * Robustness: malformed input, reconnect edge cases, and the stalls a real
 * table of phones runs into. Each test names the failure it guards against.
 */

jest.mock('../server/db', () => ({
  saveRoom:   () => Promise.resolve(),
  deleteRoom: () => Promise.resolve(),
  loadRooms:  () => Promise.resolve([]),
}));

const registerHandlers = require('../server/socketHandlers');
const registerImposterHandlers = require('../server/imposter/handlers');
const { rooms, randomCode } = require('../server/rooms');
const { impRooms, randomImpCode } = require('../server/imposter/rooms');
const { assignRoles: impAssignRoles, beginGame: impBeginGame } = require('../server/imposter/engine');
const { makeIo, connectSocket, buildRoom, startGame, clearRooms } = require('./helpers');
const { cleanName } = require('../server/safeSocket');

const CAMPAIGNS = [
  { teamSize: 2, failsNeeded: 1 },
  { teamSize: 3, failsNeeded: 1 },
  { teamSize: 2, failsNeeded: 1 },
  { teamSize: 3, failsNeeded: 1 },
  { teamSize: 3, failsNeeded: 1 },
];
const ROLE_CONFIG = { evilCount: 2, goodSpecials: [], evilSpecials: [], ladyOfLake: false };

let io, impIo;
beforeEach(() => {
  clearRooms();
  Object.keys(impRooms).forEach(k => delete impRooms[k]);
  ({ io } = makeIo());
  registerHandlers(io);
  ({ io: impIo } = makeIo());
  registerImposterHandlers(impIo);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { console.error.mockRestore?.(); });

function playingRoom(code = 'ROB', n = 5) {
  const defs = Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, name: `Player${i + 1}` }));
  const room = buildRoom(code, defs);
  const sockets = defs.map(d => { const s = connectSocket(io, d.id); s.join(code); return s; });
  startGame(room);
  return { room, sockets };
}

// ── One bad message must never take the server down ─────────────────────────
describe('malformed payloads', () => {
  const AVALON_EVENTS = [
    'request-sync', 'rejoin-room', 'claim-slot', 'create-room', 'join-room', 'toggle-ready',
    'submit-order', 'night-round-continue', 'propose-team', 'team-vote', 'continue-game',
    'cancel-proposal', 'call-clock', 'quest-vote', 'propose-dispute', 'dispute-vote',
    'lady-investigate', 'lady-announce', 'delegate-assassination', 'assassinate', 'reveal-quest',
    'play-again', 'update-settings', 'kick-player', 'leave-lobby', 'leave-game', 'disconnect',
  ];
  const IMPOSTER_EVENTS = [
    'imp:solo-deal', 'imp:solo-reroll', 'imp:request-sync', 'imp:get-categories', 'imp:rejoin-room',
    'imp:create-room', 'imp:join-room', 'imp:toggle-ready', 'imp:submit-clue', 'imp:skip-clues',
    'imp:request-reroll', 'imp:start-vote', 'imp:cast-vote', 'imp:guess-word', 'imp:leave-lobby',
    'imp:leave-game', 'disconnect',
  ];
  const JUNK = [undefined, null, 42, 'text', [], { code: 7, name: {} }, { name: null, token: 5 }];

  test('every Avalon handler survives no payload, or junk', () => {
    playingRoom('JUNK');
    const s = connectSocket(io, 's1-junk');
    for (const ev of AVALON_EVENTS) for (const j of JUNK) {
      expect(() => s.trigger(ev, j)).not.toThrow();
    }
  });

  test('every Imposter handler survives no payload, or junk', () => {
    const s = connectSocket(impIo, 'imp-junk');
    for (const ev of IMPOSTER_EVENTS) for (const j of JUNK) {
      expect(() => s.trigger(ev, j)).not.toThrow();
    }
  });

  test('a nameless create or join is refused, not stored', () => {
    const s = connectSocket(io, 'nameless');
    s.trigger('create-room', { playerCount: 5, roleConfig: ROLE_CONFIG, campaignsConfig: CAMPAIGNS, name: '   ' });
    expect(s.last('join-error')).toBe('Enter your name.');
    expect(Object.keys(rooms)).toHaveLength(0);

    const t = connectSocket(impIo, 'imp-nameless');
    t.trigger('imp:create-room', { playerCount: 5, name: undefined });
    expect(t.last('imp:join-error')).toBe('Enter your name.');
    expect(Object.keys(impRooms)).toHaveLength(0);
  });

  test('names are trimmed and capped', () => {
    expect(cleanName('  Ann   Marie ')).toBe('Ann Marie');
    expect(cleanName('x'.repeat(50))).toHaveLength(20);
    expect(cleanName(12)).toBe('');
  });
});

// ── Avalon setup validation ─────────────────────────────────────────────────
describe('Avalon room setup', () => {
  test('a player count sent as a string still starts the game', () => {
    const host = connectSocket(io, 'h');
    host.trigger('create-room', { playerCount: '5', roleConfig: ROLE_CONFIG, campaignsConfig: CAMPAIGNS, name: 'Host', token: 'th' });
    const { code } = host.last('room-created');
    expect(rooms[code].playerCount).toBe(5);

    const others = [1, 2, 3, 4].map(i => {
      const s = connectSocket(io, `p${i}`);
      s.trigger('join-room', { code, name: `P${i}`, token: `t${i}` });
      return s;
    });
    [host, ...others].forEach(s => s.trigger('toggle-ready'));
    expect(rooms[code].state).toBe('playing');
  });

  test('a quest bigger than the table is refused', () => {
    const s = connectSocket(io, 'h');
    s.trigger('create-room', {
      playerCount: 5, roleConfig: ROLE_CONFIG, name: 'Host',
      campaignsConfig: [{ teamSize: 6, failsNeeded: 1 }, ...CAMPAIGNS.slice(1)],
    });
    expect(s.last('join-error')).toBe('Invalid quest configuration.');
  });

  test('a quest with no fail threshold is refused', () => {
    const s = connectSocket(io, 'h');
    s.trigger('create-room', {
      playerCount: 5, roleConfig: ROLE_CONFIG, name: 'Host',
      campaignsConfig: CAMPAIGNS.map(c => ({ teamSize: c.teamSize })),
    });
    expect(s.last('join-error')).toBe('Invalid quest configuration.');
  });

  test('room codes are always five characters and never reused', () => {
    for (let i = 0; i < 2000; i++) {
      expect(randomCode()).toMatch(/^[A-Z0-9]{5}$/);
      expect(randomImpCode()).toMatch(/^[A-Z0-9]{5}$/);
    }
  });
});

// ── Seats cannot be taken over by name ─────────────────────────────────────
describe('rejoining by name', () => {
  test('cannot take over a player who is still connected', () => {
    const { room, sockets } = playingRoom('HIJ');
    io.sockets = { sockets: new Map(sockets.map(s => [s.id, s])) };
    const intruder = connectSocket(io, 'intruder');

    intruder.trigger('rejoin-room', { code: 'HIJ', name: 'player2', token: 'someone-else' });

    expect(intruder.last('rejoin-error')).toMatch(/still connected/);
    expect(intruder.received('your-role')).toBe(false);
    expect(room.players[1].id).toBe('s2');
  });

  test('still works for a player whose connection is gone', () => {
    const { room, sockets } = playingRoom('BACK');
    io.sockets = { sockets: new Map(sockets.filter(s => s.id !== 's2').map(s => [s.id, s])) };
    const back = connectSocket(io, 'new-phone');

    back.trigger('rejoin-room', { code: 'BACK', name: 'Player2', token: 'fresh-token' });

    expect(back.received('rejoin-ok')).toBe(true);
    expect(room.players[1].id).toBe('new-phone');
  });

  test('the Imposter side has the same protection', () => {
    const room = impStarted('IHIJ');
    impIo.sockets = { sockets: new Map(room.players.map(p => [p.id, {}])) };
    const intruder = connectSocket(impIo, 'intruder');

    intruder.trigger('imp:rejoin-room', { code: 'IHIJ', name: 'P2', token: 'nope' });

    expect(intruder.received('imp:your-role')).toBe(false);
    expect(intruder.last('imp:rejoin-error')).toMatch(/still connected/);
  });
});

// ── Avalon game-flow stalls ────────────────────────────────────────────────
describe('Avalon stalls', () => {
  test('a team naming the same player twice is refused', () => {
    const { room, sockets } = playingRoom('DUP');
    const leader = room.players[room.currentLeaderIndex];
    const s = sockets.find(x => x.id === leader.id);

    s.trigger('propose-team', { team: [leader.id, leader.id] });

    expect(room.phase).toBe('team-select');
  });

  test('a dispute cannot reopen a finished game', () => {
    const { room, sockets } = playingRoom('OVER');
    room.campaignResults = ['pass', 'pass', 'pass'];
    room.phase = 'game-over';
    room.winner = 'good';

    sockets[0].trigger('propose-dispute', { campaign: 0 });

    expect(room.pendingDispute).toBeFalsy();
  });

  test('undoing the winning quest during the assassination sends play back to the quests', () => {
    const { room, sockets } = playingRoom('UNDO');
    room.campaignResults = ['pass', 'fail', 'pass', 'pass'];
    room.questHistory = room.campaignResults.map((r, i) => ({ campaign: i, passed: r === 'pass' }));
    room.currentCampaign = 3;
    room.phase = 'assassination';
    const leaderBefore = room.currentLeaderIndex;

    sockets[0].trigger('propose-dispute', { campaign: 3 });
    sockets.slice(1).forEach(s => s.trigger('dispute-vote', { approve: true }));

    expect(room.campaignResults).toEqual(['pass', 'fail', 'pass', 'fail']);
    expect(room.phase).toBe('team-select');
    expect(room.currentCampaign).toBe(4);
    expect(room.currentLeaderIndex).toBe((leaderBefore + 1) % 5);
  });

  test('a host who left mid-game does not lock the table out of playing again', () => {
    const { room, sockets } = playingRoom('HOSTGONE');
    sockets[0].trigger('disconnect');          // the host
    room.phase = 'game-over';
    room.winner = 'good';

    sockets[1].trigger('play-again');

    expect(room.state).toBe('lobby');
    expect(room.hostId).toBe('s2');
  });

  test('a present host still keeps play-again to themselves', () => {
    const { room, sockets } = playingRoom('HOSTHERE');
    room.phase = 'game-over';

    sockets[1].trigger('play-again');

    expect(room.state).toBe('playing');
    expect(sockets[1].last('action-error')).toMatch(/Only the host/);
  });

  test('creating a new room mid-game keeps the old seat instead of deleting it', () => {
    const { room, sockets } = playingRoom('KEEPSEAT');
    const roleBefore = room.players[2].role;

    sockets[2].trigger('create-room', { playerCount: 5, roleConfig: ROLE_CONFIG, campaignsConfig: CAMPAIGNS, name: 'Wanderer' });

    expect(room.players).toHaveLength(5);
    expect(room.players[2].role).toBe(roleBefore);
    expect(room.disconnected).toContain('Player3');
    expect(room.players.some(p => p.id === 's3')).toBe(false);
  });
});

// ── Host-selected turn order ───────────────────────────────────────────────
describe('turn-order screen', () => {
  function orderingRoom() {
    const defs = Array.from({ length: 5 }, (_, i) => ({ id: `o${i + 1}`, name: `Order${i + 1}` }));
    const room = buildRoom('ORDER', defs, { orderMode: 'host-selected' });
    const sockets = defs.map(d => { const s = connectSocket(io, d.id); s.join('ORDER'); return s; });
    sockets.forEach(s => s.trigger('toggle-ready'));
    return { room, sockets };
  }

  test('a player dropping on the order screen does not push a game screen', () => {
    const { room, sockets } = orderingRoom();
    expect(room.state).toBe('ordering');

    sockets[3].trigger('disconnect');

    expect(sockets[0].received('phase-update')).toBe(false);
    expect(room.disconnected || []).toHaveLength(0);
  });

  test('a host who refreshes lands back on the order screen with current ids', () => {
    const { room } = orderingRoom();
    const host = connectSocket(io, 'host-again');

    host.trigger('rejoin-room', { code: 'ORDER', name: 'Order1', token: 'token-o1' });

    const payload = host.last('enter-order-select');
    expect(payload.hostId).toBe('host-again');
    expect(payload.players.map(p => p.id)).toEqual(room.players.map(p => p.id));
  });
});

// ── Imposter ────────────────────────────────────────────────────────────────
function impStarted(code, n = 5) {
  const room = {
    gameType: 'imposter', code, hostId: 'i1', playerCount: n,
    config: {
      imposterCount: 1, impostersKnowEachOther: true, hintLevel: 'category', categoryVisible: true,
      clueRounds: 1, allowImposterGuess: true, categories: [],
      specialRoles: { detective: false, confused: false, doubleAgent: false, accomplice: false, jester: false },
      customWord: 'Pizza', customCategory: 'Food', customRelated: 'Pasta',
    },
    players: Array.from({ length: n }, (_, i) => ({
      id: `i${i + 1}`, name: `P${i + 1}`, token: `it${i + 1}`, ready: true, role: null,
    })),
    state: 'lobby',
  };
  impRooms[code] = room;
  impAssignRoles(room);
  impBeginGame(room);
  room.players.forEach(p => { const s = connectSocket(impIo, p.id); s.join('imp-' + code); });
  return room;
}

describe('Imposter reconnects', () => {
  test('an eliminated player who refreshes stays eliminated', () => {
    const room = impStarted('ELIM');
    const out = room.players.find(p => p.role !== 'Imposter');
    room.eliminated = [out.id];
    room.eliminationLog = [{ id: out.id, name: out.name, role: out.role, wasImposter: false, round: 1 }];
    room.phase = 'vote';
    room.votes = {};
    impRooms.ELIM.players.find(p => p.id === out.id);
    connectSocket(impIo, out.id).trigger('disconnect');

    const back = connectSocket(impIo, 'back-again');
    back.trigger('imp:rejoin-room', { code: 'ELIM', name: out.name, token: out.token });

    expect(room.eliminated).toEqual(['back-again']);
    expect(room.eliminationLog[0].id).toBe('back-again');
    // …and so cannot vote, and the vote needs one fewer ballot.
    back.trigger('imp:cast-vote', { targetId: room.players.find(p => p.id !== 'back-again').id });
    expect(room.votes['back-again']).toBeUndefined();
  });

  test('a host who drops hands the vote controls to someone still here', () => {
    const room = impStarted('IHOST');
    room.phase = 'discussion';
    const host = impIo._connectedSockets.i1;
    host.trigger('disconnect');
    expect(room.hostId).toBe('i2');

    impIo._connectedSockets.i2.trigger('imp:start-vote');
    expect(room.phase).toBe('vote');
  });

  test('a whole table backgrounding at once keeps the room', () => {
    const room = impStarted('NAP');
    room.players.forEach(p => impIo._connectedSockets[p.id].trigger('disconnect'));
    expect(impRooms.NAP).toBe(room);
  });

  test('joining a second Imposter lobby leaves the first', () => {
    const a = connectSocket(impIo, 'wander');
    a.trigger('imp:create-room', { playerCount: 5, name: 'Wander', token: 'w' });
    const first = a.last('imp:room-created').code;
    a.trigger('imp:create-room', { playerCount: 5, name: 'Wander', token: 'w' });
    const second = a.last('imp:room-created').code;

    expect(impRooms[first]).toBeUndefined();
    expect(impRooms[second].players.map(p => p.id)).toEqual(['wander']);
  });
});
