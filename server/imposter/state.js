// Sanitized views of an Imposter room. Anything role-revealing goes through
// targeted 'imp:your-role' emits instead — these views are safe to broadcast.
const { isImposterTeam } = require('./engine');

function impLobbyState(room) {
  return {
    code: room.code,
    playerCount: room.playerCount,
    hostId: room.hostId,
    players: room.players.map(p => ({ id: p.id, name: p.name, ready: p.ready })),
    state: room.state,
    config: {
      imposterCount: room.config.imposterCount,
      specialRoles: room.config.specialRoles,
      categoryVisible: room.config.categoryVisible !== false,
    },
  };
}

function impGameState(room) {
  const showCategory = room.config.categoryVisible !== false;
  const over = room.phase === 'game-over';
  const eliminated = room.eliminated || [];
  const active = room.players.filter(p => !eliminated.includes(p.id));
  return {
    phase: room.phase,
    // `eliminated` is public — every ejection is announced along with whether
    // that player was an imposter, so it leaks nothing that is not already out.
    players: room.players.map(p => ({ id: p.id, name: p.name, eliminated: eliminated.includes(p.id) })),
    activeCount: active.length,
    round: room.round || 1,
    // Roles of the ejected only. Survivors' roles stay hidden until game over.
    eliminationLog: (room.eliminationLog || []).map(e => ({
      id: e.id, name: e.name, wasImposter: e.wasImposter, round: e.round,
      guess: e.guess, guessCorrect: e.guessCorrect,
    })),
    // The whole imposter team, not just the Imposter role — a Double Agent or
    // Accomplice counts towards the win condition and towards impostersFound
    // below, so counting them here too is what keeps the two consistent.
    // Using config.imposterCount let a caught Double Agent decrement a total it
    // was never part of, and the header could read "0 of 2 left" with an
    // Imposter still alive.
    impostersTotal: room.config.imposterCount
      + (room.config.specialRoles?.doubleAgent ? 1 : 0)
      + (room.config.specialRoles?.accomplice ? 1 : 0),
    impostersFound: (room.eliminationLog || []).filter(e => e.wasImposter).length,
    hostId: room.hostId,
    category: showCategory ? room.secret.category : null,
    imposterCount: room.config.imposterCount,
    clueOrder: room.clueOrder,
    clueIndex: room.clueIndex,
    clueRound: room.clueRound,
    clueRounds: room.config.clueRounds || 1,
    currentCluerId: room.phase === 'clue' ? room.clueOrder[room.clueIndex] : null,
    currentCluerName: room.phase === 'clue'
      ? room.players.find(p => p.id === room.clueOrder[room.clueIndex])?.name || null
      : null,
    clues: room.clues.map(c => ({ playerId: c.playerId, name: c.name, text: c.text, round: c.round })),
    // Votes stay masked while voting is open — only who has voted is public
    votes: room.phase === 'vote'
      ? Object.fromEntries(Object.keys(room.votes).map(id => [id, 'voted']))
      : room.votes,
    voteRound: room.voteRound,
    voteCandidates: room.voteCandidates,
    majorityNeeded: active.length ? Math.floor(active.length / 2) + 1 : 0,
    // Completed rounds only — the round in progress lives in `votes` above and
    // stays masked. Sending finished rounds lets a table that failed to reach a
    // majority see where the votes actually went before voting again.
    voteHistory: room.voteHistory || [],
    accusedId: room.accusedId || null,
    accusedName: room.accusedId ? (room.players.find(p => p.id === room.accusedId)?.name || null) : null,
    winner: room.winner || null,
    winReason: room.winReason || null,
    // Revealed only at game over
    secretWord: over ? room.secret.word : null,
    secretCategory: over ? room.secret.category : null,
    imposterGuess: over ? (room.imposterGuess || null) : null,
    revealedRoles: over
      ? room.players.map(p => ({
          id: p.id, name: p.name, role: p.role,
          team: p.role === 'Jester' ? 'jester' : (isImposterTeam(p.role) ? 'imposter' : 'regular'),
        }))
      : null,
  };
}

module.exports = { impLobbyState, impGameState };
