// Builds mobile/www: the copy of the website's game screens that ships inside
// the iPhone app. The app opens instantly from this copy and only talks to the
// live game server for the games themselves.
//
//   GAME_SERVER_URL=https://your-server.onrender.com npm run build:web
//
// Without GAME_SERVER_URL it uses LIVE_SERVER below.

const fs = require('fs');
const path = require('path');

// The live Render service. Change this once the real address (or a custom
// domain) is settled; invite links friends receive point here too.
const LIVE_SERVER = 'https://game-night.onrender.com';

const server = (process.env.GAME_SERVER_URL || LIVE_SERVER).replace(/\/+$/, '');
const root = path.join(__dirname, '..');
const pub = path.join(root, '..', 'public');
const www = path.join(root, 'www');

fs.rmSync(www, { recursive: true, force: true });
// pages/ are the website's search-engine landing pages; the app has no use for them.
fs.cpSync(pub, www, { recursive: true, filter: src => !src.startsWith(path.join(pub, 'pages')) });

fs.writeFileSync(path.join(www, 'app-config.js'),
  `// Written by mobile/scripts/build-web.js. Do not edit.\n` +
  `window.GN_SERVER = ${JSON.stringify(server)};\n` +
  `window.GN_PUBLIC = ${JSON.stringify(process.env.GAME_PUBLIC_URL || server)};\n`);

// The website gets socket.io from its own server; the app carries its own copy.
fs.copyFileSync(path.join(root, 'node_modules', 'socket.io-client', 'dist', 'socket.io.min.js'),
  path.join(www, 'socket.io.min.js'));
for (const f of fs.readdirSync(path.join(root, 'app'))) {
  fs.copyFileSync(path.join(root, 'app', f), path.join(www, f));
}

const indexPath = path.join(www, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
const swap = (from, to) => {
  if (!html.includes(from)) throw new Error(`build-web: index.html no longer contains ${from}`);
  html = html.replace(from, to);
};
swap('<script src="/socket.io/socket.io.js"></script>', '<script src="socket.io.min.js"></script>');
swap('</head>', '  <link rel="stylesheet" href="app.css">\n</head>');
swap('<script src="site.js"></script>', '<script src="site.js"></script>\n  <script src="app.js"></script>');
swap('<body>', '<body class="gn-app">');
fs.writeFileSync(indexPath, html);

console.log(`Built mobile/www (game server: ${server})`);
