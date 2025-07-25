const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const debounce = require('lodash.debounce');

// Import services with fallbacks
let config, logger, redisService, healthCheck, messageQueue, otService, aiCodeReviewService;
const ACTIONS = require('./src/Actions');

// Safe service imports with fallbacks
try {
  config = require('./config/environment');
} catch (error) {
  console.log('Config service not available, using defaults');
  config = {
    PORT: process.env.PORT || 5000,
    NODE_ENV: process.env.NODE_ENV || 'production',
    SECURITY: { HELMET_ENABLED: true },
    REDIS: { URL: process.env.REDIS_URL }
  };
}

try {
  logger = require('./services/logger');
} catch (error) {
  console.log('Logger service not available, using console');
  logger = {
    info: console.log,
    error: console.error,
    errorWithContext: console.error,
    warn: console.warn
  };
}

try {
  redisService = require('./services/redis');
} catch (error) {
  console.log('Redis service not available');
  redisService = { connect: () => Promise.resolve(false) };
}

try {
  healthCheck = require('./services/healthCheck');
} catch (error) {
  console.log('Health check service not available');
  healthCheck = { initialize: () => {} };
}

try {
  messageQueue = require('./services/messageQueue');
} catch (error) {
  console.log('Message queue service not available');
  messageQueue = {
    initialize: () => Promise.resolve(),
    setupRecurringCleanup: () => {},
    setupMetricsCollection: () => {}
  };
}

try {
  otService = require('./services/operationalTransform');
} catch (error) {
  console.log('OT service not available');
  otService = {};
}

try {
  aiCodeReviewService = require('./services/aiCodeReview');
} catch (error) {
  console.log('AI Code Review service not available');
  aiCodeReviewService = {
    initialize: () => {},
    cleanup: () => {},
    getMetrics: () => ({ isEnabled: false, provider: 'none', isFree: false })
  };
}

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
      // Don't exit, fallback to basic functionality
      logger.info('🔄 Falling back to basic functionality');
      this.setupBasicServer();
    }
  }

  setupBasicServer() {
    // Setup basic middleware
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '1mb' }));
    this.app.use(express.static(path.join(__dirname, 'build')));
    
    // Setup basic routes
    this.setupRoutes();
    
    // Initialize basic Socket.IO
    this.initializeSocketIO();
    
    logger.info('✅ Basic server setup completed');
  }

  async initializeServices() {
    logger.info('🔧 Initializing services...');
    
    try {
      // Initialize Redis service
      const redisConnected = await redisService.connect();
      if (redisConnected) {
        logger.info('✅ Redis connected');
        
        // Initialize message queue
        await messageQueue.initialize();
        
        // Setup recurring tasks
        messageQueue.setupRecurringCleanup();
        messageQueue.setupMetricsCollection();
      } else {
        logger.warn('⚠️ Redis not available, continuing without Redis features');
      }

      // Initialize health checks
      healthCheck.initialize();
      
      // Initialize AI code review service
      aiCodeReviewService.initialize();
      
      // Setup periodic cleanup for AI Code Review service (every hour)
      setInterval(() => {
        try {
          aiCodeReviewService.cleanup();
        } catch (error) {
          logger.error('AI Code Review cleanup failed', { error: error.message });
        }
      }, 60 * 60 * 1000); // 1 hour
      
      logger.info('🧹 AI Code Review periodic cleanup scheduled (every hour)');
    } catch (error) {
      logger.error('Service initialization failed, continuing with basic functionality', error);
    }
    
    logger.info('✅ Services initialized');
  }

  setupMiddleware() {
    logger.info('🛡️ Setting up middleware...');
    
    // Security middleware
    if (config.SECURITY && config.SECURITY.HELMET_ENABLED) {
      this.app.use(helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"]
          }
        }
      }));
    }

    // CORS
    this.app.use(cors({
      origin: process.env.NODE_ENV === 'production' ? true : ['http://localhost:3000', 'http://localhost:5000'],
      credentials: true
    }));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100 // limit each IP to 100 requests per windowMs
    });
    this.app.use('/api/', limiter);

    // Body parsing
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '1mb' }));

    // Static files
    this.app.use(express.static(path.join(__dirname, 'build')));

    logger.info('✅ Middleware setup completed');
  }

  setupRoutes() {
    // Health check endpoints
    this.app.get('/health', (req, res) => {
      res.status(200).json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: require('./package.json').version
      });
    });

    this.app.get('/health/detailed', (req, res) => {
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
        platform: process.platform,
        features: {
          aiCodeReview: aiCodeReviewService.getMetrics().isEnabled,
          redis: !!config.REDIS?.URL,
          enhanced: true
        }
      });
    });

    // API status endpoint
    this.app.get('/api/status', (req, res) => {
      const aiMetrics = aiCodeReviewService.getMetrics();
      res.json({ 
        status: 'online', 
        mode: process.env.NODE_ENV || 'production', 
        timestamp: new Date().toISOString(),
        platform: 'Enhanced Server',
        features: {
          aiCodeReview: aiMetrics.isEnabled,
          aiProvider: aiMetrics.provider || 'none',
          isFree: aiMetrics.isFree || false,
          realTimeCollaboration: true,
          healthCheck: true,
          enhanced: true
        }
      });
    });

    // Serve React app for all other routes
    this.app.get('*', (req, res) => {
      try {
        res.sendFile(path.join(__dirname, 'build', 'index.html'));
      } catch (error) {
        logger.error('Error serving index.html:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  }

  initializeSocketIO() {
    this.io = new Server(this.server, {
      cors: {
        origin: process.env.NODE_ENV === 'production' ? true : ['http://localhost:3000', 'http://localhost:5000'],
        methods: ['GET', 'POST'],
        credentials: true
      }
    });

    this.io.on('connection', (socket) => {
      logger.info('🚀 Socket connected:', socket.id);

      socket.on(ACTIONS.JOIN, ({ roomId, username }) => {
        logger.info(`👤 ${username} joining room ${roomId}`);
        this.userSocketMap.set(socket.id, username);
        this.socketUserMap.set(username, socket.id);
        socket.join(roomId);
        
        const clients = this.getAllConnectedClients(roomId);
        clients.forEach(({ socketId }) => {
          this.io.to(socketId).emit(ACTIONS.JOINED, {
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
        this.io.to(socketId).emit(ACTIONS.CODE_CHANGE, { code });
      });

      socket.on('disconnecting', () => {
        const rooms = [...socket.rooms];
        rooms.forEach((roomId) => {
          this.io.to(roomId).emit(ACTIONS.DISCONNECTED, {
            socketId: socket.id,
            username: this.userSocketMap.get(socket.id),
          });
        });
        this.userSocketMap.delete(socket.id);
      });
    });
  }

  getAllConnectedClients(roomId) {
    return Array.from(this.io.sockets.adapter.rooms.get(roomId) || []).map(
      (socketId) => {
        return {
          socketId,
          username: this.userSocketMap.get(socketId),
        };
      }
    );
  }

  setupGracefulShutdown() {
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, shutting down gracefully');
      this.isShuttingDown = true;
      this.server.close(() => {
        logger.info('Server closed');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT received, shutting down gracefully');
      this.isShuttingDown = true;
      this.server.close(() => {
        logger.info('Server closed');
        process.exit(0);
      });
    });
  }

  start() {
    const PORT = config.PORT || process.env.PORT || 5000;
    
    this.server.listen(PORT, '0.0.0.0', () => {
      logger.info(`🚀 Enhanced server running on port ${PORT}`);
      logger.info(`📡 Socket.IO server ready for connections`);
      logger.info(`🌍 Environment: ${config.NODE_ENV || process.env.NODE_ENV || 'production'}`);
      logger.info(`🤖 AI Code Review: ${aiCodeReviewService.getMetrics().isEnabled ? 'Enabled' : 'Disabled'}`);
      logger.info(`💚 Health checks available at /health`);
    });
  }
}

// Initialize and start server
const server = new EnhancedServer();
server.initialize().then(() => {
  server.start();
}).catch((error) => {
  console.error('Failed to start enhanced server:', error);
  console.log('🔄 Falling back to basic server');
  
  // Fallback to basic server
  const basicApp = express();
  const basicServer = http.createServer(basicApp);
  
  basicApp.use(express.json());
  basicApp.use(express.static(path.join(__dirname, 'build')));
  
  basicApp.get('/health', (req, res) => {
    res.json({ status: 'healthy', mode: 'fallback' });
  });
  
  basicApp.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
  });
  
  const PORT = process.env.PORT || 5000;
  basicServer.listen(PORT, () => {
    console.log(`🚀 Fallback server running on port ${PORT}`);
  });
});

module.exports = server; 