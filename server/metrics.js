// Site metrics and player feedback, for the owner's /admin page.
//
// Three kinds of event are recorded: a page visit (sent by public/site.js on
// load), a game started and a game finished (seen by observeRoom, which
// db.saveRoom calls on every save). Feedback is stored separately.
//
// Everything goes to two Supabase tables (see supabase/site-metrics.sql) when
// SUPABASE_URL is set. A copy of recent rows is also kept in memory, so the
// admin page still shows something when the tables are missing or the
// database is unreachable, and so tests never touch the network.
//
// This file must not require server/db.js: the jest suites mock that module,
// and CI has no .env (see CLAUDE.md). The Supabase client here is created
// lazily, only when a write or read actually happens outside of jest.

const MEMORY_CAP = 5000;
const memory = { events: [], feedback: [] };

let client;   // undefined = not tried yet, null = unavailable
function supabase() {
  if (client !== undefined) return client;
  client = null;
  if (process.env.JEST_WORKER_ID || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return client;
  try {
    const { createClient } = require('@supabase/supabase-js');
    const { ProxyAgent, fetch: undiciFetch } = require('undici');
    const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
    const fetchWithProxy = proxyUrl
      ? (url, opts = {}) => undiciFetch(url, { ...opts, dispatcher: new ProxyAgent(proxyUrl) })
      : undiciFetch;
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY,
      { global: { fetch: fetchWithProxy } });
  } catch (e) {
    console.error('[metrics] no database client:', e.message);
  }
  return client;
}

function remember(list, row) {
  list.push(row);
  if (list.length > MEMORY_CAP) list.splice(0, list.length - MEMORY_CAP);
}

// Logs a failed insert once per table, so a missing table (setup SQL not run
// yet) doesn't flood the server log on every visit.
const warned = new Set();
function insert(table, row) {
  const db = supabase();
  if (!db) return;
  const fail = msg => {
    if (warned.has(table)) return;
    warned.add(table);
    console.error(`[metrics] ${table} insert failed (run supabase/site-metrics.sql?):`, msg);
  };
  db.from(table).insert(row).then(({ error }) => { if (error) fail(error.message); }, e => fail(e.message));
}

function record(kind, game, visitor, data) {
  const row = { at: new Date().toISOString(), kind, game: game || null, visitor: visitor || null, data: data || {} };
  remember(memory.events, row);
  insert('site_events', row);
}

const GAMES = ['avalon', 'imposter', 'trivia'];
const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// ── Visits ──
const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|preview|monitor/i;

function deviceOf(ua) {
  if (/ipad|tablet/i.test(ua)) return 'tablet';
  if (/mobi|iphone|android/i.test(ua)) return 'phone';
  return 'computer';
}

// Where a visitor came from, as a bare host ("google.com"), or "direct".
function sourceOf(ref, ownHost) {
  try {
    const host = new URL(ref).hostname.replace(/^www\./, '');
    if (!host || host === ownHost) return 'direct';
    return host;
  } catch { return 'direct'; }
}

function recordVisit({ visitor, page, ref, ua, host }) {
  if (!ua || BOT_UA.test(ua)) return false;
  const vid = clean(visitor, 40);
  if (!/^[a-z0-9-]{8,40}$/i.test(vid)) return false;
  const p = clean(page, 40) || '/';
  record('visit', null, vid, {
    page: p,
    source: sourceOf(clean(ref, 300), (host || '').replace(/^www\./, '').split(':')[0]),
    device: deviceOf(ua),
  });
  return true;
}

// ── Games ──
// Every game marks a running game with state 'playing' and an ended one with
// phase 'game-over'. Flags on the room itself (saved with it) make each start
// and finish count once, even across a server restart.
function observeRoom(room) {
  if (!room || typeof room !== 'object') return;
  const game = room.gameType || 'avalon';
  if (room.state === 'playing') {
    if (!room.metricStarted) {
      room.metricStarted = true;
      record('game_start', game, null, { players: (room.players || []).length });
    }
    if (room.phase === 'game-over' && !room.metricFinished) {
      room.metricFinished = true;
      record('game_end', game, null, { players: (room.players || []).length });
    }
  } else {
    room.metricStarted = false;
    room.metricFinished = false;
  }
}

// ── Feedback ──
function recordFeedback({ message, rating, game, contact, visitor, ua }) {
  const text = clean(message, 2000);
  if (text.length < 2) return { ok: false, error: 'Write a little more.' };
  const row = {
    at: new Date().toISOString(),
    message: text,
    rating: ['up', 'down'].includes(rating) ? rating : null,
    game: GAMES.includes(game) ? game : null,
    contact: clean(contact, 120) || null,
    visitor: clean(visitor, 40) || null,
    device: deviceOf(ua || ''),
  };
  remember(memory.feedback, row);
  insert('site_feedback', row);
  return { ok: true };
}

// ── Stats for /admin ──
const DAY = 24 * 60 * 60 * 1000;
const dayKey = iso => iso.slice(0, 10);

function summarize(events, feedback, now = Date.now(), days = 30) {
  const since = now - days * DAY;
  const recent = events.filter(e => Date.parse(e.at) >= since);
  const daily = {};
  for (let i = days - 1; i >= 0; i--) {
    daily[dayKey(new Date(now - i * DAY).toISOString())] =
      { visits: 0, visitors: new Set(), started: 0, finished: 0 };
  }
  const games = Object.fromEntries(GAMES.map(g => [g, { started: 0, finished: 0, players: 0 }]));
  const sources = {}, devices = {}, pages = {};
  const visitors = new Set();
  for (const e of recent) {
    const d = daily[dayKey(e.at)];
    if (e.kind === 'visit') {
      visitors.add(e.visitor);
      if (d) { d.visits++; d.visitors.add(e.visitor); }
      const s = e.data?.source || 'direct', dv = e.data?.device || 'computer', pg = e.data?.page || '/';
      sources[s] = (sources[s] || 0) + 1;
      devices[dv] = (devices[dv] || 0) + 1;
      pages[pg] = (pages[pg] || 0) + 1;
    } else if (e.kind === 'game_start' || e.kind === 'game_end') {
      const g = games[e.game] || (games[e.game] = { started: 0, finished: 0, players: 0 });
      if (e.kind === 'game_start') {
        g.started++; g.players += e.data?.players || 0;
        if (d) d.started++;
      } else {
        g.finished++;
        if (d) d.finished++;
      }
    }
  }
  const top = obj => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const today = daily[dayKey(new Date(now).toISOString())];
  return {
    days,
    totals: {
      visits: recent.filter(e => e.kind === 'visit').length,
      visitors: visitors.size,
      visitorsToday: today ? today.visitors.size : 0,
      gamesStarted: Object.values(games).reduce((n, g) => n + g.started, 0),
      gamesFinished: Object.values(games).reduce((n, g) => n + g.finished, 0),
      feedback: feedback.length,
    },
    daily: Object.entries(daily).map(([day, d]) =>
      ({ day, visits: d.visits, visitors: d.visitors.size, started: d.started, finished: d.finished })),
    games,
    sources: top(sources),
    devices: top(devices),
    pages: top(pages),
    feedback: feedback.slice().sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200),
  };
}

async function fetchAll(db, table, columns, sinceIso) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns)
      .gte('at', sinceIso).order('at', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 1000 || rows.length >= 100000) return rows;
  }
}

// Reads from the database when it can; otherwise from memory, and says so.
async function getStats(days = 30) {
  const db = supabase();
  if (db) {
    try {
      const sinceIso = new Date(Date.now() - days * DAY).toISOString();
      const [events, feedback] = await Promise.all([
        fetchAll(db, 'site_events', 'at,kind,game,visitor,data', sinceIso),
        fetchAll(db, 'site_feedback', 'at,message,rating,game,contact,device', new Date(0).toISOString()),
      ]);
      return { source: 'database', ...summarize(events, feedback, Date.now(), days) };
    } catch (e) {
      return { source: 'memory', warning: `Database read failed: ${e.message}`,
        ...summarize(memory.events, memory.feedback, Date.now(), days) };
    }
  }
  return { source: 'memory', warning: 'No database configured, so these numbers only cover the time since the server last started.',
    ...summarize(memory.events, memory.feedback, Date.now(), days) };
}

module.exports = { recordVisit, observeRoom, recordFeedback, getStats, summarize, sourceOf, deviceOf, _memory: memory };
