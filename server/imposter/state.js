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
  return {
    phase: room.phase,
    players: room.players.map(p => ({ id: p.id, name: p.name })),
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
    voteHistory: over ? room.voteHistory : null,
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
