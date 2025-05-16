const express = require('express');
const app = express();
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const ACTIONS = require('./src/Actions');

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? false : ['http://localhost:3000', 'http://localhost:5000'],
    methods: ['GET', 'POST']
  }
});

// API routes
app.get('/api/status', (req, res) => {
  res.json({ status: 'online', mode: process.env.NODE_ENV, timestamp: new Date().toISOString() });
});

// Determine the correct build folder path
// In Vercel serverless environment, we need a different path
const buildPath = process.env.NODE_ENV === 'production' 
  ? path.join(process.cwd(), '.vercel/output/static') 
  : path.join(__dirname, 'build');

console.log('Build path:', buildPath);

app.use(express.static(buildPath));
app.use((req, res, next) => {
  try {
    const indexPath = path.join(buildPath, 'index.html');
    console.log('Trying to serve index from:', indexPath);
    res.sendFile(indexPath);
  } catch (err) {
    console.error('Error serving index.html:', err);
    res.status(500).send('Error loading application');
  }
});

const userSocketMap = {};
function getAllConnectedClients(roomId) {
    // Map
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
    console.log('socket connected', socket.id);

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

// For local development
if (process.env.NODE_ENV !== 'production') {
    server.listen(PORT, () => console.log(`Listening on port ${PORT}`));
} 
// For Vercel serverless deployment
else {
    // This will be used by Vercel
    console.log('Running in production mode');
}

// Export both app and server for Vercel
module.exports = app;
// Also attach server to app for Socket.IO functionality
app.server = server;
