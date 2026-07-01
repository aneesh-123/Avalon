/**
 * spawn-bots.js — Launches headed Playwright browser bots that create a room,
 * join it, ready up, and play through the game with simple randomized choices
 * (good bots always pass quests; evil bots randomly fail). One seat is left
 * open for you to join and play alongside them.
 *
 * Usage:
 *   node scripts/spawn-bots.js [--players=5] [--url=http://localhost:3000] [--seats-for-you=1]
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
  return { name, browser, context, page };
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
  await page.click('#split-confirm-btn');
  await page.click('#roles-confirm-btn');
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
  const { page, name } = bot;
  let alive = true;
  process.on('SIGINT', () => { alive = false; });

  while (alive) {
    await sleep(600 + Math.random() * 600);

    const onGame = await page.locator('#screen-game.active').count();
    if (!onGame) continue;

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

    // Team vote — approve most of the time
    const approveBtn = page.locator('#btn-approve');
    if (await approveBtn.count() && await approveBtn.isVisible()) {
      const vote = Math.random() < 0.8 ? '#btn-approve' : '#btn-reject';
      await page.click(vote).catch(() => {});
      console.log(`[${name}] voted on team`);
    }

    // Quest vote — good bots always pass; evil bots fail ~40% of the time
    const passBtn = page.locator('#qbtn-pass');
    if (await passBtn.count() && await passBtn.isVisible()) {
      const failBtn = page.locator('#qbtn-fail');
      const isEvilChoice = (await failBtn.count()) && Math.random() < 0.4;
      await (isEvilChoice ? failBtn : passBtn).click().catch(() => {});
      console.log(`[${name}] cast quest vote`);
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

  console.log('Bots are now autoplaying. Press Ctrl+C to stop and clean up.\n');
  await Promise.all(bots.map(autoplayLoop));

  // Reached only after SIGINT breaks all autoplay loops
  for (const bot of bots) await cleanupBot(bot);
  process.exit(0);
})().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
