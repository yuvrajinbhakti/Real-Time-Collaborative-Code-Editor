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
    console.log('Socket is already running');
    res.end();
    return;
  } 

  console.log('Socket is initializing');
  const io = new Server(res.socket.server, {
    path: '/api/socket',
    addTrailingSlash: false,
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true
    },
    allowEIO3: true,
    transports: ['websocket', 'polling']
  });
  
  res.socket.server.io = io;

  // Socket.IO connection handling
  io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id);

    socket.on(ACTIONS.JOIN, ({ roomId, username }) => {
      console.log(`User ${username} joining room ${roomId}`);
      userSocketMap[socket.id] = username;
      socket.join(roomId);
      const clients = getAllConnectedClients(io, roomId);
      clients.forEach(({ socketId }) => {
        io.to(socketId).emit(ACTIONS.JOINED, {
          clients,
          username,
          socketId: socket.id,
        });
      });
    });

    socket.on(ACTIONS.CODE_CHANGE, ({ roomId, code }) => {
      socket.in(roomId).emit(ACTIONS.CODE_CHANGE, { code });
    });

    socket.on(ACTIONS.SYNC_CODE, ({ socketId, code }) => {
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
  });

  console.log('Socket.IO server initialized');
  res.end();
};

export default SocketHandler; 