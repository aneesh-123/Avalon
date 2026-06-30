/**
 * Test helpers — mock sockets, io, and room/game setup utilities.
 *
 * Usage:
 *   const { makeIo, makeSocket, buildRoom, startGame, connectSocket } = require('./helpers');
 *   const registerHandlers = require('../server/socketHandlers');
 *
 *   const { io, mockDb } = makeIo();
 *   registerHandlers(io);
 *   const socket = connectSocket(io, 'socket-1');
 *   socket.trigger('create-room', { ... });
 */

const { rooms } = require('../server/rooms');
const { assignRoles } = require('../server/roles');
const { beginGame } = require('../server/gameEngine');

// ── Mock socket ──────────────────────────────────────────────────────────────

function makeSocket(id) {
  const handlers = {};
  const emitted  = {};           // event -> last payload
  const emitLog  = [];           // [{event, data}] in order

  const socket = {
    id,
    rooms: new Set([id]),
    on:      (event, fn) => { handlers[event] = fn; },
    emit:    (event, data) => { emitted[event] = data; emitLog.push({ event, data }); },
    join:    (room) => { socket.rooms.add(room); },
    // helpers for assertions
    emitted,
    emitLog,
    last:      (event) => emitted[event],
    received:  (event) => emitLog.some(e => e.event === event),  // true even if payload is undefined
    allOf:     (event) => emitLog.filter(e => e.event === event).map(e => e.data),
    trigger: (event, data) => { if (handlers[event]) handlers[event](data); },
    handlers,
  };
  return socket;
}

// ── Mock io ──────────────────────────────────────────────────────────────────

function makeIo() {
  let connectionHandler = null;
  const roomEmits  = {};   // roomCode -> [{event,data}]
  const connectedSockets = {};  // socketId -> socket

  // Fake db — records calls but never throws
  const mockDb = {
    calls: [],
    saveRoom:   (room) => { mockDb.calls.push({ fn: 'saveRoom',   arg: room.code }); return Promise.resolve(); },
    deleteRoom: (code) => { mockDb.calls.push({ fn: 'deleteRoom', arg: code });      return Promise.resolve(); },
  };

  // Patch the db module used by socketHandlers
  jest.mock('../server/db', () => mockDb, { virtual: false });

  const io = {
    on: (event, fn) => { if (event === 'connection') connectionHandler = fn; },
    to: (room) => ({
      emit: (event, data) => {
        // Store in roomEmits log
        roomEmits[room] = roomEmits[room] || [];
        roomEmits[room].push({ event, data });
        // Forward to any connected socket whose id matches OR who joined this room
        Object.values(connectedSockets).forEach(s => {
          if (s.id === room || s.rooms.has(room)) s.emit(event, data);
        });
      },
    }),
    _connectionHandler: () => connectionHandler,
    _roomEmits: roomEmits,
    _connectedSockets: connectedSockets,
  };

  return { io, mockDb, roomEmits };
}

// Connect a new socket through the registered connection handler
function connectSocket(io, id) {
  const socket = makeSocket(id);
  const handler = io._connectionHandler();
  if (!handler) throw new Error('registerHandlers() not called yet');
  handler(socket);
  io._connectedSockets[id] = socket;
  return socket;
}

// ── Room / game setup ────────────────────────────────────────────────────────

const DEFAULT_CAMPAIGNS = [
  { teamSize: 2, failsNeeded: 1 },
  { teamSize: 3, failsNeeded: 1 },
  { teamSize: 2, failsNeeded: 1 },
  { teamSize: 3, failsNeeded: 1 },
  { teamSize: 3, failsNeeded: 1 },
];

const DEFAULT_ROLE_CONFIG = {
  evilCount: 2,
  goodSpecials: [],
  evilSpecials: [],
  ladyOfLake: false,
};

/**
 * Build a room in the rooms map without going through sockets.
 * Players array: [{ id, name }]
 */
function buildRoom(code, playerDefs, overrides = {}) {
  const players = playerDefs.map(({ id, name }) => ({
    id, name, token: `token-${id}`, ready: false, role: null,
  }));
  const room = {
    code,
    hostId: players[0].id,
    playerCount: players.length,
    players,
    state: 'lobby',
    roleConfig: { ...DEFAULT_ROLE_CONFIG, evilCount: Math.floor(players.length / 3) || 1 },
    campaignsConfig: DEFAULT_CAMPAIGNS,
    disconnected: [],
    ...overrides,
  };
  rooms[code] = room;
  return room;
}

/**
 * Assign roles and start the game (mutates room in place).
 * Returns the room.
 */
function startGame(room) {
  assignRoles(room);
  beginGame(room);
  return room;
}

/**
 * Advance the room to the lady-of-lake phase by fast-forwarding through
 * two quest cycles (pass, pass) so currentCampaign becomes 2 and ladyHolder triggers.
 * Requires ladyOfLake: true in roleConfig.
 */
function advanceToLadyPhase(room) {
  const { resolveTeamVote, advanceFromTeamVoteResult, resolveQuestVote, advanceFromQuestResult } = require('../server/gameEngine');

  function fastPassQuest(room) {
    // Propose team (first teamSize players)
    const config = room.campaignsConfig[room.currentCampaign];
    room.proposedTeam = room.players.slice(0, config.teamSize).map(p => p.id);
    // Unanimous approve
    room.teamVotes = {};
    room.players.forEach(p => { room.teamVotes[p.id] = 'approve'; });
    resolveTeamVote(room);
    advanceFromTeamVoteResult(room);
    // Everyone on team passes
    room.proposedTeam.forEach(id => { room.questVotes[id] = 'pass'; });
    resolveQuestVote(room);
    advanceFromQuestResult(room);
  }

  fastPassQuest(room); // campaign 0
  fastPassQuest(room); // campaign 1  → triggers lady-of-lake after advance
  return room;
}

// Clean up rooms between tests
function clearRooms() {
  Object.keys(rooms).forEach(k => delete rooms[k]);
}

module.exports = { makeIo, makeSocket, connectSocket, buildRoom, startGame, advanceToLadyPhase, clearRooms, DEFAULT_ROLE_CONFIG };
