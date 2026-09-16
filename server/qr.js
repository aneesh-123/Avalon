// QR codes for invite links.
//
// Generated server-side and served as SVG so the client stays a plain <img> —
// no bundler, no vendored third-party script in public/, nothing to keep in
// sync. The client passes the URL it wants encoded, because only the client
// knows the origin players actually reached the app on (a LAN IP on game night,
// the Render hostname in production, localhost in dev).

const QRCode = require('qrcode');

// Anything encoded here ends up in an <img> that people point a camera at, so
// refuse to mint a code for a destination that isn't this app.
function isSafeInviteUrl(raw, req) {
  let url;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  // Same host the request arrived on — a QR pointing somewhere else is either a
  // bug or someone using the app as an open redirect generator.
  const host = (req.headers.host || '').toLowerCase();
  return host !== '' && url.host.toLowerCase() === host;
}

function registerQrRoute(app) {
  app.get('/qr', async (req, res) => {
    const data = String(req.query.data || '');
    if (!data)                        return res.status(400).send('missing data');
    if (data.length > 512)            return res.status(400).send('data too long');
    if (!isSafeInviteUrl(data, req))  return res.status(400).send('not an invite link for this host');

    try {
      const svg = await QRCode.toString(data, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 1,
        color: { dark: '#12121c', light: '#f4ead7' },   // reads against the app's parchment tone
      });
      res.type('image/svg+xml');
      res.set('Cache-Control', 'public, max-age=300');
      res.send(svg);
    } catch (e) {
      console.error('[qr]', e.message);
      res.status(500).send('could not generate QR');
    }
  });
}

module.exports = { registerQrRoute, isSafeInviteUrl };
