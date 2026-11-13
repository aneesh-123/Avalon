// Per-viewer views of a Council room. Built one player at a time because the
// secrets differ: your role, your fellow traitors, and what you scouted.
const E = require('./engine');

function cardView(id) {
  const c = E.cardById(id);
  return c ? { id: c.id, icon: c.icon, title: c.title, text: c.text, gold: c.gold, people: c.people, follow: !!c.follow } : null;
}

function viewFor(room, player, live) {
  const g = room.game;
  const over = room.phase === 'game-over';

  const view = {
    code: room.code,
    state: room.state,
    phase: room.phase || null,
    rules: { start: E.START, rounds: E.ROUNDS, min: E.MIN_PLAYERS, max: E.MAX_PLAYERS },
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
  const traitor = me?.role === 'traitor';
  view.you.role = me?.role || null;
  if (traitor) view.you.allies = E.traitors(room).filter(p => p.pid !== me.pid).map(p => p.name);
  view.traitorCount = E.traitors(room).length;

  view.kingdom = { gold: g.gold, people: g.people };
  view.round = g.round;
  view.speaker = E.speakerPid(room);
  view.ready = g.ready;
  view.names = Object.fromEntries(room.players.map(p => [p.pid, p.name]));
  // The evidence board: everything the table has seen, round by round.
  view.history = g.history.map(h => ({ ...h, card: cardView(h.card) }));

  if (g.round > 0 && room.phase !== 'accuse' && !over) {
    view.card = cardView(g.card);
    view.scouts = g.scouts;
    view.reports = g.reports;
    // Secrets: a scout sees their own choice; a traitor sees both.
    const side = player ? E.scoutSide(room, player.pid) : null;
    if (traitor) view.secret = { gold: g.traps.gold, people: g.traps.people };
    else if (side) view.secret = { [side]: g.traps[side] };
    view.yourSide = side;
    if (room.phase === 'vote') {
      view.voted = Object.keys(g.votes);
      view.yourVote = player && player.pid in g.votes ? g.votes[player.pid] : null;
    }
    if (room.phase === 'result') view.result = g.result;
  }

  if (room.phase === 'accuse') {
    view.accused = Object.keys(g.accusations);
    view.yourAccusation = player ? g.accusations[player.pid] || null : null;
  }

  if (g.winner && (room.phase === 'result' || over)) {
    view.winner = g.winner;
    view.endReason = g.endReason;
  }
  if (over) {
    view.verdict = g.verdict || null;
    view.roleList = room.players.map(p => ({ pid: p.pid, name: p.name, role: p.role }));
    view.lastResult = g.history[g.history.length - 1] || null;
  }
  return view;
}

module.exports = { viewFor };
