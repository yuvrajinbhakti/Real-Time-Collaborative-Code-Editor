const express = require('express');
const app = express();
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const ACTIONS = require('./src/Actions');

// Import AI and enhanced services (with fallbacks)
let aiCodeReviewService;
let logger = console; // Fallback to console if logger service not available

try {
  aiCodeReviewService = require('./services/aiCodeReview');
  console.log('✅ AI Code Review service loaded');
} catch (error) {
  console.log('⚠️ AI Code Review service not available:', error.message);
  // Create a mock service to prevent errors
  aiCodeReviewService = {
    initialize: () => {},
    getMetrics: () => ({ isEnabled: false, provider: 'none', isFree: false })
  };
}

try {
  logger = require('./services/logger');
  console.log('✅ Logger service loaded');
} catch (error) {
  console.log('⚠️ Logger service not available, using console');
}

// Initialize services
console.log('🤖 Initializing AI Code Review service...');
aiCodeReviewService.initialize();

// Middleware setup
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? true : ['http://localhost:3000', 'http://localhost:5000'],
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// API routes
app.get('/api/status', (req, res) => {
  const aiMetrics = aiCodeReviewService.getMetrics();
  res.json({ 
    status: 'online', 
    mode: process.env.NODE_ENV || 'production', 
    timestamp: new Date().toISOString(),
    platform: 'Railway',
    features: {
      aiCodeReview: aiMetrics.isEnabled,
      aiProvider: aiMetrics.provider || 'none',
      isFree: aiMetrics.isFree || false
    }
  });
});

// AI Code Review routes
try {
  const aiReviewRoutes = require('./routes/aiReview');
  app.use('/api/ai-review', aiReviewRoutes);
  console.log('✅ AI Code Review routes loaded');
} catch (error) {
  console.log('⚠️ AI Code Review routes not available:', error.message);
}

// Serve static files from build directory
app.use(express.static(path.join(__dirname, 'build')));

// Catch all handler for React Router
app.get('*', (req, res) => {
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

    socket.on(ACTIONS.CODE_CHANGE, ({ roomId, code }) => {
        socket.in(roomId).emit(ACTIONS.CODE_CHANGE, { code });
    });

    socket.on(ACTIONS.SYNC_CODE, ({ socketId, code }) => {
        io.to(socketId).emit(ACTIONS.CODE_CHANGE, { code });
    });

    socket.on('disconnecting', () => {
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

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 Socket.IO server ready for connections`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'production'}`);
});

module.exports = app;
