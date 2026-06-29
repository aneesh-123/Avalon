const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');
const registerHandlers = require('./server/socketHandlers');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.get('/ping', (req, res) => res.send('ok'));
app.use(express.static(path.join(__dirname, 'public')));

registerHandlers(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Avalon running on http://localhost:${PORT}`));
