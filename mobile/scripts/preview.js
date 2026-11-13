// Serves mobile/www on http://localhost:5173 so the app's screens can be tried
// in a desktop browser (phone-sized window) before building for iPhone.
// Run the game server with APP_DEV_ORIGINS=http://localhost:5173 and build with
// GAME_SERVER_URL=http://localhost:3000 for a fully local preview.
const http = require('http');
const fs = require('fs');
const path = require('path');
const www = path.join(__dirname, '..', 'www');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
const port = Number(process.env.PORT || 5173);
http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(www, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(www) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`App preview on http://localhost:${port}`));
