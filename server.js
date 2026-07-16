require('dotenv').config();
const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');
const registerHandlers = require('./server/socketHandlers');
const registerImposterHandlers = require('./server/imposter/handlers');
const { rooms }        = require('./server/rooms');
const { impRooms }     = require('./server/imposter/rooms');
const { loadRooms }    = require('./server/db');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.get('/ping', (req, res) => res.send('ok'));
app.use(express.static(path.join(__dirname, 'public')));

registerHandlers(io);
registerImposterHandlers(io);

const PORT = process.env.PORT || 3000;

async function start() {
  // Restore any active games from the database before accepting connections
  try {
    const saved = await loadRooms();
    saved.forEach(room => {
      if (room.gameType === 'imposter') impRooms[room.code] = room;
      else rooms[room.code] = room;
    });
    if (saved.length > 0) console.log(`[db] Restored ${saved.length} room(s) from database`);
  } catch (e) {
    console.error('[db] Could not load rooms on startup:', e.message);
  }

  server.listen(PORT, () => console.log(`Avalon running on http://localhost:${PORT}`));
}

start();
