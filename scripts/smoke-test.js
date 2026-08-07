/**
 * smoke-test.js — Boots the real server and checks it actually serves the app.
 *
 * The jest suites mock the database and never start Express or Socket.IO, so
 * they cannot catch a server that fails to boot, a missing static asset, or a
 * broken require chain. This closes that gap: it is the cheapest test that
 * proves "the app comes up and serves Avalon".
 *
 * Usage:  node scripts/smoke-test.js [--port=4123] [--timeout=20000]
 *
 * Supabase creds are NOT required — db.js throws at import without them, so a
 * dummy unreachable URL is injected when none is set. loadRooms() then fails
 * harmlessly inside server.js's try/catch and the server still listens.
 */

const { spawn } = require('child_process');
const path = require('path');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));

const PORT      = parseInt(args.port || '4123', 10);
const TIMEOUT   = parseInt(args.timeout || '20000', 10);
const ROOT      = path.join(__dirname, '..');
const BASE      = `http://127.0.0.1:${PORT}`;

// Assets that must be reachable for the Avalon client to work at all.
const REQUIRED_ASSETS = [
  { path: '/',                      contains: '<div id="screen-home"' },
  { path: '/client.js',             contains: 'socket' },
  { path: '/style.css',             contains: '.screen.active' },
  { path: '/socket.io/socket.io.js', contains: 'socket.io' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

let server;
const logs = [];

function startServer() {
  server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      // db.js calls createClient() at import time and throws on a missing URL.
      SUPABASE_URL:         process.env.SUPABASE_URL         || 'http://127.0.0.1:9',
      SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY || 'smoke-test-dummy-key',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', d => logs.push(d.toString()));
  server.stderr.on('data', d => logs.push(d.toString()));
  server.on('exit', code => {
    if (code !== null && code !== 0) logs.push(`\n[server exited early with code ${code}]`);
  });
}

async function waitForPing() {
  const deadline = Date.now() + TIMEOUT;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`server process exited (code ${server.exitCode}) before it started listening`);
    try {
      const res = await fetch(`${BASE}/ping`);
      if (res.ok && (await res.text()).trim() === 'ok') return;
    } catch { /* not listening yet */ }
    await sleep(250);
  }
  throw new Error(`server did not respond on ${BASE}/ping within ${TIMEOUT}ms`);
}

async function checkAssets() {
  for (const asset of REQUIRED_ASSETS) {
    const res = await fetch(BASE + asset.path);
    if (!res.ok) throw new Error(`GET ${asset.path} returned ${res.status}`);
    const body = await res.text();
    if (!body.includes(asset.contains)) {
      throw new Error(`GET ${asset.path} did not contain expected marker "${asset.contains}"`);
    }
    console.log(`  ok  ${asset.path}`);
  }
}

function stopServer() {
  if (!server || server.exitCode !== null) return;
  // Kill the whole tree so no stray listener holds the port in CI.
  if (process.platform === 'win32') spawn('taskkill', ['/pid', server.pid, '/T', '/F'], { stdio: 'ignore' });
  else server.kill('SIGTERM');
}

(async () => {
  console.log(`Booting server on ${BASE} ...`);
  startServer();
  try {
    await waitForPing();
    console.log('Server is listening. Checking required assets:');
    await checkAssets();
    console.log('\nSmoke test PASSED');
    stopServer();
    process.exit(0);
  } catch (err) {
    console.error(`\nSmoke test FAILED: ${err.message}`);
    if (logs.length) console.error('\n--- server output ---\n' + logs.join(''));
    stopServer();
    process.exit(1);
  }
})();
