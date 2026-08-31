const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const ACTIONS = require('./src/Actions');
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

const userSocketMap = {};
function getAllConnectedClients(roomId) {
  return Array.from(io.sockets.adapter.rooms.get(roomId) || []).map(
    (socketId) => {
      return {
        socketId,
        username: userSocketMap[socketId],
      };
    }
  );
}

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on(ACTIONS.JOIN, ({ roomId, username }) => {
    userSocketMap[socket.id] = username;
    socket.join(roomId);
    const clients = getAllConnectedClients(roomId);
    clients.forEach(({ socketId }) => {
      io.to(socketId).emit(ACTIONS.JOINED, {
        clients,
        username,
        socketId: socket.id,
      });
    });
  });

  // Operations, not documents. See ot-rooms.js — this used to
  // rebroadcast the whole file, so concurrent edits overwrote each
  // other instead of merging.
  // The editor asks for the document when it is ready to receive it.
  // Emitting it on JOIN alone raced the client: the React component that
  // listens for it mounts after the socket connects, so the broadcast
  // could arrive before anything was listening and the editor stayed
  // empty. Asking is not subject to that ordering.
  socket.on(ACTIONS.SYNC, async ({ roomId }) => {
    // Wrapped because this handler is async: a rejection here is an
    // unhandled promise rejection, which Node treats as fatal. One client
    // asking for a room that cannot be loaded should not end the process
    // for everybody else in every other room.
    try {
        // Awaited because a cold room is read back from the store first.
        // Only this path awaits; operations stay synchronous so nothing can
        // interleave in the ordering.
        const opening = await otRooms.join(roomId, socket.id, userSocketMap[socket.id]);
        socket.emit(ACTIONS.INIT, opening);
    } catch (error) {
      console.error('[ot] sync failed:', error.message);
      socket.emit(ACTIONS.OT_ERROR, { reason: 'could not open the room' });
    }
  });

  socket.on(ACTIONS.OPERATION, ({ roomId, message }) => {
    const result = otRooms.operation(roomId, socket.id, message);
    if (result.error) {
      socket.emit(ACTIONS.OT_ERROR, { reason: result.error });
      return;
    }
    // Broadcast before acknowledging; the other order loses one
    // operation per collision.
    if (result.broadcast) {
      socket.in(roomId).emit(ACTIONS.OPERATION, result.broadcast);
    }
    socket.emit(ACTIONS.ACK, result.ack);
  });

  socket.on(ACTIONS.CURSOR, ({ roomId, selection, revision }) => {
    const username = userSocketMap[socket.id];
    otRooms.cursor(roomId, socket.id, { selection, revision, username });
    socket.in(roomId).emit(ACTIONS.CURSOR, {
      socketId: socket.id,
      selection,
      revision,
      username,
    });
  });

  socket.on('disconnecting', () => {
    for (const id of socket.rooms) otRooms.leave(id, socket.id);
    const rooms = [...socket.rooms];
    rooms.forEach((roomId) => {
      socket.in(roomId).emit(ACTIONS.DISCONNECTED, {
        socketId: socket.id,
        username: userSocketMap[socket.id],
      });
    });
    delete userSocketMap[socket.id];
    socket.leave();
  });
});

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