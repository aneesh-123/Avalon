/**
 * spawn-trivia-bots.js — fill a Trivia Night room with bot teams.
 *
 * Create a quiz on your phone or browser, then point this at its room code.
 * Each bot joins as its own team and plays: in a hosted quiz it buzzes a
 * random moment after you open the buzzers; in a no-host quiz it picks an
 * answer at random before the clock runs out.
 *
 *   node scripts/spawn-trivia-bots.js --room=ABCDE [--bots=3] [--url=http://localhost:3000]
 *
 * Bots are plain socket clients — no browser windows.
 */
const { io } = require('socket.io-client');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));

const URL  = args.url || 'http://localhost:3000';
const ROOM = String(args.room || '').toUpperCase();
const BOTS = Math.max(1, Math.min(7, parseInt(args.bots || '3', 10)));
const NAMES = [['Robo Rita', 'Silicon Sages'], ['Botholomew', 'Quizzy Rascals'], ['Cy Borg', 'Know-It-Alls'],
               ['Ada', 'Brainiacs'], ['Hal', 'The Buzzards'], ['Turing', 'Smarty Pants'], ['Byte', 'Nerd Herd']];

if (!/^[A-Z0-9]{5}$/.test(ROOM)) {
  console.error('Pass the room code: --room=ABCDE');
  process.exit(1);
}

const rand = (a, b) => a + Math.random() * (b - a);

for (let i = 0; i < BOTS; i++) {
  const [name, team] = NAMES[i];
  const token = `bot-${ROOM}-${i}`;
  const s = io(URL, { transports: ['websocket'] });
  const act = (ev, extra = {}) => s.emit(ev, { code: ROOM, token, ...extra });
  let lastOpen = null, lastQ = null, madeTeam = false;

  s.on('connect', () => s.emit('triv:join-room', { code: ROOM, name, token }));
  s.on('triv:error', msg => console.log(`[${name}] ${msg}`));
  s.on('triv:state', v => {
    if (!v.you) return;
    if (!v.you.teamId && !madeTeam) { madeTeam = true; act('triv:create-team', { name: team }); return; }
    if (v.phase !== 'question') return;

    if (v.mode === 'host' && v.buzz?.open && v.buzz.openId !== lastOpen) {
      lastOpen = v.buzz.openId;
      if (Math.random() < 0.25) return;   // sometimes nobody on this team knows
      const openId = v.buzz.openId;
      setTimeout(() => act('triv:buzz', { openId, at: null }), rand(400, 3000));
    }

    const qKey = `${v.round.index}-${v.round.qIndex}`;
    if (v.mode === 'auto' && !v.answers?.yours && lastQ !== qKey) {
      lastQ = qKey;
      const left = (v.phaseEndsAt || Date.now() + 10000) - v.serverNow;
      setTimeout(() => act('triv:answer', { choice: Math.floor(Math.random() * 4) }), rand(1500, Math.max(2000, left * 0.8)));
    }
  });
  console.log(`[${name}] joining ${ROOM} as ${team}`);
}
