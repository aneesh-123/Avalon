require('dotenv').config();
const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');
const registerHandlers = require('./server/socketHandlers');
const registerImposterHandlers = require('./server/imposter/handlers');
const registerTriviaHandlers = require('./server/trivia/handlers');
const registerCouncilHandlers = require('./server/council/handlers');
const { rooms }        = require('./server/rooms');
const { impRooms }     = require('./server/imposter/rooms');
const { trivRooms }    = require('./server/trivia/rooms');
const { councilRooms } = require('./server/council/rooms');
const { loadRooms }    = require('./server/db');
const { registerQrRoute } = require('./server/qr');
const { registerSiteRoutes } = require('./server/site');

const app    = express();
const server = http.createServer(app);

// The iOS app (mobile/) carries its own copy of public/ and talks to this
// server from the app's built-in origin, so that origin, and only that one,
// may connect cross-origin. The website itself is same-origin and unaffected.
// APP_DEV_ORIGINS adds origins for previewing the app in a desktop browser.
const APP_ORIGINS = ['capacitor://localhost', 'ionic://localhost',
  ...(process.env.APP_DEV_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)];
const io     = new Server(server, { cors: { origin: APP_ORIGINS } });
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (APP_ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
});

app.get('/ping', (req, res) => res.send('ok'));
registerSiteRoutes(app);
app.use(express.static(path.join(__dirname, 'public')));
registerQrRoute(app);

registerHandlers(io);
registerImposterHandlers(io);
registerTriviaHandlers(io);
registerCouncilHandlers(io);

const PORT = process.env.PORT || 3000;

async function start() {
  // Restore any active games from the database before accepting connections
  try {
    const saved = await loadRooms();
    saved.forEach(room => {
      if (room.gameType === 'imposter') impRooms[room.code] = room;
      else if (room.gameType === 'trivia') trivRooms[room.code] = room;
      else if (room.gameType === 'council') councilRooms[room.code] = room;
      else rooms[room.code] = room;
    });
    if (saved.length > 0) console.log(`[db] Restored ${saved.length} room(s) from database`);
  } catch (e) {
    console.error('[db] Could not load rooms on startup:', e.message);
  }

  server.listen(PORT, () => console.log(`Avalon running on http://localhost:${PORT}`));
}

start();
