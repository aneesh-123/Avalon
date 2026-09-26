/**
 * spawn-bots.js — Launches headed Playwright browser bots that create a room,
 * join it, ready up, and play through the game with simple randomized choices
 * (good bots always pass quests; evil bots randomly fail). One seat is left
 * open for you to join and play alongside them.
 *
 * Usage:
 *   node scripts/spawn-bots.js [--players=5] [--url=http://localhost:3000] [--seats-for-you=1]
 *                               [--manual=1] [--team-vote-delay=10]
 *
 * Ctrl+C to stop — bots will leave the game/lobby cleanly before closing.
 */

const { chromium } = require('playwright');

// ── Args ──────────────────────────────────────────────────────────────────
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));

const PLAYER_COUNT   = parseInt(args.players || '5', 10);
const BASE_URL        = args.url || 'http://localhost:3000';
const SEATS_FOR_YOU   = parseInt(args['seats-for-you'] || '1', 10);
const BOT_COUNT       = PLAYER_COUNT - SEATS_FOR_YOU;
const NIGHT_ROUND     = args['night-round'] === '1' || args['night-round'] === true;
const EVIL_TARGET     = args.evil ? parseInt(args.evil, 10) : null;
const SPECIAL_ROLES   = args.roles ? String(args.roles).split(',').filter(Boolean) : [];
// Manual mode: set the game up, then keep hands off so every window is yours to
// drive. Nothing autoplays.
const MANUAL          = args.manual === '1' || args.manual === true;
// Seconds the bots hold off before voting on a proposed team. Zero by default.
// Useful when a human is the leader and wants time to actually use the
// "Change proposal" window, which closes the instant anyone else votes.
const TEAM_VOTE_DELAY = parseFloat(args['team-vote-delay'] || '0');
const BOT_NAMES       = ['Bot-Alice', 'Bot-Bob', 'Bot-Carol', 'Bot-Dave', 'Bot-Eve', 'Bot-Finn', 'Bot-Gwen', 'Bot-Hank', 'Bot-Ivy', 'Bot-Jack'];

// The game itself enforces a floor of 5 players (see #pc-minus disabled at n<=5
// in client.js) — clicking pc-minus below that hangs forever since it's disabled.
const MIN_PLAYERS = 5;
if (PLAYER_COUNT < MIN_PLAYERS) {
  console.error(`--players=${PLAYER_COUNT} is below the game's minimum of ${MIN_PLAYERS}.`);
  process.exit(1);
}
if (BOT_COUNT < 1) {
  console.error(`Need at least 1 bot: players=${PLAYER_COUNT} minus seats-for-you=${SEATS_FOR_YOU} leaves ${BOT_COUNT}.`);
  process.exit(1);
}

// ── Window tiling so all bot windows are visible at once ───────────────────
const SCREEN_W = 1920, SCREEN_H = 1080;
const cols = Math.ceil(Math.sqrt(BOT_COUNT));
const rows = Math.ceil(BOT_COUNT / cols);
const winW = Math.floor(SCREEN_W / cols);
const winH = Math.floor(SCREEN_H / rows);

function windowPosition(i) {
  const col = i % cols, row = Math.floor(i / cols);
  return { x: col * winW, y: row * winH, width: winW, height: winH };
}

// ── Helpers ──────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const HEADLESS = process.env.BOTS_HEADLESS === '1';

async function launchBot(name, index) {
  const pos = windowPosition(index);
  const launchOpts = {
    headless: HEADLESS,
    args: [`--window-position=${pos.x},${pos.y}`, `--window-size=${pos.width},${pos.height}`],
  };
  // Sandboxed CI/dev-container environments ship the full chromium binary
  // but not chrome-headless-shell — force the full binary + no-sandbox there.
  if (HEADLESS && process.env.BOTS_CHROMIUM_PATH) {
    launchOpts.executablePath = process.env.BOTS_CHROMIUM_PATH;
    launchOpts.args.push('--no-sandbox');
  }
  const browser = await chromium.launch(launchOpts);
  const context = await browser.newContext({ viewport: { width: pos.width, height: pos.height - 90 } });
  const page = await context.newPage();
  await page.goto(BASE_URL);
  await enterAvalon(page);
  return { name, browser, context, page };
}

// The app opens on the game picker, so every bot has to choose Avalon before
// the home screen's Create/Join buttons exist. Tolerates the picker being
// absent so the script still works if the opening screen changes again.
async function enterAvalon(page) {
  const picker = page.locator('#screen-picker.active');
  if (await picker.count() === 0) return;
  await page.click('#pick-avalon');
  await page.waitForSelector('#screen-home.active', { timeout: 5000 });
}

async function createRoom(bot, playerCount) {
  const { page, name } = bot;
  await page.click('#btn-create');
  // Bump player count to target
  const currentText = await page.textContent('#pc-value');
  let current = parseInt(currentText, 10);
  while (current < playerCount) { await page.click('#pc-plus'); current++; }
  while (current > playerCount) { await page.click('#pc-minus'); current--; }
  await page.click('#pc-confirm-btn');
  if (EVIL_TARGET) {
    let evil = parseInt(await page.textContent('#evil-count'), 10);
    while (evil < EVIL_TARGET) { await page.click('#evil-plus'); evil++; }
    while (evil > EVIL_TARGET) { await page.click('#evil-minus'); evil--; }
  }
  await page.click('#split-confirm-btn');
  // Toggle on requested special roles (Merlin and Assassin are always in).
  // Each click re-renders the picker, so query fresh per role.
  for (const role of SPECIAL_ROLES) {
    await page.click(`.rc2-circle[data-role="${role}"]`);
  }
  await page.click('#roles-confirm-btn');
  if (NIGHT_ROUND) await page.check('#night-round-checkbox');
  await page.fill('#create-name-input', name);
  await page.click('#create-submit-btn');
  await page.waitForSelector('#screen-lobby.active', { timeout: 5000 });
  const code = (await page.textContent('#lobby-code')).trim();
  console.log(`[${name}] created room ${code}`);
  return code;
}

async function joinRoom(bot, code) {
  const { page, name } = bot;
  await page.click('#btn-join-screen');
  await page.fill('#join-code-input', code);
  await page.fill('#join-name-input', name);
  await page.click('#join-submit-btn');
  await page.waitForSelector('#screen-lobby.active', { timeout: 5000 });
  console.log(`[${name}] joined room ${code}`);
}

async function readyUp(bot) {
  const { page, name } = bot;
  await page.waitForSelector('#ready-btn:not([style*="display: none"])', { timeout: 15000 }).catch(() => {});
  const btn = page.locator('#ready-btn');
  if (await btn.isVisible()) {
    await btn.click();
    console.log(`[${name}] readied up`);
  }
}

// Very small, greedy autoplay loop — good enough to push a game to completion
// so you can observe the feature you're testing without babysitting every bot.
async function autoplayLoop(bot) {
  const { name } = bot;
  let alive = true;
  process.on('SIGINT', () => { alive = false; });

  while (alive) {
    await sleep(600 + Math.random() * 600);
    try {
      await takeTurn(bot);
    } catch (err) {
      const msg = (err && err.message) || String(err);
      // A closed window is the normal way a bot leaves — someone shut it, or
      // the machine slept. That bot is simply out; the others keep playing.
      // Letting this reject used to take the whole table down mid-game.
      if (bot.page.isClosed?.() || /closed|crashed|Target/i.test(msg)) {
        console.log(`[${name}] window is gone — dropping this bot, the rest play on`);
        bot.gone = true;
        return;
      }
      console.log(`[${name}] recovered from: ${msg.replace(/\s+/g, ' ').slice(0, 120)}`);
    }
  }
}

async function takeTurn(bot) {
  const { page, name } = bot;
  {
    const onGame = await page.locator('#screen-game.active').count();
    if (!onGame) return;

    // Night round — if this bot is the narrator (starting leader), dismiss the
    // script after a pause so the phase doesn't stall waiting on a bot.
    const nightRoundBtn = page.locator('#night-round-continue-btn');
    if (await nightRoundBtn.count() && await nightRoundBtn.isVisible()) {
      await sleep(8000); // leave the script on screen long enough to read
      await nightRoundBtn.click().catch(() => {});
      console.log(`[${name}] finished the night round script`);
    }

    // Team select — propose a random valid team if this bot is leader
    const teamBtn = page.locator('#submit-team-btn');
    if (await teamBtn.count() && await teamBtn.isEnabled().catch(() => false) === false) {
      const rows = page.locator('#player-pick-list .pick-player');
      const total = await rows.count();
      const needMatch = (await page.locator('.phase-sub strong').first().textContent().catch(() => '')) || '';
      const need = parseInt(needMatch, 10) || 2;
      for (let i = 0; i < total && i < need; i++) await rows.nth(i).click();
      if (await teamBtn.isEnabled().catch(() => false)) {
        await teamBtn.click();
        console.log(`[${name}] proposed a team`);
      }
    }

    // Occasionally call for a shot clock, so a stall actually gets pushed along.
    //
    // Only ever call it once. The clock is a toggle — a second tap withdraws —
    // and the button is now permanently on screen rather than opt-in, so
    // rolling the dice every poll had four bots calling and withdrawing several
    // times a second. That buried the log and meant the clock never actually
    // reached its threshold. `is-on` is the button's own "you have called this"
    // state, so it is the honest thing to check.
    const callClock = page.locator('#gs-call-clock');
    if (await callClock.count() && Math.random() < 0.08) {
      const alreadyCalled = await callClock.evaluate(el => el.classList.contains('is-on')).catch(() => true);
      if (!alreadyCalled) {
        await callClock.click().catch(() => {});
        console.log(`[${name}] called for a shot clock`);
      }
    }

    // Team vote — approve most of the time
    const approveBtn = page.locator('#btn-approve');
    if (await approveBtn.count() && await approveBtn.isVisible()) {
      let ready = true;
      if (TEAM_VOTE_DELAY > 0) {
        // Hold off on each new proposal, so a human leader has room to change
        // their mind before the first vote locks the team in.
        const key = await page.locator('.proposed-team').innerText().catch(() => '');
        if (bot.voteKey !== key) { bot.voteKey = key; bot.voteAt = Date.now() + TEAM_VOTE_DELAY * 1000; }
        ready = Date.now() >= bot.voteAt;
      }
      if (ready) {
        const vote = Math.random() < 0.8 ? '#btn-approve' : '#btn-reject';
        await page.click(vote).catch(() => {});
        console.log(`[${name}] voted on team`);
      }
    }

    // Quest vote — evil bots fail ~40% of the time, everyone else passes.
    //
    // Pick only from the cards this role may actually play. Both buttons are
    // always rendered; the ones the role cannot use are disabled (good players
    // cannot fail, the Lunatic cannot pass, the Brute cannot fail after quest
    // three). Clicking a disabled button just waits for it to become enabled
    // and then times out, so choosing blindly used to cost 30s a turn and skip
    // the vote entirely.
    const passBtn = page.locator('#qbtn-pass');
    if (await passBtn.count() && await passBtn.isVisible()) {
      const failBtn = page.locator('#qbtn-fail');
      const canPass = await passBtn.isEnabled().catch(() => false);
      const canFail = (await failBtn.count()) ? await failBtn.isEnabled().catch(() => false) : false;
      const choice =
        canFail && (!canPass || Math.random() < 0.4) ? failBtn :
        canPass ? passBtn :
        null;
      if (choice) {
        await choice.click({ timeout: 3000 }).catch(() => {});
        console.log(`[${name}] cast quest vote`);
      } else {
        console.log(`[${name}] has no legal quest card — not voting`);
      }
    }

    // Reveal quest outcome if this bot is leader and everyone has voted
    const revealBtn = page.locator('#reveal-quest-btn');
    if (await revealBtn.count() && await revealBtn.isVisible()) {
      await revealBtn.click().catch(() => {});
    }

    // Continue past result overlays
    const continueBtn = page.locator('#result-continue-btn');
    if (await continueBtn.count() && await continueBtn.isVisible()) {
      await continueBtn.click().catch(() => {});
    }

    // Begin-game / continue-to-game button on placard screen
    const beginBtn = page.locator('#begin-game-btn');
    if (await beginBtn.count() && await beginBtn.isVisible()) {
      await beginBtn.click().catch(() => {});
    }

    // Assassination — random guess
    const assassinateBtn = page.locator('#submit-assassinate-btn');
    if (await assassinateBtn.count() && await assassinateBtn.isVisible()) {
      const targets = page.locator('#player-pick-list .pick-player');
      const n = await targets.count();
      if (n > 0) {
        await targets.nth(Math.floor(Math.random() * n)).click();
        await assassinateBtn.click().catch(() => {});
        console.log(`[${name}] assassinated a guess`);
      }
    }
  }
}

async function cleanupBot(bot) {
  const { page, name, browser } = bot;
  try {
    await page.evaluate(() => {
      if (typeof socket !== 'undefined') {
        socket.emit('leave-game');
        socket.emit('leave-lobby');
      }
    });
  } catch { /* page may already be closed */ }
  await browser.close().catch(() => {});
  console.log(`[${name}] cleaned up`);
}

// ── Main ─────────────────────────────────────────────────────────────────
(async () => {
  console.log(`Spawning ${BOT_COUNT} bot(s) against ${BASE_URL}, leaving ${SEATS_FOR_YOU} seat(s) for you.`);

  const bots = [];
  for (let i = 0; i < BOT_COUNT; i++) {
    bots.push(await launchBot(BOT_NAMES[i] || `Bot-${i + 1}`, i));
    console.log(`Launched bot ${i + 1}/${BOT_COUNT}`);
  }

  const host = bots[0];
  const code = await createRoom(host, PLAYER_COUNT);

  for (let i = 1; i < bots.length; i++) {
    await joinRoom(bots[i], code);
  }

  console.log(`\n➡  Open ${BASE_URL} yourself and join room ${code} to play alongside the bots.\n`);

  // Ready up bots once you've joined too (or immediately if seats-for-you is 0)
  if (SEATS_FOR_YOU === 0) {
    for (const bot of bots) await readyUp(bot);
  } else {
    console.log(`Waiting for you to join before bots ready up... (checking every 3s)`);
    // Poll host's lobby list length until full, then ready everyone up.
    while (true) {
      const joined = await host.page.locator('.lobby-player').count();
      if (joined >= PLAYER_COUNT) break;
      await sleep(3000);
    }
    for (const bot of bots) await readyUp(bot);
  }

  if (!MANUAL) console.log('Bots are now autoplaying. Press Ctrl+C to stop and clean up.\n');
  if (MANUAL) {
    console.log('\nManual mode — nothing is autoplaying. Every window is yours.');
    console.log('Each window is a separate player; click through them however you like.');
    console.log('Ctrl+C here closes them all.\n');
    await new Promise(() => {});          // hold the browsers open indefinitely
  }

  await Promise.all(bots.map(autoplayLoop));

  // Reached only after SIGINT breaks all autoplay loops
  for (const bot of bots) await cleanupBot(bot);
  process.exit(0);
})().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
