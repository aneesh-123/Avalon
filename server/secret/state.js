// Per-viewer views of a Secret Hitler room. Almost everything in this game is
// hidden from someone — roles, the cards in a President's hand, what an
// investigation found — so every view is built for one seat and nothing
// secret is ever broadcast to the room.
const E = require('./engine');

// `live` is a Set of socket ids that are connected right now.
function viewFor(room, player, live) {
  const seat = player ? room.players.indexOf(player) : -1;
  const g = room.state === 'playing' ? room.g : null;
  const host = room.players.find(p => p.id === room.hostId) || null;
  const over = g?.phase === 'over';

  const view = {
    code: room.code,
    state: room.state,
    minPlayers: E.MIN_PLAYERS,
    maxPlayers: E.MAX_PLAYERS,
    you: player ? { seat, name: player.name, isHost: room.hostId === player.id } : null,
    host: host ? { name: host.name, connected: live.has(host.id) } : null,
    players: room.players.map((p, i) => ({
      seat: i,
      name: p.name,
      connected: live.has(p.id),
      you: i === seat,
      alive: p.alive !== false,
    })),
  };

  if (!g) {
    view.teams = E.TEAMS[room.players.length] || null;
    view.powers = room.players.length >= E.MIN_PLAYERS && room.players.length <= E.MAX_PLAYERS
      ? E.powerTrack(room.players.length) : null;
    return view;
  }

  const me = room.players[seat];
  view.game = {
    phase: g.phase,
    round: g.round,
    liberal: g.liberal,
    fascist: g.fascist,
    tracker: g.tracker,
    deckCount: g.deck.length,
    discardCount: g.discard.length,
    powers: E.powerTrack(room.players.length),
    vetoUnlocked: E.vetoUnlocked(room),
    vetoDenied: g.vetoDenied,
    teams: E.TEAMS[room.players.length],
    president: g.president,
    chancellor: g.chancellor,
    lastElected: g.lastElected,
    lastVote: g.lastVote,
    lastEvent: g.lastEvent,
    ready: g.phase === 'reveal' ? [...g.ready] : null,
    // Who has voted is public; how, only once everyone has.
    voted: g.phase === 'vote' ? Object.keys(g.votes).map(Number) : null,
    yourVote: g.phase === 'vote' && typeof g.votes[seat] === 'boolean' ? g.votes[seat] : null,
    log: g.log.slice(-30),
    winner: g.winner,
    winReason: g.winReason,
  };

  if (me?.role) {
    view.game.role = me.role;
    view.game.party = E.partyOf(me.role);
    view.game.known = E.knownTo(room, seat);
    view.game.investigations = g.investigations
      .filter(x => x.by === seat)
      .map(x => ({ target: x.target, party: x.party }));
  }

  if (g.phase === 'nominate' && seat === g.president) view.game.eligible = E.eligibleChancellors(room);
  if (g.phase === 'nominate' || g.phase === 'vote') {
    // Shown to everyone so the table can see why a name is greyed out.
    view.game.termLimited = room.players.map((_, i) => i).filter(i =>
      E.alive(room, i) && i !== g.president && !E.eligibleChancellors(room).includes(i));
  }

  if (g.phase === 'president-discard' && seat === g.president) view.game.hand = [...g.hand];
  if ((g.phase === 'chancellor-enact' || g.phase === 'veto') && seat === g.chancellor) view.game.hand = [...g.hand];

  if (g.power) {
    const mine = seat === g.president;
    view.game.power = {
      type: g.power.type,
      target: g.power.target,
      // An execution and a special election are announced to the table; a
      // peek and an investigation result are the President's alone.
      cards: mine ? g.power.cards : null,
      result: mine ? g.power.result : null,
      targets: mine ? E.powerTargets(room) : null,
    };
  }

  if (over) view.game.roles = room.players.map((p, i) => ({ seat: i, role: p.role }));

  return view;
}

module.exports = { viewFor };
