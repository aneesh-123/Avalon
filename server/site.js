// Public-site routes: visit beacons, feedback, the owner's /admin page, the
// per-game landing pages search engines index, robots.txt and sitemap.xml.

const path    = require('path');
const crypto  = require('crypto');
const express = require('express');
const metrics = require('./metrics');

const PUBLIC = path.join(__dirname, '..', 'public');
const GAME_PAGES = { '/avalon': 'avalon.html', '/imposter': 'imposter.html', '/trivia': 'trivia.html', '/council': 'council.html' };

// A small fixed-window limiter per IP, so nobody can flood the tables.
function rateLimit(max, windowMs) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return (req, res, next) => {
    const n = (hits.get(req.ip) || 0) + 1;
    hits.set(req.ip, n);
    if (n > max) return res.status(429).json({ ok: false, error: 'Too many requests. Try again in a minute.' });
    next();
  };
}

function sameSecret(given, expected) {
  const a = Buffer.from(String(given)), b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Browser password prompt (HTTP Basic auth). Any username; the password is
// ADMIN_PASSWORD. With no password set, the admin page stays switched off.
function adminOnly(req, res, next) {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return res.status(503).type('text').send('Admin page is off. Set ADMIN_PASSWORD to turn it on.');
  const [scheme, encoded] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const given = Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':');
    if (sameSecret(given, pw)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Game Night admin"').status(401).send('Password required.');
}

// The public address, for the sitemap. SITE_URL wins; otherwise the host the
// request came in on.
function siteUrl(req) {
  return (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

function registerSiteRoutes(app) {
  // Render and most hosts sit behind one proxy; this makes req.ip the player's.
  app.set('trust proxy', 1);

  // sendBeacon posts as text/plain, so accept both.
  const json = express.json({ limit: '8kb', type: ['application/json', 'text/plain'] });

  app.post('/api/visit', rateLimit(30, 60_000), json, (req, res) => {
    const b = req.body || {};
    metrics.recordVisit({ visitor: b.visitor, page: b.page, ref: b.ref, ua: req.get('user-agent'), host: req.get('host') });
    res.status(204).end();
  });

  app.post('/api/feedback', rateLimit(5, 60_000), json, (req, res) => {
    const b = req.body || {};
    const result = metrics.recordFeedback({
      message: b.message, rating: b.rating, game: b.game, contact: b.contact,
      visitor: b.visitor, ua: req.get('user-agent'),
    });
    res.status(result.ok ? 200 : 400).json(result);
  });

  // admin.html lives outside public/ so it is only ever served behind the password.
  app.get('/admin', adminOnly, (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
  app.get('/api/admin/stats', adminOnly, async (req, res) => {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    res.set('Cache-Control', 'no-store').json(await metrics.getStats(days));
  });

  for (const [route, file] of Object.entries(GAME_PAGES)) {
    app.get(route, (req, res) => res.sendFile(path.join(PUBLIC, 'pages', file)));
  }

  app.get('/robots.txt', (req, res) => {
    res.type('text').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${siteUrl(req)}/sitemap.xml\n`);
  });

  app.get('/sitemap.xml', (req, res) => {
    const base = siteUrl(req);
    const urls = ['/', ...Object.keys(GAME_PAGES)]
      .map(p => `  <url><loc>${base}${p === '/' ? '/' : p}</loc></url>`).join('\n');
    res.type('application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  });
}

module.exports = { registerSiteRoutes };
