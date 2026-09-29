// Per-viewer views of a Trivia room. Unlike Avalon's broadcast state these are
// built for one player at a time, because the host sees the answer key and
// each team sees its own locked-in answer before anyone else does.
const { categoryName, categoryIcon } = require('./questions');
const { suggestTeamName, currentRound, activeTeams } = require('./engine');

function catInfo(id) { return { id, name: categoryName(id), icon: categoryIcon(id) }; }

// `live` is a Set of socket ids that are connected right now.
function viewFor(room, player, live) {
  const isHost = !!player && room.hostId === player.id;
  const quizmaster = room.config.mode === 'host' && isHost;
  const hostPlayer = room.players.find(p => p.id === room.hostId) || null;
  const phase = room.state === 'playing' ? room.phase : null;
  const round = room.state === 'playing' ? currentRound(room) : null;

  const view = {
    code: room.code,
    state: room.state,
    phase,
    mode: room.config.mode,
    config: {
      categories: room.config.categories.map(catInfo),
      rounds: room.config.rounds,
      perRound: room.config.perRound,
      seconds: room.config.seconds,
      roundStyle: room.config.roundStyle,
      showOnPhones: room.config.showOnPhones,
    },
    you: player ? { id: player.id, name: player.name, teamId: player.teamId || null, isHost, quizmaster } : null,
    host: hostPlayer ? { name: hostPlayer.name, connected: live.has(hostPlayer.id) } : null,
    teams: room.teams.map(t => ({
      id: t.id, name: t.name, crest: t.crest, color: t.color, score: t.score,
      members: room.players.filter(p => p.teamId === t.id)
        .map(p => ({ name: p.name, connected: live.has(p.id), you: !!player && p.id === player.id })),
    })),
    // Seated but not on a team yet (and not the quizmaster, who never is).
    unassigned: room.players
      .filter(p => !p.teamId && !(room.config.mode === 'host' && p.id === room.hostId))
      .map(p => p.name),
    suggestedTeamName: suggestTeamName(room),
    serverNow: Date.now(),
    phaseEndsAt: room.phaseEndsAt || null,
    phaseStartedAt: room.phaseStartedAt || null,
    stalled: !!room.stalled,
  };

  if (room.state !== 'playing') return view;

  view.round = {
    index: room.roundIndex,
    total: room.plan.length,
    category: catInfo(round.category),
    qIndex: room.qIndex,
    count: round.questionIds.length,
    plan: room.plan.map(r => catInfo(r.category)),
  };
  view.roundScores = room.roundScores;

  const cur = room.current;
  if (cur && (phase === 'question' || phase === 'reveal')) {
    const revealed = phase === 'reveal';
    if (room.config.mode === 'host') {
      if (quizmaster) {
        view.question = { text: cur.hostQ || cur.q, answer: cur.a, category: catInfo(cur.category) };
      } else {
        const text = room.config.showOnPhones ? (cur.phoneHostQ || cur.q) : null;
        view.question = { text, answer: revealed ? cur.a : null, category: catInfo(cur.category) };
      }
    } else {
      view.question = {
        text: cur.q,
        choices: cur.choices,
        correctIndex: revealed ? cur.correctIndex : null,
        answer: revealed ? cur.a : null,
        category: catInfo(cur.category),
      };
    }
  }

  if (room.config.mode === 'host' && room.buzz && phase === 'question') {
    const b = room.buzz;
    const myTeam = player?.teamId || null;
    view.buzz = {
      open: b.open,
      openId: b.open ? b.openId : null,
      openedAt: b.openedAt,
      deciding: b.open && b.candidates.length > 0,
      lockedOut: [...b.lockedOut],
      wrong: [...b.wrong],
      answeringTeamId: b.answeringTeamId,
      answeringName: b.answeringName || null,
      // The order and the gaps between buzzes are only settled once the
      // window closes; showing a half-filled list would flicker.
      order: b.answeringTeamId ? b.order : [],
      yourTeamBuzzed: !!myTeam && (b.candidates.some(c => c.teamId === myTeam)),
      eligibleCount: activeTeams(room).filter(t => !b.lockedOut.includes(t.id)).length,
    };
  }

  if (room.config.mode === 'auto' && phase === 'question') {
    const mine = player?.teamId ? room.answers[player.teamId] : null;
    view.answers = {
      answeredTeamIds: Object.keys(room.answers),
      yours: mine ? { choice: mine.choice, by: mine.by } : null,
      teamCount: activeTeams(room).length,
    };
  }

  if (phase === 'reveal') view.result = room.result;

  return view;
}

module.exports = { viewFor };
