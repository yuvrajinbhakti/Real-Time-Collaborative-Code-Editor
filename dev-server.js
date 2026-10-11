const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const collabSocket = require('./collab-socket');
const otRooms = require('./ot-rooms');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:5000'],
    methods: ['GET', 'POST']
  }
});

app.use(express.static('build'));

// Status API
app.get('/api/status', (req, res) => {
  res.json({ 
    status: 'online', 
    mode: 'development', 
    timestamp: new Date().toISOString() 
  });
});

app.use((req, res, next) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// The protocol itself lives in collab-socket.js, shared with the other
// server. It was duplicated in both for a long time and the copies drifted;
// that file says how.
collabSocket.attach(io);

const PORT = process.env.PORT || 5000;
// ot-core is an ES module and this file is CommonJS on Node 18, so it is loaded
// asynchronously. The port opens only once it has: a room that accepts edits
// before it can order them is worse than one that is briefly unavailable.
otRooms
  .init()
  .then(() =>
    server.listen(PORT, () => console.log(`Development server running on port ${PORT}`))
  )
  .catch((error) => {
    console.error('Failed to load ot-core; refusing to start:', error);
    process.exit(1);
  }); 