/**
 * spawn-botc-bots.js — Playwright bots that create a Blood on the Clocktower
 * room, join it, ready up, and play through with simple randomized choices,
 * leaving seats open for you.
 *
 * Usage:
 *   node scripts/spawn-botc-bots.js [--players=5] [--seats-for-you=1]
 *                                   [--day-seconds=45] [--url=http://localhost:3000]
 *
 * The bot who creates the room is the host, which means a bot controls the
 * "End the day" button. It deliberately waits --day-seconds before ending each
 * day so you have time to read the room and nominate. Raise it if you want
 * longer days; drop it to 10 if you're just smoke-testing the loop.
 *
 * Ctrl+C to stop — bots leave the game cleanly before closing.
 */

const { chromium } = require('playwright');

// ── Args ──────────────────────────────────────────────────────────────────
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));

const PLAYER_COUNT  = parseInt(args.players || '5', 10);
const BASE_URL      = args.url || 'http://localhost:3000';
const SEATS_FOR_YOU = parseInt(args['seats-for-you'] || '1', 10);
const DAY_SECONDS   = parseInt(args['day-seconds'] || '45', 10);
const BOT_COUNT     = PLAYER_COUNT - SEATS_FOR_YOU;
const BOT_NAMES     = ['Bot-Ada', 'Bot-Bo', 'Bot-Cy', 'Bot-Di', 'Bot-El', 'Bot-Fi', 'Bot-Gil', 'Bot-Hex'];

// Trouble Brewing's setup table runs 5–15.
const MIN_PLAYERS = 5, MAX_PLAYERS = 15;
if (PLAYER_COUNT < MIN_PLAYERS || PLAYER_COUNT > MAX_PLAYERS) {
  console.error(`--players=${PLAYER_COUNT} is outside Clocktower's supported range of ${MIN_PLAYERS}-${MAX_PLAYERS}.`);
  process.exit(1);
}
if (BOT_COUNT < 1) {
  console.error(`Need at least 1 bot: players=${PLAYER_COUNT} minus seats-for-you=${SEATS_FOR_YOU} leaves ${BOT_COUNT}.`);
  process.exit(1);
}

// ── Window tiling ─────────────────────────────────────────────────────────
const SCREEN_W = 1920, SCREEN_H = 1080;
const cols = Math.ceil(Math.sqrt(BOT_COUNT));
const rows = Math.ceil(BOT_COUNT / cols);
const winW = Math.floor(SCREEN_W / cols);
const winH = Math.floor(SCREEN_H / rows);
const windowPosition = i => ({
  x: (i % cols) * winW, y: Math.floor(i / cols) * winH, width: winW, height: winH,
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const HEADLESS = process.env.BOTS_HEADLESS === '1';

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
  await page.click('#pick-botc');
  await page.waitForSelector('#screen-botc-home.active', { timeout: 5000 });
  return { name, browser, context, page, isHost: index === 0 };
}

async function createRoom(bot, playerCount) {
  const { page, name } = bot;
  await page.click('#botc-btn-create-screen');
  let current = parseInt(await page.textContent('#botc-pc-value'), 10);
  while (current < playerCount) { await page.click('#botc-pc-plus');  current++; }
  while (current > playerCount) { await page.click('#botc-pc-minus'); current--; }
  await page.fill('#botc-create-name', name);
  await page.click('#botc-create-submit');
  await page.waitForSelector('#screen-botc-lobby.active', { timeout: 5000 });
  const code = (await page.textContent('#botc-lobby-code')).trim();
  console.log(`[${name}] created room ${code}`);
  return code;
}

async function joinRoom(bot, code) {
  const { page, name } = bot;
  await page.click('#botc-btn-join-screen');
  await page.fill('#botc-join-code', code);
  await page.fill('#botc-join-name', name);
  await page.click('#botc-join-submit');
  await page.waitForSelector('#screen-botc-lobby.active', { timeout: 5000 });
  console.log(`[${name}] joined room ${code}`);
}

async function readyUp(bot) {
  await bot.page.click('#botc-ready-btn').catch(() => {});
  console.log(`[${bot.name}] readied up`);
}

// Greedy autoplay — enough to push a game to its conclusion so you can watch
// the phases work without babysitting four browser windows.
async function autoplayLoop(bot) {
  const { page, name, isHost } = bot;
  let alive = true;
  process.on('SIGINT', () => { alive = false; });

  let dayEnteredAt = null;
  let nominatedThisDay = false;
  let lastPhaseLabel = '';
  let announcedOver = false;

  while (alive) {
    await sleep(700 + Math.random() * 700);
    if (!(await page.locator('#screen-botc-game.active').count())) continue;

    const phaseLabel = (await page.locator('.botc-phase-label').textContent().catch(() => '')) || '';
    if (phaseLabel !== lastPhaseLabel) {
      lastPhaseLabel = phaseLabel;
      dayEnteredAt = phaseLabel.startsWith('Day') ? Date.now() : null;
      nominatedThisDay = false;
    }
    if (phaseLabel === 'Game Over') {
      if (!announcedOver) { announcedOver = true; console.log(`[${name}] game over`); }
      await sleep(4000);
      continue;
    }
    announcedOver = false;

    // Night — a prompt only ever renders for the player it belongs to.
    const targets = page.locator('.botc-prompt .botc-target');
    const targetCount = await targets.count();
    if (targetCount > 0) {
      await sleep(1200);
      // The Fortune Teller picks two and confirms; everyone else picks one.
      const confirm = page.locator('#botc-confirm-picks');
      if (await confirm.count()) {
        const a = Math.floor(Math.random() * targetCount);
        let b = Math.floor(Math.random() * targetCount);
        if (b === a) b = (a + 1) % targetCount;
        await targets.nth(a).click().catch(() => {});
        await page.locator('.botc-prompt .botc-target').nth(b).click().catch(() => {});
        await page.locator('#botc-confirm-picks').click().catch(() => {});
        console.log(`[${name}] read two players' fortunes`);
      } else {
        await targets.nth(Math.floor(Math.random() * targetCount)).click().catch(() => {});
        console.log(`[${name}] acted in the night`);
      }
      continue;
    }

    // The Slayer takes their shot occasionally rather than sitting on it.
    const slayToggle = page.locator('#botc-slay-toggle');
    if (await slayToggle.count() && Math.random() < 0.25) {
      await slayToggle.click().catch(() => {});
      await sleep(400);
      const shots = page.locator('[data-slay]');
      const n = await shots.count();
      if (n > 0) {
        await shots.nth(Math.floor(Math.random() * n)).click().catch(() => {});
        console.log(`[${name}] claimed Slayer and took a shot`);
      }
      continue;
    }

    // Nomination vote — hands up more often than not.
    const yes = page.locator('#botc-vote-yes');
    if (await yes.count() && await yes.isVisible().catch(() => false)) {
      await sleep(900 + Math.random() * 1200);
      const btn = Math.random() < 0.55 ? '#botc-vote-yes' : '#botc-vote-no';
      await page.click(btn).catch(() => {});
      console.log(`[${name}] voted`);
      continue;
    }

    // Day — occasionally nominate, then (if host) close the day out.
    const noms = page.locator('.botc-target-grid [data-nominate]');
    const nomCount = await noms.count();
    if (nomCount > 0 && !nominatedThisDay && Math.random() < 0.5) {
      nominatedThisDay = true;
      await sleep(2500 + Math.random() * 3000);
      await noms.nth(Math.floor(Math.random() * nomCount)).click().catch(() => {});
      console.log(`[${name}] nominated someone`);
      continue;
    }

    if (isHost && dayEnteredAt && Date.now() - dayEnteredAt > DAY_SECONDS * 1000) {
      const endBtn = page.locator('#botc-end-day');
      if (await endBtn.count() && await endBtn.isVisible().catch(() => false)) {
        await endBtn.click().catch(() => {});
        console.log(`[${name}] ended the day`);
        dayEnteredAt = null;
      }
    }
  }
}

async function cleanupBot(bot) {
  try {
    await bot.page.evaluate(() => {
      if (typeof socket !== 'undefined') {
        socket.emit('botc:leave-game');
        socket.emit('botc:leave-lobby');
      }
    });
  } catch { /* page may already be closed */ }
  await bot.browser.close().catch(() => {});
  console.log(`[${bot.name}] cleaned up`);
}

// ── Main ──────────────────────────────────────────────────────────────────
(async () => {
  console.log(`Spawning ${BOT_COUNT} Clocktower bot(s) against ${BASE_URL}, leaving ${SEATS_FOR_YOU} seat(s) for you.`);
  console.log(`Days last ${DAY_SECONDS}s before the host bot ends them.\n`);

  const bots = [];
  for (let i = 0; i < BOT_COUNT; i++) {
    bots.push(await launchBot(BOT_NAMES[i] || `Bot-${i + 1}`, i));
    console.log(`Launched bot ${i + 1}/${BOT_COUNT}`);
  }

  const host = bots[0];
  const code = await createRoom(host, PLAYER_COUNT);
  for (let i = 1; i < bots.length; i++) await joinRoom(bots[i], code);

  console.log(`\n➡  Open ${BASE_URL}/?room=${code}&game=botc to take your seat.\n`);

  if (SEATS_FOR_YOU === 0) {
    for (const bot of bots) await readyUp(bot);
  } else {
    console.log('Waiting for you to join before bots ready up... (checking every 3s)');
    while (true) {
      const joined = await host.page.locator('.botc-lobby-row').count();
      if (joined >= PLAYER_COUNT) break;
      await sleep(3000);
    }
    for (const bot of bots) await readyUp(bot);
  }

  console.log('\nBots are autoplaying. Press Ctrl+C to stop and clean up.\n');
  await Promise.all(bots.map(autoplayLoop));

  for (const bot of bots) await cleanupBot(bot);
  process.exit(0);
})().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
