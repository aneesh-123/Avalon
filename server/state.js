function lobbyState(room) {
  return {
    code: room.code,
    playerCount: room.playerCount,
    hostId: room.hostId,
    players: room.players.map(p => ({ id: p.id, name: p.name, ready: p.ready })),
    state: room.state,
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
    specialRoles: room.players ? [...new Set(room.players.map(p => p.role).filter(r => r && r !== 'Loyal Servant' && r !== 'Minion of Mordred'))] : [],
    rolesInGame: room.players ? room.players.map(p => p.role).filter(Boolean) : [],
    revealedRoles: room.phase === 'game-over'
      ? room.players.map(p => ({ id: p.id, name: p.name, role: p.role }))
      : null,
  };
}

module.exports = { lobbyState, gameState };
