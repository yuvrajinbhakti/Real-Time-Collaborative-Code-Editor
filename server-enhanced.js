const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const debounce = require('lodash.debounce');

// Import services
const config = require('./config/environment');
const logger = require('./services/logger');
const redisService = require('./services/redis');
const healthCheck = require('./services/healthCheck');
const messageQueue = require('./services/messageQueue');
const otService = require('./services/operationalTransform');
const ACTIONS = require('./src/Actions');

class EnhancedServer {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = null;
    this.userSocketMap = new Map();
    this.socketUserMap = new Map();
    this.roomConnectionCounts = new Map();
    this.isShuttingDown = false;
  }

  async initialize() {
    try {
      logger.info('🚀 Starting enhanced collaborative code editor server...');
      
      // Initialize services
      await this.initializeServices();
      
      // Setup middleware
      this.setupMiddleware();
      
      // Setup routes
      this.setupRoutes();
      
      // Initialize Socket.IO
      this.initializeSocketIO();
      
      // Setup graceful shutdown
      this.setupGracefulShutdown();
      
      logger.info('✅ Server initialization completed');
    } catch (error) {
      logger.errorWithContext('Failed to initialize enhanced server', error);
      process.exit(1);
    }
  }

  async initializeServices() {
    logger.info('🔧 Initializing services...');
    
    // Initialize Redis service
    const redisConnected = await redisService.connect();
    if (!redisConnected) {
      throw new Error('Redis connection required for production features');
    }

    // Initialize message queue
    await messageQueue.initialize();
    
    // Setup recurring tasks
    messageQueue.setupRecurringCleanup();
    messageQueue.setupMetricsCollection();
    
    // Initialize health checks
    healthCheck.initialize();
    
    logger.info('✅ Services initialized');
  }

  setupMiddleware() {
    logger.info('🛡️ Setting up middleware...');
    
    // Security middleware
    if (config.SECURITY.HELMET_ENABLED) {
      this.app.use(helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "ws:", "wss:"],
          },
        },
      }));
    }

    // CORS configuration
    this.app.use(cors({
      origin: config.SECURITY.CORS_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }));

    // Rate limiting
    if (config.SECURITY.RATE_LIMITING_ENABLED) {
      const limiter = rateLimit({
        windowMs: config.PERFORMANCE.RATE_LIMIT_WINDOW_MS,
        max: config.PERFORMANCE.RATE_LIMIT_MAX_REQUESTS,
        message: {
          error: 'Too many requests from this IP',
          retryAfter: Math.ceil(config.PERFORMANCE.RATE_LIMIT_WINDOW_MS / 1000)
        },
        standardHeaders: true,
        legacyHeaders: false,
      });
      
      this.app.use('/api/', limiter);
    }

    // Request logging
    this.app.use(logger.httpMiddleware);
    
    // JSON parsing
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '1mb' }));

    // Serve static files
    this.app.use(express.static(path.join(__dirname, 'build')));
  }

  setupRoutes() {
    logger.info('🛣️ Setting up routes...');

    // Health check endpoints
    this.app.get('/health', async (req, res) => {
      try {
        const health = await healthCheck.getSimpleHealthStatus();
        res.status(health.status === 'ok' ? 200 : 503).json(health);
      } catch (error) {
        res.status(503).json({ status: 'error', error: error.message });
      }
    });

    this.app.get('/health/detailed', async (req, res) => {
      try {
        const health = await healthCheck.getDetailedHealthReport();
        res.json(health);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Metrics endpoint (Prometheus format)
    this.app.get('/metrics', (req, res) => {
      try {
        const metrics = healthCheck.getPrometheusMetrics();
        res.set('Content-Type', 'text/plain');
        res.send(metrics);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // API status endpoint
    this.app.get('/api/status', (req, res) => {
      res.json({
        status: 'online',
        mode: config.NODE_ENV,
        timestamp: new Date().toISOString(),
        version: require('./package.json').version,
        features: {
          redis: redisService.isConnected,
          operationalTransform: config.OT.ENABLE_OT,
          messageQueue: messageQueue.isInitialized,
          healthChecks: config.MONITORING.ENABLE_HEALTH_CHECKS,
        },
        limits: {
          maxConcurrentUsers: config.PERFORMANCE.MAX_CONCURRENT_USERS,
          rateLimitRequests: config.PERFORMANCE.RATE_LIMIT_MAX_REQUESTS,
          rateLimitWindow: config.PERFORMANCE.RATE_LIMIT_WINDOW_MS,
        }
      });
    });

    // Queue status endpoint
    this.app.get('/api/queue/status', async (req, res) => {
      try {
        const status = await messageQueue.getDetailedQueueStatus();
        res.json(status);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Room statistics endpoint
    this.app.get('/api/rooms/stats', async (req, res) => {
      try {
        const otMetrics = otService.getMetrics();
        const connectionStats = {
          totalConnections: this.userSocketMap.size,
          activeRooms: this.roomConnectionCounts.size,
          roomDistribution: Object.fromEntries(this.roomConnectionCounts),
        };
        
        res.json({
          operationalTransform: otMetrics,
          connections: connectionStats,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Catch all handler for React Router
    this.app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'build', 'index.html'));
    });
  }

  initializeSocketIO() {
    logger.info('🔌 Initializing Socket.IO...');

    this.io = new Server(this.server, {
      cors: {
        origin: config.NODE_ENV === 'production' ? true : [config.CLIENT_URL],
        methods: ['GET', 'POST'],
        credentials: true
      },
      transports: ['websocket', 'polling'],
      pingTimeout: 60000,
      pingInterval: 25000,
      maxHttpBufferSize: 1e6, // 1MB
      allowEIO3: true
    });

    // Socket.IO middleware for rate limiting
    this.io.use((socket, next) => {
      const clientIP = socket.handshake.address;
      logger.connection('socket_connection_attempt', {
        socketId: socket.id,
        ip: clientIP,
        userAgent: socket.handshake.headers['user-agent']
      });
      next();
    });

    // Connection handling
    this.io.on('connection', (socket) => {
      this.handleSocketConnection(socket);
    });

    // Subscribe to Redis for horizontal scaling
    this.setupRedisSubscription();
  }

  async setupRedisSubscription() {
    // Subscribe to all room channels for cross-server communication
    redisService.subscriber.psubscribe('room:*');
    
    redisService.subscriber.on('pmessage', (pattern, channel, message) => {
      try {
        const data = JSON.parse(message);
        const roomId = channel.split(':')[1];
        
        // Broadcast to local sockets in the room
        this.io.to(roomId).emit(data.event, data.data);
        
        logger.debug('Redis message broadcasted', {
          channel,
          event: data.event,
          roomId
        });
      } catch (error) {
        logger.error('Failed to process Redis message:', error);
      }
    });
  }

  handleSocketConnection(socket) {
    const startTime = Date.now();
    
    logger.connection('socket_connected', {
      socketId: socket.id,
      ip: socket.handshake.address
    });

    // Debounced code change handler to prevent flooding
    const debouncedCodeChange = debounce(async (data) => {
      await this.handleCodeChange(socket, data);
    }, config.PERFORMANCE.DEBOUNCE_DELAY_MS);

    // Join room handler
    socket.on(ACTIONS.JOIN, async ({ roomId, username }) => {
      try {
        logger.socket(ACTIONS.JOIN, { roomId, username }, socket.id, roomId);

        // Check concurrent user limits
        if (this.userSocketMap.size >= config.PERFORMANCE.MAX_CONCURRENT_USERS) {
          socket.emit('error', { 
            message: 'Server at capacity. Please try again later.' 
          });
          return;
        }

        // Store user mapping
        this.userSocketMap.set(socket.id, { username, roomId });
        this.socketUserMap.set(socket.id, { username, roomId });
        
        // Update room connection count
        const currentCount = this.roomConnectionCounts.get(roomId) || 0;
        this.roomConnectionCounts.set(roomId, currentCount + 1);

        // Join socket room
        socket.join(roomId);

        // Queue room management task
        await messageQueue.queueRoomAction('join', roomId, socket.id, {
          username,
          socketId: socket.id,
          joinedAt: Date.now()
        });

        // Get all connected clients in the room
        const clients = this.getAllConnectedClients(roomId);
        
        // Notify all clients in the room
        this.io.to(roomId).emit(ACTIONS.JOINED, {
          clients,
          username,
          socketId: socket.id,
        });

        // Initialize or sync document state
        const docState = otService.getDocumentState(roomId);
        if (docState) {
          socket.emit(ACTIONS.SYNC_CODE, {
            code: docState.content,
            version: docState.version
          });
        }

        logger.performance('Socket Join', startTime, {
          roomId,
          username,
          totalClients: clients.length
        });

      } catch (error) {
        logger.errorWithContext('Failed to handle socket join', error, {
          roomId,
          username,
          socketId: socket.id
        });
        
        socket.emit('error', { 
          message: 'Failed to join room. Please try again.' 
        });
      }
    });

    // Code change handler (debounced)
    socket.on(ACTIONS.CODE_CHANGE, debouncedCodeChange);

    // Sync code handler
    socket.on(ACTIONS.SYNC_CODE, async ({ socketId, code }) => {
      try {
        this.io.to(socketId).emit(ACTIONS.CODE_CHANGE, { code });
      } catch (error) {
        logger.errorWithContext('Failed to sync code', error, {
          targetSocketId: socketId,
          sourceSocketId: socket.id
        });
      }
    });

    // Disconnect handler
    socket.on('disconnecting', async () => {
      try {
        const userData = this.userSocketMap.get(socket.id);
        
        if (userData) {
          const { username, roomId } = userData;
          
          logger.socket('disconnecting', { username, roomId }, socket.id, roomId);

          // Update room connection count
          const currentCount = this.roomConnectionCounts.get(roomId) || 0;
          if (currentCount <= 1) {
            this.roomConnectionCounts.delete(roomId);
          } else {
            this.roomConnectionCounts.set(roomId, currentCount - 1);
          }

          // Queue room management task
          await messageQueue.queueRoomAction('leave', roomId, socket.id);

          // Notify other clients
          socket.to(roomId).emit(ACTIONS.DISCONNECTED, {
            socketId: socket.id,
            username,
          });

          // Clean up mappings
          this.userSocketMap.delete(socket.id);
          this.socketUserMap.delete(socket.id);
        }
        
        socket.leave();
      } catch (error) {
        logger.errorWithContext('Error handling socket disconnect', error, {
          socketId: socket.id
        });
      }
    });

    // Error handler
    socket.on('error', (error) => {
      logger.errorWithContext('Socket error', error, {
        socketId: socket.id
      });
    });
  }

  async handleCodeChange(socket, { roomId, code }) {
    try {
      const userData = this.userSocketMap.get(socket.id);
      if (!userData) {
        return;
      }

      const { username } = userData;
      
      if (config.OT.ENABLE_OT) {
        // Create operation from code diff
        const docState = otService.getDocumentState(roomId);
        const oldContent = docState ? docState.content : '';
        
        const operations = otService.createOperationFromDiff(oldContent, code);
        
        // Process each operation through the queue
        for (const operation of operations) {
          await messageQueue.queueOperation(roomId, operation, socket.id, socket.id);
        }
      } else {
        // Simple broadcast without OT
        socket.to(roomId).emit(ACTIONS.CODE_CHANGE, { code });
        
        // Publish to Redis for other server instances
        await redisService.publishToRoom(roomId, ACTIONS.CODE_CHANGE, { code });
      }

      logger.socket(ACTIONS.CODE_CHANGE, { codeLength: code.length }, socket.id, roomId);
      
    } catch (error) {
      logger.errorWithContext('Failed to handle code change', error, {
        roomId,
        socketId: socket.id
      });
    }
  }

  getAllConnectedClients(roomId) {
    const room = this.io.sockets.adapter.rooms.get(roomId);
    if (!room) return [];

    return Array.from(room).map((socketId) => {
      const userData = this.userSocketMap.get(socketId);
      return {
        socketId,
        username: userData ? userData.username : 'Unknown',
      };
    });
  }

  async start() {
    const PORT = config.PORT;
    
    this.server.listen(PORT, '0.0.0.0', () => {
      logger.info(`🚀 Enhanced server running on port ${PORT}`);
      logger.info(`📡 Socket.IO server ready for connections`);
      logger.info(`🌍 Environment: ${config.NODE_ENV}`);
      logger.info(`🔧 Features enabled:`, {
        redis: redisService.isConnected,
        operationalTransform: config.OT.ENABLE_OT,
        messageQueue: messageQueue.isInitialized,
        healthChecks: config.MONITORING.ENABLE_HEALTH_CHECKS,
        maxUsers: config.PERFORMANCE.MAX_CONCURRENT_USERS
      });
    });
  }

  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;
      
      logger.info(`📴 Received ${signal}. Starting graceful shutdown...`);
      
      try {
        // Stop accepting new connections
        this.server.close(() => {
          logger.info('HTTP server closed');
        });

        // Disconnect all sockets
        this.io.close(() => {
          logger.info('Socket.IO server closed');
        });

        // Shutdown services
        await messageQueue.shutdown();
        healthCheck.destroy();
        await redisService.disconnect();
        
        logger.info('✅ Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        logger.errorWithContext('Error during graceful shutdown', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.errorWithContext('Uncaught exception', error);
      shutdown('UNCAUGHT_EXCEPTION');
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection at:', promise, 'reason:', reason);
      shutdown('UNHANDLED_REJECTION');
    });
  }
}

// Initialize and start server
const server = new EnhancedServer();

async function startServer() {
  try {
    await server.initialize();
    await server.start();
  } catch (error) {
    logger.errorWithContext('Failed to start server', error);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = server; 