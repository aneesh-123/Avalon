// Pure game logic — NO socket/io references. Mutates room only.

function beginGame(room) {
  room.state = 'playing';
  room.currentLeaderIndex = Math.floor(Math.random() * room.players.length);
  room.currentCampaign = 0;
  room.campaignResults = [];
  room.questHistory = [];
  room.consecutiveRejections = 0;
  room.phase = 'team-select';
  room.proposedTeam = [];
  room.teamVotes = {};
  room.questVotes = {};
  room.lastTeamVoteResult = null;
  room.lastQuestResult = null;
  room.resultHandled = false;
  // Lady of the Lake: token starts with player to the right of first leader
  if (room.roleConfig.ladyOfLake && room.players.length > 1) {
    const holderIndex = (room.currentLeaderIndex + 1) % room.players.length;
    room.ladyHolder = room.players[holderIndex].id;
    room.ladyUsed = [room.players[holderIndex].id]; // array instead of Set
    room.ladyHistory = [];
    room.ladyPendingResult = null;
  } else {
    room.ladyHolder = null;
  }
}

function resolveTeamVote(room) {
  const votes    = Object.values(room.teamVotes);
  const approves = votes.filter(v => v === 'approve').length;
  const rejects  = votes.filter(v => v === 'reject').length;
  const approved = approves > rejects;

  room.lastTeamVoteResult = {
    votes: room.players.map(p => ({ id: p.id, name: p.name, vote: room.teamVotes[p.id] || null })),
    approved,
  };

  if (approved) {
    room.consecutiveRejections = 0;
    room.phase = 'team-vote-result';
  } else {
    room.consecutiveRejections++;
    if (room.consecutiveRejections >= 5) {
      room.phase = 'game-over';
      room.winner = 'evil';
      room.winReason = '5 teams rejected in a row';
    } else {
      room.phase = 'team-vote-result';
    }
  }
  room.resultHandled = false;
}

function advanceFromTeamVoteResult(room) {
  if (room.resultHandled) return;
  room.resultHandled = true;
  if (room.lastTeamVoteResult.approved) {
    room.phase = 'quest-vote';
    room.questVotes = {};
    room.approvedTeamVote = room.lastTeamVoteResult;
  } else if (room.winner) {
    // game over already set
  } else {
    room.currentLeaderIndex = (room.currentLeaderIndex + 1) % room.players.length;
    room.phase = 'team-select';
    room.proposedTeam = [];
    room.teamVotes = {};
  }
}

function resolveQuestVote(room) {
  const votes  = Object.values(room.questVotes);
  const fails  = votes.filter(v => v === 'fail').length;
  const config = room.campaignsConfig[room.currentCampaign];
  const passed = fails < config.failsNeeded;

  room.campaignResults.push(passed ? 'pass' : 'fail');
  room.lastQuestResult = { fails, failsNeeded: config.failsNeeded, passed };
  room.questHistory = room.questHistory || [];

  const questVoteBreakdown = Object.entries(room.questVotes).map(([id, vote]) => {
    const p = room.players.find(q => q.id === id);
    return { name: p ? p.name : '?', vote };
  });

  room.questHistory.push({
    campaign: room.currentCampaign,
    team: room.proposedTeam.map(id => { const p = room.players.find(q => q.id === id); return p ? p.name : '?'; }),
    leaderName: room.players[room.currentLeaderIndex]?.name,
    teamVotes: room.approvedTeamVote?.votes || [],
    questVoteBreakdown,
    fails,
    failsNeeded: config.failsNeeded,
    passed,
  });

  const total    = room.campaignsConfig.length;
  const toWin    = Math.ceil(total / 2);
  const passes   = room.campaignResults.filter(r => r === 'pass').length;
  const failures = room.campaignResults.filter(r => r === 'fail').length;

  if (passes >= toWin)        { room.pendingAssassination = true; }
  else if (failures >= toWin) { room.winner = 'evil'; room.winReason = null; }

  room.phase = 'quest-result';
  room.resultHandled = false;
}

function advanceFromQuestResult(room) {
  if (room.resultHandled) return;
  room.resultHandled = true;
  if (room.pendingAssassination) {
    room.pendingAssassination = false;
    room.phase = 'assassination';
  } else if (room.winner) {
    room.phase = 'game-over';
  } else {
    const total = room.campaignsConfig.length;
    const useLady = room.ladyHolder && room.currentCampaign < total - 1 &&
      room.currentCampaign >= 1;
    room.currentCampaign++;
    room.currentLeaderIndex = (room.currentLeaderIndex + 1) % room.players.length;
    if (useLady) {
      room.phase = 'lady-of-lake';
      room.ladyPendingResult = null;
      return;
    }
    room.phase = 'team-select';
    room.proposedTeam = [];
    room.teamVotes = {};
    room.questVotes = {};
    room.lastTeamVoteResult = null;
    room.lastQuestResult = null;
  }
}

module.exports = { beginGame, resolveTeamVote, advanceFromTeamVoteResult, resolveQuestVote, advanceFromQuestResult };
