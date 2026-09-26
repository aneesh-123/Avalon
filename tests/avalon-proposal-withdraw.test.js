/**
 * Taking a proposed team back.
 *
 * The leader may withdraw at any point before the vote resolves. Every vote
 * already cast on the old team is thrown away, and the table votes again from
 * scratch on whatever is proposed next — nobody is left holding an opinion
 * about a team that no longer exists, and nobody's earlier approve is quietly
 * carried onto a team they never saw.
 *
 * Withdrawing records no rejection, which reads like a way to escape a vote
 * that is going badly. It is not: votes are masked to 'voted' for the whole
 * phase, so the leader can see who has voted but not how. There is nothing to
 * react to except the table talking, which is the game.
 */

const registerHandlers = require('../server/socketHandlers');
const { gameState, canWithdrawProposal } = require('../server/state');
const { makeIo, connectSocket, buildRoom, startGame, clearRooms } = require('./helpers');

jest.mock('../server/db', () => ({
  saveRoom:   () => Promise.resolve(),
  deleteRoom: () => Promise.resolve(),
  loadRooms:  () => Promise.resolve([]),
}));

let io;
beforeEach(() => { clearRooms(); ({ io } = makeIo()); registerHandlers(io); });

const makePlayers = n => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, name: `P${i + 1}` }));

function table() {
  const players = makePlayers(5);
  const room = buildRoom('R1', players, { state: 'playing' });
  startGame(room);
  room.phase = 'team-select';
  const sockets = players.map(p => { const s = connectSocket(io, p.id); s.join('R1'); return s; });
  const sock   = id => sockets.find(s => s.id === id);
  const leader = () => room.players[room.currentLeaderIndex];
  const others = () => room.players.filter(p => p.id !== leader().id);
  const size   = () => room.campaignsConfig[room.currentCampaign].teamSize;
  const propose = (from = 0) => {
    room.phase = 'team-select';
    sock(leader().id).trigger('propose-team', {
      team: room.players.slice(from, from + size()).map(p => p.id),
    });
  };
  return { room, sock, leader, others, propose, size };
}

// ── Withdrawing, at any point ─────────────────────────────────────────────

describe('the leader can take a proposal back while the table is voting', () => {
  test('before anyone has voted', () => {
    const { room, sock, leader, propose } = table();
    propose();
    sock(leader().id).trigger('cancel-proposal');
    expect(room.phase).toBe('team-select');
    expect(room.proposedTeam).toEqual([]);
  });

  test('after some have voted — the point of the change', () => {
    const { room, sock, leader, others, propose } = table();
    propose();
    others().slice(0, 2).forEach(p => sock(p.id).trigger('team-vote', { vote: 'reject' }));
    expect(Object.keys(room.teamVotes)).toHaveLength(3);   // leader + two

    sock(leader().id).trigger('cancel-proposal');

    expect(room.phase).toBe('team-select');
    expect(room.teamVotes).toEqual({});                    // all of them undone
    expect(canWithdrawProposal({ ...room, phase: 'team-vote' })).toBe(true);
  });

  test('right up to the last outstanding vote', () => {
    const { room, sock, leader, others, propose } = table();
    propose();
    others().slice(0, 3).forEach(p => sock(p.id).trigger('team-vote', { vote: 'approve' }));
    expect(room.phase).toBe('team-vote');                  // one still to vote
    sock(leader().id).trigger('cancel-proposal');
    expect(room.phase).toBe('team-select');
  });

  test('but not after the vote has resolved', () => {
    const { room, sock, leader, others, propose } = table();
    propose();
    others().forEach(p => sock(p.id).trigger('team-vote', { vote: 'approve' }));
    expect(room.phase).not.toBe('team-vote');              // settled
    const settled = room.phase;
    sock(leader().id).trigger('cancel-proposal');
    expect(room.phase).toBe(settled);
  });
});

// ── Everyone votes again, from scratch ────────────────────────────────────

describe('after a withdrawal the table votes again from scratch', () => {
  test('nobody carries their old vote onto the new team', () => {
    const { room, sock, leader, others, propose } = table();
    propose(0);
    const early = others()[0];
    sock(early.id).trigger('team-vote', { vote: 'approve' });
    sock(leader().id).trigger('cancel-proposal');

    propose(1);                                            // a different team
    expect(room.teamVotes[early.id]).toBeUndefined();      // their approve is gone
    expect(Object.keys(room.teamVotes)).toEqual([leader().id]);
  });

  test('and can vote either way on it', () => {
    const { room, sock, leader, others, propose } = table();
    propose(0);
    const p = others()[0];
    sock(p.id).trigger('team-vote', { vote: 'approve' });
    sock(leader().id).trigger('cancel-proposal');
    propose(1);

    sock(p.id).trigger('team-vote', { vote: 'reject' });   // changed their mind
    expect(room.teamVotes[p.id]).toBe('reject');
  });

  test('re-proposing the very same players is still a fresh vote', () => {
    const { room, sock, leader, others, propose } = table();
    propose(0);
    const team = [...room.proposedTeam];
    const firstId = gameState(room).proposalId;
    others().forEach(p => sock(p.id).trigger('team-vote', { vote: 'approve' }));

    // That resolved, so set up the same situation deliberately.
    room.phase = 'team-select';
    propose(0);
    expect(room.proposedTeam).toEqual(team);               // identical players
    expect(gameState(room).proposalId).toBeGreaterThan(firstId);
  });

  test('the vote is done only when everyone has voted', () => {
    const { room, sock, leader, others, propose } = table();
    propose();
    const rest = others();
    rest.slice(0, 3).forEach(p => sock(p.id).trigger('team-vote', { vote: 'approve' }));
    expect(room.phase).toBe('team-vote');                  // 4 of 5
    sock(rest[3].id).trigger('team-vote', { vote: 'approve' });
    expect(room.phase).toBe('team-vote-result');           // 5 of 5
    expect(room.lastTeamVoteResult.approved).toBe(true);
  });
});

// ── Telling the table ─────────────────────────────────────────────────────

describe('a withdrawal is announced, not silent', () => {
  test('naming who took what back, and how many votes it undid', () => {
    const { room, sock, leader, others, propose } = table();
    const leaderName = leader().name;
    propose();
    const named = room.proposedTeam.map(id => room.players.find(p => p.id === id).name);
    others().slice(0, 2).forEach(p => sock(p.id).trigger('team-vote', { vote: 'approve' }));

    sock(leader().id).trigger('cancel-proposal');

    const w = gameState(room).withdrawnProposal;
    expect(w.by).toBe(leaderName);
    expect(w.team).toEqual(named);
    expect(w.votesCleared).toBe(2);        // the leader's seeded approve is not counted
  });

  test('reporting zero when nobody had voted yet', () => {
    const { room, sock, leader, propose } = table();
    propose();
    sock(leader().id).trigger('cancel-proposal');
    expect(gameState(room).withdrawnProposal.votesCleared).toBe(0);
  });

  test('and the notice clears once a new team goes up', () => {
    const { room, sock, leader, propose } = table();
    propose();
    sock(leader().id).trigger('cancel-proposal');
    expect(gameState(room).withdrawnProposal).not.toBeNull();
    propose();
    expect(gameState(room).withdrawnProposal).toBeNull();
  });
});

// ── Who may do it ─────────────────────────────────────────────────────────

describe('only the leader may withdraw', () => {
  test('another player cannot', () => {
    const { room, sock, others, propose } = table();
    propose();
    sock(others()[0].id).trigger('cancel-proposal');
    expect(room.phase).toBe('team-vote');
  });

  test('not during any other phase', () => {
    const { room, sock, leader } = table();
    ['team-select', 'quest-vote', 'assassination', 'game-over'].forEach(phase => {
      room.phase = phase;
      sock(leader().id).trigger('cancel-proposal');
      expect(room.phase).toBe(phase);
    });
  });
});

// ── Why this is not an escape hatch ───────────────────────────────────────

describe('withdrawing tells the leader nothing they could act on', () => {
  test('votes are masked for everyone while the phase runs', () => {
    const { room, sock, others, propose } = table();
    propose();
    others().forEach(p => sock(p.id).trigger('team-vote', { vote: 'reject' }));
    // Resolution flips the phase, so inspect mid-vote instead.
    room.phase = 'team-vote';
    const shown = gameState(room).teamVotes;
    expect(Object.values(shown).every(v => v === 'voted')).toBe(true);
    expect(Object.values(shown)).not.toContain('reject');
  });
});
