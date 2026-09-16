const { buildNightRoundScript } = require('./roles');

// Who the game is actually blocked on, by phase. A disconnected player only
// matters when the game genuinely cannot advance without them — the rest of the
// time their absence should be invisible, so this is the single place that
// decides when to say anything about it.
function computeWaitingOn(room) {
  const nameOf = id => room.players.find(p => p.id === id)?.name;
  switch (room.phase) {
    case 'team-select':
      return [room.players[room.currentLeaderIndex]?.name].filter(Boolean);
    case 'team-vote':
      return room.players
        .filter(p => (room.teamVotes || {})[p.id] === undefined)
        .map(p => p.name);
    case 'quest-vote':
      return (room.proposedTeam || [])
        .filter(id => (room.questVotes || {})[id] === undefined)
        .map(nameOf).filter(Boolean);
    case 'quest-vote-ready':
      return [room.players[room.currentLeaderIndex]?.name].filter(Boolean);
    case 'assassination':
      return [nameOf(room.assassinId)].filter(Boolean);
    case 'lady-of-lake':
      return [nameOf(room.ladyHolder)].filter(Boolean);
    default:
      return [];   // result screens advance on anyone's tap
  }
}

function lobbyState(room) {
  return {
    code: room.code,
    playerCount: room.playerCount,
    hostId: room.hostId,
    players: room.players.map(p => ({ id: p.id, name: p.name, ready: p.ready })),
    state: room.state,
    // The current setup, so the host can adjust it from the lobby when someone
    // drops out instead of tearing the room down and resharing the link.
    roleConfig: room.roleConfig || null,
    campaignsConfig: room.campaignsConfig || null,
    shotClock: !!room.shotClockEnabled,
  };
}

function gameState(room) {
  const n = room.players.length;
  return {
    phase: room.phase,
    players: room.players.map(p => ({ id: p.id, name: p.name })),
    leaderId: room.players[room.currentLeaderIndex]?.id,
    leaderName: room.players[room.currentLeaderIndex]?.name,
    leaderQueue: Array.from({length: n}, (_, i) => room.players[(room.currentLeaderIndex + i) % n].name),
    currentCampaign: room.currentCampaign,
    campaignsConfig: room.campaignsConfig,
    campaignResults: room.campaignResults,
    proposedTeam: room.proposedTeam,
    // While voting is still in progress, hide the actual approve/reject choice —
    // only reveal who has voted. Real values are sent once phase advances past
    // 'team-vote' (i.e. resolveTeamVote already ran and lastTeamVoteResult exists).
    teamVotes: room.phase === 'team-vote'
      ? Object.fromEntries(Object.keys(room.teamVotes || {}).map(id => [id, 'voted']))
      : room.teamVotes,
    questVoteCount: Object.keys(room.questVotes || {}).length,
    consecutiveRejections: room.consecutiveRejections,
    lastTeamVoteResult: room.lastTeamVoteResult || null,
    lastQuestResult: room.lastQuestResult || null,
    questHistory: (room.questHistory || []).map(h => ({
      ...h,
      questVoteBreakdown: room.phase === 'game-over' ? h.questVoteBreakdown : undefined,
    })),
    pendingDispute: room.pendingDispute || null,
    ladyHolder: room.ladyHolder || null,
    ladyHolderName: room.players.find(p => p.id === room.ladyHolder)?.name || null,
    ladyHistory: room.ladyHistory || [],
    ladyUsed: room.ladyUsed ? [...room.ladyUsed] : [],
    winner: room.winner || null,
    winReason: room.winReason || null,
    assassinId: room.assassinId || null,
    nightRoundScript: room.phase === 'night-round' ? buildNightRoundScript(room.roleConfig) : null,
    specialRoles: room.players ? [...new Set(room.players.map(p => p.role).filter(r => r && r !== 'Loyal Servant' && r !== 'Minion of Mordred'))] : [],
    rolesInGame: room.players ? room.players.map(p => p.role).filter(Boolean) : [],
    revealedRoles: room.phase === 'game-over'
      ? room.players.map(p => ({ id: p.id, name: p.name, role: p.role }))
      : null,

    // The Revealer outs itself to the whole table once three quests have been
    // resolved. Public by design, so it belongs in the broadcast state.
    revealedEvil: (room.campaignResults || []).length >= 3
      ? room.players.filter(p => p.role === 'Revealer').map(p => ({ id: p.id, name: p.name }))
      : [],

    // Presence rides along with game state rather than a separate event stream,
    // so every render already knows who is away and the two can't desync.
    disconnected: [...(room.disconnected || [])],
    waitingOn: computeWaitingOn(room),

    shotClock: {
      enabled: !!room.shotClockEnabled,
      seconds: room.shotClockSeconds || 60,
      votes: Object.keys(room.clockVotes || {}),
      threshold: Math.ceil(room.players.length / 2),
      deadline: room.clockDeadline || null,
      // Votes the clock filled in on someone's behalf, so the tally can say so.
      filled: [...(room.clockFilled || [])],
    },
  };
}

module.exports = { lobbyState, gameState };
