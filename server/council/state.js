// Per-viewer views of a Council room. Built one player at a time because the
// secrets differ: your role, your fellow traitors, and this round's whisper.
const E = require('./engine');

function viewFor(room, player, live) {
  const g = room.game;
  const name = pid => E.seatOf(room, pid)?.name || '?';
  const over = room.phase === 'game-over';

  const view = {
    code: room.code,
    state: room.state,
    phase: room.phase || null,
    rules: { start: E.START, rounds: E.ROUNDS, maxRejects: E.MAX_REJECTS, min: E.MIN_PLAYERS, max: E.MAX_PLAYERS },
    you: player ? { pid: player.pid, name: player.name, isHost: room.hostId === player.id } : null,
    players: room.players.map(p => ({
      pid: p.pid, name: p.name, connected: live.has(p.id), host: room.hostId === p.id, bot: !!p.bot,
      you: !!player && p.pid === player.pid,
      // Roles stay hidden until the game is over.
      role: over ? p.role : null,
    })),
  };
  if (room.state !== 'playing' || !g) return view;

  const me = player ? E.seatOf(room, player.pid) : null;
  view.you.role = me?.role || null;
  if (me?.role === 'traitor') view.you.allies = E.traitors(room).filter(p => p.pid !== me.pid).map(p => p.name);
  view.traitorCount = E.traitors(room).length;

  view.kingdom = { gold: g.gold, people: g.people };
  view.round = g.round;
  view.leader = E.leaderPid(room);
  view.ready = g.ready;
  view.history = g.history.map(h => ({ round: h.round, kind: h.kind, option: h.option, amount: h.amount, sabotages: h.sabotages, trapped: h.trapped }));

  if (g.round > 0) {
    const card = E.cardById(g.card);
    view.card = card ? { icon: card.icon, title: card.title, text: card.text, gold: card.gold, people: card.people } : null;
    view.rejects = g.rejects;
    view.whisper = player && g.whispers.includes(player.pid) ? { trap: g.trap } : null;
    view.proposal = g.proposal ? { option: g.proposal.option, leader: g.proposal.leader, partner: g.proposal.partner } : null;
    if (room.phase === 'vote') {
      view.voted = Object.keys(g.votes);
      view.yourVote = player && player.pid in g.votes ? g.votes[player.pid] : null;
    }
    // Who voted which way is public once the vote is in, as in Avalon.
    view.lastVote = g.lastVote ? { passed: g.lastVote.passed, option: g.lastVote.proposal?.option,
      leader: g.lastVote.proposal?.leader, partner: g.lastVote.proposal?.partner,
      approve: g.lastVote.approve, reject: g.lastVote.reject } : null;
    if (room.phase === 'act') {
      view.acted = Object.keys(g.actions);
      view.yourAction = player && player.pid in g.actions ? g.actions[player.pid] : null;
    }
    if (room.phase === 'result' || over) view.result = g.result;
  }

  if (over || (room.phase === 'result' && g.winner)) {
    view.winner = g.winner;
    view.endReason = g.endReason;
  }
  if (over) view.roleList = room.players.map(p => ({ name: p.name, role: p.role }));
  view.names = Object.fromEntries(room.players.map(p => [p.pid, name(p.pid)]));
  return view;
}

module.exports = { viewFor };
