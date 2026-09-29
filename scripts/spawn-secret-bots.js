/**
 * spawn-secret-bots.js — fill a Secret Hitler room with bot players.
 *
 * Create a game on your phone or browser, then point this at its room code.
 * The bots join, look at their roles, and play with random choices: they vote,
 * nominate, pass and enact policies, and use presidential powers.
 *
 *   node scripts/spawn-secret-bots.js --room=ABCDE [--bots=4] [--url=http://localhost:3000]
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
const BOTS = Math.max(1, Math.min(9, parseInt(args.bots || '4', 10)));
const NAMES = ['Robo Rita', 'Botholomew', 'Cy Borg', 'Ada', 'Hal', 'Turing', 'Byte', 'Pixel', 'Widget'];

if (!/^[A-Z0-9]{5}$/.test(ROOM)) {
  console.error('Pass the room code: --room=ABCDE');
  process.exit(1);
}

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const soon = fn => setTimeout(fn, 600 + Math.random() * 1400);

for (let i = 0; i < BOTS; i++) {
  const name = NAMES[i];
  const token = `bot-${ROOM}-${i}`;
  const s = io(URL, { transports: ['websocket'] });
  const act = (ev, extra = {}) => s.emit(ev, { code: ROOM, token, ...extra });
  let lastKey = '';

  s.on('connect', () => s.emit('sec:join-room', { code: ROOM, name, token }));
  s.on('sec:error', msg => console.log(`[${name}] ${msg}`));
  s.on('sec:state', v => {
    const g = v.game, me = v.you?.seat;
    if (!g || me === undefined) return;
    // One decision per situation, however many state updates arrive.
    const key = `${g.round}:${g.phase}:${g.president}:${g.chancellor}:${g.vetoDenied}:${g.power?.target ?? ''}`;
    if (key === lastKey) return;
    lastKey = key;
    const alive = v.players[me].alive;

    if (g.phase === 'reveal' && !g.ready.includes(me)) soon(() => act('sec:ready'));
    else if (g.phase === 'nominate' && g.president === me) soon(() => act('sec:nominate', { target: pick(g.eligible) }));
    else if (g.phase === 'vote' && alive) soon(() => act('sec:vote', { ja: Math.random() < 0.65 }));
    else if (g.phase === 'president-discard' && g.president === me) soon(() => act('sec:discard', { index: Math.floor(Math.random() * 3) }));
    else if (g.phase === 'chancellor-enact' && g.chancellor === me) {
      soon(() => (g.vetoUnlocked && !g.vetoDenied && Math.random() < 0.3)
        ? act('sec:veto') : act('sec:enact', { index: Math.floor(Math.random() * 2) }));
    }
    else if (g.phase === 'veto' && g.president === me) soon(() => act('sec:veto-answer', { accept: Math.random() < 0.5 }));
    else if (g.phase === 'power' && g.president === me) {
      const p = g.power;
      if (p.type === 'peek' || (p.type === 'investigate' && p.result)) soon(() => act('sec:power-done'));
      else if (p.target === null) soon(() => act('sec:power', { target: pick(p.targets) }));
    }
  });
  console.log(`[${name}] joining ${ROOM}`);
}
