const { Server } = require('socket.io');
const ACTIONS = require('../src/Actions');

// Map to store user socket connections
const userSocketMap = {};

// Function to get all connected clients in a room
function getAllConnectedClients(io, roomId) {
  return Array.from(io.sockets.adapter.rooms.get(roomId) || []).map(
    (socketId) => {
      return {
        socketId,
        username: userSocketMap[socketId],
      };
    }
  );
}

// Create a Socket.IO server
const SocketHandler = (req, res) => {
  // Enable CORS for all origins
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
  res.setHeader('Access-Control-Allow-Credentials', true);

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (res.socket.server.io) {
    console.log('Socket.IO server already running');
    res.end();
    return;
  } 

  console.log('Initializing Socket.IO server for Vercel deployment');
  const io = new Server(res.socket.server, {
    path: '/api/socket',
    addTrailingSlash: false,
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true
    },
    allowEIO3: true,
    transports: ['polling'], // Force polling only for Vercel compatibility
    pingTimeout: 60000,
    pingInterval: 25000
  });
  
  res.socket.server.io = io;

  // Socket.IO connection handling
  io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id, 'Transport:', socket.conn.transport.name);

    socket.on(ACTIONS.JOIN, ({ roomId, username }) => {
      console.log(`User ${username} joining room ${roomId} via ${socket.conn.transport.name}`);
      userSocketMap[socket.id] = username;
      socket.join(roomId);
      const clients = getAllConnectedClients(io, roomId);
      console.log(`Room ${roomId} now has ${clients.length} clients`);
      clients.forEach(({ socketId }) => {
        io.to(socketId).emit(ACTIONS.JOINED, {
          clients,
          username,
          socketId: socket.id,
        });
      });
    });

    socket.on(ACTIONS.CODE_CHANGE, ({ roomId, code }) => {
      console.log(`Code change in room ${roomId}`);
      socket.in(roomId).emit(ACTIONS.CODE_CHANGE, { code });
    });

    socket.on(ACTIONS.SYNC_CODE, ({ socketId, code }) => {
      console.log(`Syncing code to socket ${socketId}`);
      io.to(socketId).emit(ACTIONS.CODE_CHANGE, { code });
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected:', socket.id);
      const rooms = [...socket.rooms];
      rooms.forEach((roomId) => {
        socket.in(roomId).emit(ACTIONS.DISCONNECTED, {
          socketId: socket.id,
          username: userSocketMap[socket.id],
        });
      });
      delete userSocketMap[socket.id];
    });

    socket.on('disconnecting', () => {
      console.log('Socket disconnecting:', socket.id);
      const rooms = [...socket.rooms];
      rooms.forEach((roomId) => {
        socket.in(roomId).emit(ACTIONS.DISCONNECTED, {
          socketId: socket.id,
          username: userSocketMap[socket.id],
        });
      });
      delete userSocketMap[socket.id];
    });

    // Handle transport upgrade (if we decide to enable it later)
    socket.conn.on('upgrade', () => {
      console.log('Transport upgraded to:', socket.conn.transport.name);
    });
  });

  console.log('Socket.IO server initialized with polling transport only');
  res.end();
};

export default SocketHandler; 