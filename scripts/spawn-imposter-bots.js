/**
 * spawn-imposter-bots.js — Imposter counterpart to spawn-bots.js. Launches
 * headed Playwright bots that pick the Imposter game, create/join a room, ready
 * up, and play through clues → discussion → vote → guess with simple heuristics.
 * One seat is left open for you.
 *
 * Bots read their own role card off the placard screen, so a bot that knows the
 * word gives a clue derived from that word's hint/related entry, while an
 * Imposter bluffs with a hint from some *other* word in the same category.
 *
 * Usage:
 *   node scripts/spawn-imposter-bots.js [--players=5] [--url=http://localhost:3001]
 *        [--seats-for-you=1] [--imposters=1] [--rounds=1]
 *        [--roles=detective,confused,doubleagent,accomplice,jester]
 *        [--hint=vague] [--categories=Food,Sports] [--custom-words=a,b]
 *        [--discussion-secs=0]
 *
 * Bots run at full speed — there is no simulated human pacing. Pass
 * --discussion-secs=N only to hold a phase open long enough to read it.
 *
 * They close themselves once the game ends. Ctrl+C stops a run early, leaving
 * the game/lobby cleanly so the seats free up.
 */

const { chromium } = require('playwright');
const { CATEGORIES } = require('../server/imposter/words');

// ── Args ──────────────────────────────────────────────────────────────────
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));

const PLAYER_COUNT     = parseInt(args.players || '5', 10);
const BASE_URL         = args.url || 'http://localhost:3001';
const SEATS_FOR_YOU    = parseInt(args['seats-for-you'] || '1', 10);
const BOT_COUNT        = PLAYER_COUNT - SEATS_FOR_YOU;
const IMPOSTER_COUNT   = parseInt(args.imposters || '1', 10);
const CLUE_ROUNDS      = parseInt(args.rounds || '1', 10);
const DISCUSSION_SECS  = parseInt(args['discussion-secs'] || '0', 10);
const SPECIAL_ROLES    = args.roles ? String(args.roles).split(',').filter(Boolean) : [];
const HINT_LEVEL       = args.hint ? String(args.hint) : null;
const KNOW_EACH_OTHER  = args['know-each-other'] === '1' || args['know-each-other'] === true;
const PICK_CATEGORIES  = args.categories ? String(args.categories).split(',').map(c => c.trim()).filter(Boolean) : [];
const CUSTOM_WORDS     = args['custom-words'] ? String(args['custom-words']).split(',').map(w => w.trim()).filter(Boolean) : [];
const BOT_NAMES        = ['Bot-Alice', 'Bot-Bob', 'Bot-Carol', 'Bot-Dave', 'Bot-Eve', 'Bot-Finn', 'Bot-Gwen', 'Bot-Hank', 'Bot-Ivy', 'Bot-Jack'];

// Client floors the picker at 4 (see #imp-pc-minus disabled at <=4).
const MIN_PLAYERS = 4;
if (PLAYER_COUNT < MIN_PLAYERS) {
  console.error(`--players=${PLAYER_COUNT} is below the Imposter minimum of ${MIN_PLAYERS}.`);
  process.exit(1);
}
if (BOT_COUNT < 1) {
  console.error(`Need at least 1 bot: players=${PLAYER_COUNT} minus seats-for-you=${SEATS_FOR_YOU} leaves ${BOT_COUNT}.`);
  process.exit(1);
}

const ROLE_CHECKBOX = {
  detective:   'imp-role-detective',
  confused:    'imp-role-confused',
  doubleagent: 'imp-role-doubleagent',
  accomplice:  'imp-role-accomplice',
  jester:      'imp-role-jester',
};

// ── Window tiling ─────────────────────────────────────────────────────────
const SCREEN_W = 1920, SCREEN_H = 1080;
const cols = Math.ceil(Math.sqrt(BOT_COUNT));
const rows = Math.ceil(BOT_COUNT / cols);
const winW = Math.floor(SCREEN_W / cols);
const winH = Math.floor(SCREEN_H / rows);

function windowPosition(i) {
  const col = i % cols, row = Math.floor(i / cols);
  return { x: col * winW, y: row * winH, width: winW, height: winH };
}

// ── Helpers ───────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
const norm = s => String(s || '').trim().toLowerCase();

const HEADLESS = process.env.BOTS_HEADLESS === '1';

// Bots move as fast as the UI allows — this is a test harness, not a
// simulation of human pacing. --discussion-secs adds a pause back if wanted.
const POLL_MS = 120;

// Clue vocabulary drawn from the same word bank the server uses, so clues sound
// like something a real player would say rather than filler text.
function entryForWord(word) {
  for (const [category, entries] of Object.entries(CATEGORIES)) {
    const hit = entries.find(e => norm(e.word) === norm(word));
    if (hit) return { category, ...hit };
  }
  return null;
}

function hintTokens(hint) {
  return String(hint || '').split(/[\s,—-]+/).filter(w => w.length > 3);
}

/**
 * Build a clue for this bot.
 *  - Knows the word  → tokens from that word's hint, or its `related` word.
 *  - Doesn't know it → a hint token from a *different* word in the category,
 *    which is exactly the kind of plausible-but-off clue an Imposter gives.
 * Never returns the secret word itself or a clue already on the board.
 */
function makeClue(bot, state) {
  const used = new Set(state.usedClues.map(norm));
  let pool = [];

  if (bot.card.word) {
    const entry = entryForWord(bot.card.word);
    if (entry) pool = [...hintTokens(entry.hint), entry.related];
    if (!pool.length) pool = hintTokens(bot.card.category);
  } else {
    const category = bot.card.category || state.category;
    const entries = CATEGORIES[category];
    if (entries) {
      const other = pick(entries);
      pool = [...hintTokens(other.hint), other.related];
    }
  }

  pool = pool
    .filter(Boolean)
    .filter(c => norm(c) !== norm(bot.card.word))
    .filter(c => !used.has(norm(c)));

  if (!pool.length) pool = ['tricky', 'familiar', 'common', 'everyday', 'classic'].filter(c => !used.has(c));
  return pick(pool) || 'hmm';
}

function guessWord(bot, state) {
  const category = bot.card.category || state.category;
  const entries = CATEGORIES[category] || pick(Object.values(CATEGORIES));
  return pick(entries).word;
}

// ── Browser plumbing ──────────────────────────────────────────────────────
async function launchBot(name, index) {
  const pos = windowPosition(index);
  const launchOpts = {
    headless: HEADLESS,
    args: [`--window-position=${pos.x},${pos.y}`, `--window-size=${pos.width},${pos.height}`],
  };
  if (HEADLESS && process.env.BOTS_CHROMIUM_PATH) {
    launchOpts.executablePath = process.env.BOTS_CHROMIUM_PATH;
    launchOpts.args.push('--no-sandbox');
  }
  const browser = await chromium.launch(launchOpts);
  const context = await browser.newContext({ viewport: { width: pos.width, height: pos.height - 90 } });
  const page = await context.newPage();
  await page.goto(BASE_URL);
  await page.click('#pick-imposter');
  return { name, browser, context, page, card: { word: null, role: null, category: null }, revealed: false };
}

async function createRoom(bot) {
  const { page, name } = bot;
  await page.click('#imp-btn-create');

  let current = parseInt(await page.textContent('#imp-pc-value'), 10);
  while (current < PLAYER_COUNT) { await page.click('#imp-pc-plus'); current++; }
  while (current > PLAYER_COUNT) { await page.click('#imp-pc-minus'); current--; }
  await page.click('#imp-pc-confirm-btn');

  let imps = parseInt(await page.textContent('#imp-ic-value'), 10);
  while (imps < IMPOSTER_COUNT) { await page.click('#imp-ic-plus'); imps++; }
  while (imps > IMPOSTER_COUNT) { await page.click('#imp-ic-minus'); imps--; }
  // Off by default, so each imposter bluffs alone unless asked otherwise.
  if (KNOW_EACH_OTHER) await page.check('#imp-know-checkbox');
  await page.click('#imp-ic-confirm-btn');

  if (CLUE_ROUNDS === 2) await page.check('#imp-two-rounds');
  if (HINT_LEVEL) await page.selectOption('#imp-hint-select', HINT_LEVEL);

  if (PICK_CATEGORIES.length || CUSTOM_WORDS.length) {
    // Categories and host-added words live behind a collapsed callout.
    await page.click('#imp-categories-toggle');
    for (const cat of PICK_CATEGORIES) {
      const chip = page.locator(`.imp-chip[data-cat="${cat}"]`);
      if (await chip.count()) await chip.click();
      else console.warn(`unknown category "${cat}" — skipping`);
    }
    for (const word of CUSTOM_WORDS) {
      await page.fill('#imp-ownword-input', word);
      await page.click('#imp-ownword-add');
    }
    await page.click('#imp-categories-toggle');
  }

  if (SPECIAL_ROLES.length) {
    // The roles list lives in a collapsed callout — open it before checking.
    await page.click('#imp-roles-toggle');
    for (const role of SPECIAL_ROLES) {
      const id = ROLE_CHECKBOX[role.toLowerCase()];
      if (!id) { console.warn(`unknown role "${role}" — skipping`); continue; }
      await page.check(`#${id}`);
    }
  }
  await page.click('#imp-settings-confirm-btn');

  await page.fill('#imp-create-name', name);
  await page.click('#imp-create-submit');
  await page.waitForSelector('#screen-imp-lobby.active', { timeout: 5000 });
  const code = (await page.textContent('#imp-lobby-code')).trim();
  console.log(`[${name}] created room ${code}`);
  return code;
}

async function joinRoom(bot, code) {
  const { page, name } = bot;
  await page.click('#imp-btn-join-screen');
  await page.fill('#imp-join-code', code);
  await page.fill('#imp-join-name', name);
  await page.click('#imp-join-submit');
  await page.waitForSelector('#screen-imp-lobby.active', { timeout: 5000 });
  console.log(`[${name}] joined room ${code}`);
}

async function readyUp(bot) {
  const { page, name } = bot;
  const btn = page.locator('#imp-ready-btn');
  await btn.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    console.log(`[${name}] readied up`);
  }
}

// Flip the placard, memorize the card, then walk into the game screen.
async function revealCard(bot) {
  const { page, name } = bot;
  await page.click('#imp-placard');
  await page.waitForSelector('#imp-role-card .imp-card-role', { timeout: 5000 });

  bot.card.role = (await page.textContent('#imp-role-card .imp-card-role').catch(() => ''))?.trim() || null;
  const wordEl = page.locator('#imp-role-card .imp-card-word');
  bot.card.word = await wordEl.count() ? (await wordEl.textContent()).trim() : null;
  const catEl = page.locator('#imp-role-card .imp-card-category');
  if (await catEl.count()) {
    bot.card.category = (await catEl.textContent()).replace(/^\s*Category:\s*/i, '').trim();
  }

  console.log(`[${name}] is ${bot.card.role}${bot.card.word ? ` — word: ${bot.card.word}` : ' — no word'}`);
  await page.click('#imp-card-close').catch(() => {});
  await page.click('#imp-to-game-btn');
  bot.revealed = true;
}

// Small greedy autoplay loop — enough to drive a full game without babysitting.
async function autoplayLoop(bot, shared) {
  const { page, name } = bot;

  while (shared.alive) {
    await sleep(POLL_MS);

    if (!bot.revealed && await page.locator('#screen-imp-placard.active').count()) {
      await revealCard(bot).catch(err => console.warn(`[${name}] reveal failed: ${err.message}`));
      continue;
    }

    if (!await page.locator('#screen-imp-game.active').count()) continue;

    // Clue — only rendered when it's this bot's turn
    const clueInput = page.locator('#imp-clue-input');
    if (await clueInput.count() && await clueInput.isVisible().catch(() => false)) {
      const state = {
        usedClues: await page.locator('.imp-clue-text').allTextContents().catch(() => []),
        category: (await page.locator('.imp-header-cat').textContent().catch(() => '') || '').replace(/^📁\s*/, '').trim(),
      };
      const clue = makeClue(bot, state);
      await clueInput.fill(clue);
      await page.click('#imp-clue-submit').catch(() => {});
      console.log(`[${name}] clue: "${clue}"`);
      continue;
    }

    // Discussion — host bot holds the phase open so you have time to read
    const startVote = page.locator('#imp-start-vote-btn');
    if (await startVote.count() && await startVote.isVisible().catch(() => false)) {
      if (DISCUSSION_SECS > 0) {
        console.log(`[${name}] discussion — starting the vote in ${DISCUSSION_SECS}s`);
        await sleep(DISCUSSION_SECS * 1000);
      }
      await startVote.click().catch(() => {});
      continue;
    }

    // Vote — random candidate
    const voteSubmit = page.locator('#imp-vote-submit');
    if (await voteSubmit.count() && await voteSubmit.isVisible().catch(() => false)) {
      const picks = page.locator('.imp-vote-pick');
      const n = await picks.count();
      if (n > 0) {
        await picks.nth(Math.floor(Math.random() * n)).click().catch(() => {});
        if (await voteSubmit.isEnabled().catch(() => false)) {
          await voteSubmit.click().catch(() => {});
          console.log(`[${name}] voted`);
        }
      }
      continue;
    }

    // Caught imposter's final guess
    const guessInput = page.locator('#imp-guess-input');
    if (await guessInput.count() && await guessInput.isVisible().catch(() => false)) {
      const state = { category: (await page.locator('.imp-header-cat').textContent().catch(() => '') || '').replace(/^📁\s*/, '').trim() };
      const guess = guessWord(bot, state);
      await guessInput.fill(guess);
      await page.click('#imp-guess-submit').catch(() => {});
      console.log(`[${name}] final guess: "${guess}"`);
      continue;
    }

    // Game over — report once, then shut the run down as soon as every bot has
    // seen it. Your own browser stays on the reveal; only the bots close.
    const over = page.locator('.go-title');
    if (await over.count() && !bot.reportedResult) {
      bot.reportedResult = true;
      const title = (await over.textContent().catch(() => '')).trim();
      const word  = (await page.locator('.imp-word-reveal').textContent().catch(() => '')).trim();
      console.log(`[${name}] game over — ${title} | ${word}`);

      // Two bots can reach the last report in the same tick — only announce once.
      if (!shared.gameOver && shared.bots.every(b => b.reportedResult)) {
        console.log('\nGame over — closing bot browsers. Your browser stays open on the reveal.');
        shared.gameOver = true;
        shared.alive = false;
      }
    }
  }
}

/**
 * `announce` emits leave-game/leave-lobby so a mid-game exit frees the seats.
 * It must be skipped once the game is over: leave-game still fires while
 * room.state is 'playing' (only the phase is 'game-over'), which would mark the
 * bots disconnected and throw a "waiting to reconnect" pause overlay across
 * your reveal screen. A plain disconnect is ignored at game-over, so closing
 * the browser quietly is the correct teardown there.
 */
async function cleanupBot(bot, { announce = true } = {}) {
  const { page, name, browser } = bot;
  if (announce) {
    try {
      await page.evaluate(() => {
        if (typeof socket !== 'undefined') {
          socket.emit('imp:leave-game');
          socket.emit('imp:leave-lobby');
        }
      });
    } catch { /* page may already be closed */ }
  }
  await browser.close().catch(() => {});
  console.log(`[${name}] closed`);
}

// ── Main ──────────────────────────────────────────────────────────────────
(async () => {
  console.log(`Spawning ${BOT_COUNT} Imposter bot(s) against ${BASE_URL}, leaving ${SEATS_FOR_YOU} seat(s) for you.`);

  const shared = { alive: true, gameOver: false, bots: [] };
  const bots = shared.bots;
  for (let i = 0; i < BOT_COUNT; i++) {
    bots.push(await launchBot(BOT_NAMES[i] || `Bot-${i + 1}`, i));
    console.log(`Launched bot ${i + 1}/${BOT_COUNT}`);
  }

  const host = bots[0];
  const code = await createRoom(host);

  for (let i = 1; i < bots.length; i++) await joinRoom(bots[i], code);

  // This URL drops you straight on the join screen with the code already in —
  // no picking the game, no retyping a code full of look-alike characters.
  console.log(`\nJOIN URL: ${BASE_URL}/?imp=${code}`);
  console.log(`ROOM CODE: ${code}\n`);

  process.on('SIGINT', () => { shared.alive = false; });

  if (SEATS_FOR_YOU === 0) {
    for (const bot of bots) await readyUp(bot);
  } else {
    console.log('Waiting for you to join before bots ready up... (checking every 3s)');
    while (shared.alive) {
      const joined = await host.page.locator('.lobby-player').count();
      if (joined >= PLAYER_COUNT) break;
      await sleep(1000);
    }
    for (const bot of bots) await readyUp(bot);
  }

  console.log('Bots are now autoplaying. Press Ctrl+C to stop and clean up.\n');
  await Promise.all(bots.map(bot => autoplayLoop(bot, shared)));

  for (const bot of bots) await cleanupBot(bot, { announce: !shared.gameOver });
  process.exit(0);
})().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
