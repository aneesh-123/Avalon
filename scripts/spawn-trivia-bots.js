/**
 * spawn-trivia-bots.js — a live Trivia Night game with bot teams.
 *
 * Two ways to use it:
 *
 *   You play on a team (the default). The script creates the quiz, a bot runs
 *   it, and bot teams play against you. Open the printed JOIN URL, pick or
 *   start a team, and the quiz begins.
 *     node scripts/spawn-trivia-bots.js [--mode=host|auto] [--bots=3]
 *
 *   You host. Create the quiz yourself in the browser, then fill it with bot
 *   teams that buzz or answer on their own.
 *     node scripts/spawn-trivia-bots.js --room=ABCDE [--bots=3]
 *
 * Flags: --mode=host (a quizmaster reads and runs buzzers) or auto (no host,
 * multiple choice), --bots=N teams (1–7), --categories=geography,marvel,
 * --rounds=N, --per-round=N, --seconds=N (auto mode), --url=.
 *
 * With a bot quizmaster, the bot can't hear your answer, so it counts your
 * team's buzz as correct; bot teams are marked right about half the time.
 * Bots buzz 1.5–5s after the buzzers open, so you have a fair shot.
 *
 * Bots are plain socket clients — no browser windows.
 */
const { io } = require('socket.io-client');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));

const URL   = String(args.url || 'http://localhost:3000').replace(/\/$/, '');
const BOTS  = Math.max(1, Math.min(7, parseInt(args.bots || '3', 10)));
const MODE  = args.mode === 'auto' ? 'auto' : 'host';
const NAMES = [['Robo Rita', 'Silicon Sages'], ['Botholomew', 'Quizzy Rascals'], ['Cy Borg', 'Know-It-Alls'],
               ['Ada', 'Brainiacs'], ['Hal', 'The Buzzards'], ['Turing', 'Smarty Pants'], ['Byte', 'Nerd Herd']];
const rand  = (a, b) => a + Math.random() * (b - a);
const later = (ms, fn) => setTimeout(fn, ms);

const JOIN_ROOM = String(args.room || '').toUpperCase();
if (args.room && !/^[A-Z0-9]{5}$/.test(JOIN_ROOM)) {
  console.error('Room codes are five characters: --room=ABCDE');
  process.exit(1);
}

// ── A bot team ───────────────────────────────────────────────────────────
function teamBot(code, i, { creator = null } = {}) {
  const [name, team] = NAMES[i];
  const token = `bot-${code || 'new'}-${i}-${Date.now()}`;
  const s = creator || io(URL, { transports: ['websocket'] });
  let room = code;
  const act = (ev, extra = {}) => s.emit(ev, { code: room, token: s.botToken || token, ...extra });
  let lastOpen = null, lastQ = null, madeTeam = false;

  if (!creator) s.on('connect', () => s.emit('triv:join-room', { code: room, name, token }));
  s.on('triv:joined', d => { room = d.code; });
  s.on('triv:error', msg => console.log(`[${name}] ${msg}`));
  s.on('triv:state', v => {
    if (!v.you) return;
    if (!v.you.teamId && !madeTeam && !v.you.quizmaster) { madeTeam = true; act('triv:create-team', { name: team }); return; }
    if (v.phase !== 'question') return;

    if (v.mode === 'host' && v.buzz?.open && v.buzz.openId !== lastOpen) {
      lastOpen = v.buzz.openId;
      if (Math.random() < 0.3) return;   // sometimes nobody on this team knows
      const openId = v.buzz.openId;
      later(rand(1500, 5000), () => act('triv:buzz', { openId, at: null }));
    }

    const qKey = `${v.round.index}-${v.round.qIndex}`;
    if (v.mode === 'auto' && !v.answers?.yours && lastQ !== qKey) {
      lastQ = qKey;
      const left = (v.phaseEndsAt || v.serverNow + 10000) - v.serverNow;
      later(rand(2000, Math.max(2500, left * 0.8)), () => act('triv:answer', { choice: Math.floor(Math.random() * 4) }));
    }
  });
  return { name, team };
}

// ── You host: just fill the room ─────────────────────────────────────────
if (JOIN_ROOM) {
  for (let i = 0; i < BOTS; i++) {
    const { name, team } = teamBot(JOIN_ROOM, i);
    console.log(`[${name}] joining ${JOIN_ROOM} as ${team}`);
  }
  return;
}

// ── You play: a bot creates and runs the quiz ────────────────────────────
const config = {
  mode: MODE,
  categories: args.categories ? String(args.categories).split(',') : ['geography', 'movies', 'harry-potter'],
  rounds: parseInt(args.rounds || '2', 10),
  perRound: parseInt(args['per-round'] || '5', 10),
  seconds: parseInt(args.seconds || '20', 10),
  roundStyle: 'themed',
};

const host = io(URL, { transports: ['websocket'] });
host.botToken = `bot-host-${Date.now()}`;
const hostName = MODE === 'host' ? 'Quizbot' : NAMES[0][0];
let code = null, started = false, botTeamIds = new Set();
const hostAct = (ev, extra = {}) => host.emit(ev, { code, token: host.botToken, ...extra });
const pending = new Map();   // one scheduled action per step, so repeated state updates don't pile up
function once(key, ms, fn) { if (pending.has(key)) return; pending.set(key, later(ms, fn)); }

host.on('connect', () => {
  if (code) return;
  host.emit('triv:create-room', { name: hostName, token: host.botToken, config });
});

host.on('triv:joined', d => {
  if (code) return;
  code = d.code;
  // In a no-host game the creator plays on a team too.
  const teamBotsToSpawn = MODE === 'auto' ? BOTS - 1 : BOTS;
  if (MODE === 'auto') teamBot(code, 0, { creator: host });
  for (let i = MODE === 'auto' ? 1 : 0; i < teamBotsToSpawn + (MODE === 'auto' ? 1 : 0); i++) teamBot(code, i);
  console.log(`Room ${code} · ${MODE === 'host' ? 'hosted by Quizbot' : 'no host'} · ${BOTS} bot team(s)`);
  console.log(`JOIN URL: ${URL}/?room=${code}&game=trivia&name=You`);
});

host.on('triv:state', v => {
  const botNames = new Set([hostName, ...NAMES.map(n => n[0])]);
  v.teams.forEach(t => { if (t.members.length && t.members.every(m => botNames.has(m.name))) botTeamIds.add(t.id); });
  const humanTeam = v.teams.find(t => t.members.some(m => !botNames.has(m.name)));

  // Start as soon as a person has a team and every bot team has formed.
  if (v.state === 'lobby') {
    if (!started && humanTeam && botTeamIds.size >= BOTS) {
      started = true;
      once('start', 1500, () => { console.log(`Starting — you're on ${humanTeam.name}`); hostAct('triv:start'); });
    }
    return;
  }
  if (MODE === 'auto') return;   // the server paces a no-host game itself

  const step = `${v.phase}-${v.round?.index}-${v.round?.qIndex}`;
  const clear = () => pending.forEach((t, k) => { if (!k.startsWith(step)) { clearTimeout(t); pending.delete(k); } });
  clear();

  switch (v.phase) {
    case 'round-intro':
      once(step, 3000, () => hostAct('triv:next', { phase: 'round-intro' }));
      break;
    case 'question': {
      const b = v.buzz || {};
      if (b.answeringTeamId) {
        const correct = botTeamIds.has(b.answeringTeamId) ? Math.random() < 0.5 : true;
        once(`${step}-judge-${b.answeringTeamId}`, 2000, () => hostAct('triv:judge', { correct, teamId: b.answeringTeamId }));
      } else if (!b.open) {
        // Give people time to read it, as a host reading aloud would.
        const readMs = 2500 + (v.question?.text?.length || 60) * 35;
        once(`${step}-open-${(b.lockedOut || []).length}`, (b.lockedOut || []).length ? 800 : readMs, () => hostAct('triv:open-buzzers'));
      } else {
        // Nobody buzzing: reveal after a while.
        once(`${step}-giveup`, 12000, () => hostAct('triv:next', { phase: 'question', qIndex: v.round.qIndex }));
      }
      break;
    }
    case 'reveal':
      once(step, 4500, () => hostAct('triv:next', { phase: 'reveal', qIndex: v.round.qIndex }));
      break;
    case 'round-end':
      once(step, 6000, () => hostAct('triv:next', { phase: 'round-end' }));
      break;
    case 'game-over':
      console.log('Game over.');
      break;
  }
});
