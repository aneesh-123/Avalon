// Sanitized views of a Clocktower room.
//
// The game state here is per-viewer rather than broadcast: a player's character
// and private information are never in anyone else's payload. Note that `you`
// reports the *believed* character — the Drunk is never told the truth, on any
// screen, at any point before the game ends.

const { CHARACTERS, isDemon } = require('./characters');
const { canVote, abilityWorking, trueBoard } = require('./engine');

function botcLobbyState(room) {
  return {
    code: room.code,
    playerCount: room.playerCount,
    hostId: room.hostId,
    players: room.players.map(p => ({ id: p.id, name: p.name, ready: p.ready })),
    state: room.state,
    storytellerView: !!room.storytellerView,
  };
}

function botcGameState(room, viewerId) {
  const over   = room.phase === 'game-over';
  const viewer = room.players.find(p => p.id === viewerId);
  const cur    = room.nominations?.current || null;
  const believed = viewer?.believedCharacter;

  return {
    phase: room.phase,
    nightNumber: room.nightNumber,
    hostId: room.hostId,
    storytellerView: !!room.storytellerView,

    players: [...room.players]
      .sort((a, b) => a.seat - b.seat)
      .map(p => ({
        id: p.id, name: p.name, seat: p.seat,
        alive: p.alive,
        ghostVoteUsed: p.ghostVoteUsed,
        character: over ? p.character : null,
        alignment: over ? p.alignment : null,
      })),

    you: viewer ? {
      id: viewer.id,
      character: believed,
      blurb: CHARACTERS[believed]?.blurb || '',
      // Alignment follows the believed character, so the Drunk still reads good.
      alignment: CHARACTERS[believed]?.alignment || viewer.alignment,
      alive: viewer.alive,
      canVote: canVote(room, viewer),
      ghostVoteUsed: viewer.ghostVoteUsed,
      info: room.info?.[viewer.id] || [],
      // The Slayer's button; nobody else sees it.
      canSlay: believed === 'Slayer' && viewer.alive && !viewer.usedDayAction && room.phase === 'day',
    } : null,

    prompt: room.night?.awaiting?.playerId === viewerId
      ? {
          type: room.night.awaiting.type,
          character: room.night.awaiting.character,
          picks: room.night.awaiting.picks || 1,
        }
      : null,
    nightWaitingOn: room.phase === 'night' && room.night?.awaiting ? true : false,

    deathsLastNight: room.phase !== 'night' && room.night
      ? room.night.deaths.map(id => room.players.find(p => p.id === id)?.name).filter(Boolean)
      : [],
    dayEvents: room.dayEvents || [],

    nominations: room.nominations
      ? { nominators: room.nominations.nominators, nominated: room.nominations.nominated }
      : { nominators: [], nominated: [] },

    currentNomination: cur ? {
      nominatorName: room.players.find(p => p.id === cur.nominatorId)?.name || '',
      nomineeId: cur.nomineeId,
      nomineeName: room.players.find(p => p.id === cur.nomineeId)?.name || '',
      voted: Object.keys(cur.votes),
      youVoted: cur.votes[viewerId] !== undefined ? cur.votes[viewerId] : null,
      threshold: Math.ceil(room.players.filter(p => p.alive).length / 2),
    } : null,

    lastNominationResult: room.lastNominationResult || null,
    onTheBlock: room.onTheBlock || null,
    executedToday: room.executedToday || null,

    winner: over ? room.winner : null,
    winReason: over ? room.winReason : null,
    bluffs: over && viewer && isDemon(viewer.character) ? room.bluffs : null,
  };
}

// The Storyteller's grimoire — the whole truth, including who is secretly the
// Drunk and what each impaired player's fake board says. Only ever sent to the
// host of a room created with the Storyteller view enabled, or to anyone once
// the game is over. It exists so an automated Storyteller can be audited:
// without it, a false Empath reading is indistinguishable from a true one.
function botcGrimoire(room) {
  const board = trueBoard(room);
  return {
    code: room.code,
    phase: room.phase,
    nightNumber: room.nightNumber,
    redHerring: room.players.find(p => p.id === room.redHerring)?.name || null,
    bluffs: room.bluffs || [],
    registration: room.registration || null,
    players: [...room.players].sort((a, b) => a.seat - b.seat).map(p => ({
      seat: p.seat,
      name: p.name,
      character: p.character,
      believedCharacter: p.believedCharacter,
      isDrunk: p.character === 'Drunk',
      alignment: p.alignment,
      alive: p.alive,
      poisoned: !!p.statuses?.poisoned,
      protected: !!p.statuses?.protected,
      abilityWorking: abilityWorking(room, p),
      ghostVoteUsed: p.ghostVoteUsed,
      // Present only for players who have been fed false information.
      fakeBoard: room.fakeBoards?.[p.id]
        ? Object.entries(room.fakeBoards[p.id]).map(([id, c]) =>
            `${room.players.find(q => q.id === id)?.name}: ${c}`)
        : null,
      info: (room.info?.[p.id] || []).map(i => `N${i.night}: ${i.text}`),
    })),
    trueBoard: Object.entries(board).map(([id, c]) =>
      `${room.players.find(p => p.id === id)?.name}: ${c}`),
  };
}

module.exports = { botcLobbyState, botcGameState, botcGrimoire };
