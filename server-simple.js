const express = require('express');
const app = express();
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const ACTIONS = require('./src/Actions');
const otRooms = require('./ot-rooms');

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? true 
      : ['http://localhost:3000', 'http://localhost:5000'],
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Serve static files from build directory
app.use(express.static(path.join(__dirname, 'build')));

// Health check endpoints
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: require('./package.json').version
  });
});

app.get('/health/detailed', (req, res) => {
  const memUsage = process.memoryUsage();
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: require('./package.json').version,
    memory: {
      rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB',
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB',
      external: Math.round(memUsage.external / 1024 / 1024) + ' MB'
    },
    environment: process.env.NODE_ENV || 'development',
    nodeVersion: process.version,
    platform: process.platform
  });
});

// API Routes
app.get('/api/status', (req, res) => {
  res.json({ 
    status: 'online', 
    mode: process.env.NODE_ENV || 'development', 
    timestamp: new Date().toISOString(),
    features: {
      aiCodeReview: false,
      realTimeCollaboration: true,
      healthCheck: true
    }
  });
});

// Serve React app for all other routes
app.get('*', (req, res) => {
  try {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
  } catch (error) {
    console.error('Error serving index.html:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Socket.IO connection handling
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
  console.log('🚀 Socket connected:', socket.id);

  socket.on(ACTIONS.JOIN, ({ roomId, username }) => {
    console.log(`👤 ${username} joining room ${roomId}`);
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
    // Awaited because a cold room is read back from the store first.
    // Only this path awaits; operations stay synchronous so nothing can
    // interleave in the ordering.
    const opening = await otRooms.join(roomId, socket.id, userSocketMap[socket.id]);
    socket.emit(ACTIONS.INIT, opening);
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
  });
});

// Error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't exit in production
  if (process.env.NODE_ENV !== 'production') {
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

// Start server
const PORT = process.env.PORT || 5000;

// ot-core is an ES module and this file is CommonJS on Node 18, so it is loaded
// asynchronously. The port opens only once it has: a room that accepts edits
// before it can order them is worse than one that is briefly unavailable.
otRooms
  .init()
  .then(() => {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📡 Socket.IO server ready for connections`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`✅ Simple mode - real-time collaboration enabled`);
      console.log(`💚 Health checks available at /health`);
    });
  })
  .catch((error) => {
    console.error('Failed to load ot-core; refusing to start:', error);
    process.exit(1);
  });

module.exports = app; 