// Public-site routes and metrics: visits, feedback, games counted, /admin.

const http    = require('http');
const express = require('express');
const metrics = require('../server/metrics');
const { registerSiteRoutes } = require('../server/site');

const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1';

let server, base;
beforeAll(done => {
  const app = express();
  registerSiteRoutes(app);
  server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; done(); });
});
afterAll(done => { server.close(done); });
beforeEach(() => {
  metrics._memory.events.length = 0;
  metrics._memory.feedback.length = 0;
  delete process.env.ADMIN_PASSWORD;
});

function req(method, path, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(base + path, { method, headers: { 'user-agent': PHONE_UA, ...headers } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('error', reject);
    if (body !== undefined) {
      r.setHeader('content-type', 'application/json');
      r.end(JSON.stringify(body));
    } else r.end();
  });
}
const basic = pw => ({ authorization: 'Basic ' + Buffer.from('admin:' + pw).toString('base64') });

describe('visits', () => {
  test('records a visit with source and device', async () => {
    const res = await req('POST', '/api/visit', { body: { visitor: 'abcdef12-3456', page: '/avalon', ref: 'https://www.google.com/search?q=avalon' } });
    expect(res.status).toBe(204);
    expect(metrics._memory.events).toHaveLength(1);
    expect(metrics._memory.events[0]).toMatchObject({ kind: 'visit', visitor: 'abcdef12-3456',
      data: { page: '/avalon', source: 'google.com', device: 'phone' } });
  });

  test('ignores bots and malformed visitor ids', async () => {
    await req('POST', '/api/visit', { body: { visitor: 'abcdef12-3456' }, headers: { 'user-agent': 'Googlebot/2.1' } });
    await req('POST', '/api/visit', { body: { visitor: '<script>' } });
    await req('POST', '/api/visit', { body: 'not json' });
    expect(metrics._memory.events).toHaveLength(0);
  });

  test('a link from the site itself counts as direct', () => {
    expect(metrics.sourceOf('https://gamenight.example/avalon', 'gamenight.example')).toBe('direct');
    expect(metrics.sourceOf('', 'x')).toBe('direct');
  });
});

describe('feedback', () => {
  test('stores a message', async () => {
    const res = await req('POST', '/api/feedback', { body: { message: 'Love it', rating: 'up', game: 'avalon', contact: 'a@b.co' } });
    expect(res.status).toBe(200);
    expect(metrics._memory.feedback[0]).toMatchObject({ message: 'Love it', rating: 'up', game: 'avalon', contact: 'a@b.co', device: 'phone' });
  });

  test('rejects an empty message and drops unknown fields', async () => {
    const empty = await req('POST', '/api/feedback', { body: { message: ' ' } });
    expect(empty.status).toBe(400);
    await req('POST', '/api/feedback', { body: { message: 'ok then', rating: 'meh', game: 'chess' } });
    expect(metrics._memory.feedback).toHaveLength(1);
    expect(metrics._memory.feedback[0]).toMatchObject({ rating: null, game: null });
  });

  test('rate-limits a flood', async () => {
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await req('POST', '/api/feedback', { body: { message: 'spam ' + i } })).status);
    expect(codes).toContain(429);
  });
});

describe('games counted from room saves', () => {
  test('one start and one finish per game, again after play-again', () => {
    const room = { code: 'ABCDE', gameType: 'imposter', state: 'lobby', players: [{}, {}, {}, {}] };
    metrics.observeRoom(room);
    room.state = 'playing'; room.phase = 'clues';
    metrics.observeRoom(room); metrics.observeRoom(room);
    room.phase = 'game-over';
    metrics.observeRoom(room); metrics.observeRoom(room);
    room.state = 'lobby'; room.phase = null;
    metrics.observeRoom(room);
    room.state = 'playing'; room.phase = 'clues';
    metrics.observeRoom(room);
    const kinds = metrics._memory.events.map(e => `${e.kind}:${e.game}`);
    expect(kinds).toEqual(['game_start:imposter', 'game_end:imposter', 'game_start:imposter']);
    expect(metrics._memory.events[0].data.players).toBe(4);
  });

  test('a room without gameType is Avalon', () => {
    metrics.observeRoom({ state: 'playing', phase: 'team-proposal', players: [] });
    expect(metrics._memory.events[0].game).toBe('avalon');
  });
});

describe('summarize', () => {
  test('counts people, visits and games per day', () => {
    const now = Date.parse('2026-10-05T18:00:00Z');
    const at = '2026-10-05T10:00:00Z', old = '2026-08-01T10:00:00Z';
    const events = [
      { at, kind: 'visit', visitor: 'a', data: { source: 'google.com', device: 'phone', page: '/' } },
      { at, kind: 'visit', visitor: 'a', data: { source: 'direct', device: 'phone', page: '/' } },
      { at, kind: 'visit', visitor: 'b', data: { source: 'direct', device: 'computer', page: '/avalon' } },
      { at: old, kind: 'visit', visitor: 'c', data: {} },
      { at, kind: 'game_start', game: 'avalon', data: { players: 6 } },
      { at, kind: 'game_end', game: 'avalon', data: { players: 6 } },
    ];
    const s = metrics.summarize(events, [], now, 30);
    expect(s.totals).toMatchObject({ visits: 3, visitors: 2, visitorsToday: 2, gamesStarted: 1, gamesFinished: 1 });
    expect(s.daily).toHaveLength(30);
    expect(s.daily[29]).toEqual({ day: '2026-10-05', visits: 3, visitors: 2, started: 1, finished: 1 });
    expect(s.games.avalon).toEqual({ started: 1, finished: 1, players: 6 });
    expect(s.sources[0]).toEqual(['direct', 2]);
  });
});

describe('/admin', () => {
  test('is off without ADMIN_PASSWORD', async () => {
    expect((await req('GET', '/admin')).status).toBe(503);
    expect((await req('GET', '/api/admin/stats')).status).toBe(503);
  });

  test('asks for the password, and rejects a wrong one', async () => {
    process.env.ADMIN_PASSWORD = 'hunter22';
    const none = await req('GET', '/admin');
    expect(none.status).toBe(401);
    expect(none.headers['www-authenticate']).toMatch(/Basic/);
    expect((await req('GET', '/api/admin/stats', { headers: basic('wrong') })).status).toBe(401);
  });

  test('serves the page and stats with the right password', async () => {
    process.env.ADMIN_PASSWORD = 'hunter22';
    metrics.recordFeedback({ message: 'Great game' });   // the HTTP route is rate-limited by now
    const page = await req('GET', '/admin', { headers: basic('hunter22') });
    expect(page.status).toBe(200);
    expect(page.body).toContain('Game Night Admin');
    const stats = JSON.parse((await req('GET', '/api/admin/stats?days=7', { headers: basic('hunter22') })).body);
    expect(stats.days).toBe(7);
    expect(stats.source).toBe('memory');
    expect(stats.feedback[0].message).toBe('Great game');
  });
});

describe('search pages', () => {
  test.each(['avalon', 'imposter', 'trivia', 'council'])('/%s is a page with a title, description and Play link', async game => {
    const res = await req('GET', '/' + game);
    expect(res.status).toBe(200);
    expect(res.body).toMatch(/<title>[^<]+<\/title>/);
    expect(res.body).toMatch(/<meta name="description" content="[^"]{60,}"/);
    expect(res.body).toContain(`href="/?play=${game}"`);
  });

  test('robots.txt hides admin and points at the sitemap', async () => {
    process.env.SITE_URL = 'https://gamenight.example/';
    const robots = await req('GET', '/robots.txt');
    expect(robots.body).toContain('Disallow: /admin');
    expect(robots.body).toContain('Sitemap: https://gamenight.example/sitemap.xml');
    const map = await req('GET', '/sitemap.xml');
    expect(map.body).toContain('<loc>https://gamenight.example/avalon</loc>');
    delete process.env.SITE_URL;
  });
});
