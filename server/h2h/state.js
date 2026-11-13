// What each player is sent. The right answer stays on the server until the
// reveal, and so does the opponent's pick: you only learn that they answered.
const E = require('./engine');
const Q = require('./questions');

function viewFor(room, player, live, now = Date.now()) {
  const g = room.game;
  const view = {
    code: room.code,
    state: room.state,
    phase: room.phase || null,
    category: Q.category(room.category),
    rules: { questions: E.QUESTIONS, answerMs: E.T.ANSWER_MS, max: E.MAX_PLAYERS },
    you: player ? { pid: player.pid, name: player.name } : null,
    players: room.players.map(p => ({
      pid: p.pid, name: p.name, score: p.score || 0, connected: live.has(p.id), you: !!player && p.pid === player.pid,
    })),
  };
  if (room.state === 'lobby') { view.categories = Q.categoryList(); return view; }
  if (!g) return view;

  view.remainingMs = g.phaseEnds == null ? null : Math.max(0, g.phaseEnds - now);
  view.index = g.index;
  view.total = g.questions.length;
  if (room.phase === 'question' || room.phase === 'reveal') {
    const q = g.questions[g.index];
    view.question = { n: g.index + 1, text: q.q, art: q.art, options: q.options, double: E.isLast(g) };
    view.answered = Object.keys(g.answers);
    const mine = player && g.answers[player.pid];
    view.yourChoice = mine ? mine.choice : null;
  }
  if (room.phase === 'reveal') {
    const last = g.history[g.history.length - 1];
    view.reveal = { answer: last.answer, picks: last.picks };
  }
  if (room.phase === 'game-over') {
    view.winner = g.winner;
    view.recap = g.history.map((h, i) => ({ n: i + 1, text: g.questions[i].q, art: g.questions[i].art,
      answer: g.questions[i].options[h.answer], picks: h.picks }));
  }
  return view;
}

module.exports = { viewFor };
