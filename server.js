const express = require('express');
const app = express();
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const ACTIONS = require('./src/Actions');

// Import AI and enhanced services (with fallbacks)
let aiCodeReviewService;
let logger = console; // Fallback to console if logger service not available
let monitoring;

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

try {
  monitoring = require('./services/monitoring');
  console.log('✅ Monitoring service loaded');
} catch (error) {
  console.log('⚠️ Monitoring service not available');
  // Create mock monitoring service
  monitoring = {
    start: () => {},
    recordRequest: () => {},
    recordAIRequest: () => {},
    recordError: () => {},
    updateActiveConnections: () => {},
    getMetrics: () => ({ status: 'unknown' })
  };
}

// In-memory storage for collaborative reviews (directly in server.js)
const collaborativeReviews = new Map(); // reviewId -> review object
const roomReviews = new Map();          // roomId -> array of reviewIds
const reviewComments = new Map();       // reviewId -> array of comments

// Helper functions for collaborative reviews
function generateReviewId() {
  return `review_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function generateCommentId() {
  return `comment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Initialize services
console.log('🤖 Initializing AI Code Review service...');
try {
  aiCodeReviewService.initialize();
  console.log('✅ AI Code Review service initialized successfully');
} catch (error) {
  console.error('❌ Failed to initialize AI service:', error.message);
}

console.log('📊 Starting monitoring service...');
monitoring.start();

// Setup periodic cleanup for AI Code Review service (every hour)
setInterval(() => {
  try {
    aiCodeReviewService.cleanup();
    // Also cleanup collaborative reviews
    cleanupCollaborativeReviews();
  } catch (error) {
    console.error('AI Code Review cleanup failed:', error.message);
  }
}, 60 * 60 * 1000); // 1 hour

function cleanupCollaborativeReviews() {
  const now = Date.now();
  const reviewMaxAge = 24 * 60 * 60 * 1000; // 24 hours
  
  for (const [reviewId, review] of collaborativeReviews.entries()) {
    const reviewAge = now - new Date(review.created_at).getTime();
    if (reviewAge > reviewMaxAge) {
      // Remove from collaborative reviews
      collaborativeReviews.delete(reviewId);
      
      // Remove from room reviews
      if (roomReviews.has(review.roomId)) {
        const roomReviewIds = roomReviews.get(review.roomId);
        const updatedIds = roomReviewIds.filter(id => id !== reviewId);
        if (updatedIds.length === 0) {
          roomReviews.delete(review.roomId);
        } else {
          roomReviews.set(review.roomId, updatedIds);
        }
      }
      
      // Remove comments for this review
      reviewComments.delete(reviewId);
      
      console.log('Cleaned up old review:', reviewId);
    }
  }
  
  console.log('Collaborative reviews cleanup completed', {
    collaborativeReviewsCount: collaborativeReviews.size,
    roomReviewsCount: roomReviews.size,
    reviewCommentsCount: reviewComments.size
  });
}

console.log('🧹 AI Code Review periodic cleanup scheduled (every hour)');

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
  monitoring.recordRequest();
  const aiMetrics = aiCodeReviewService.getMetrics();
  const systemMetrics = monitoring.getMetrics();
  
  res.json({ 
    status: 'online', 
    mode: process.env.NODE_ENV || 'production', 
    timestamp: new Date().toISOString(),
    platform: 'Render',
    features: {
      aiCodeReview: aiMetrics.isEnabled,
      aiProvider: aiMetrics.provider || 'none',
      isFree: aiMetrics.isFree || false,
      collaborativeReviews: collaborativeReviews.size,
      activeRooms: roomReviews.size,
      totalComments: Array.from(reviewComments.values()).reduce((sum, comments) => sum + comments.length, 0)
    },
    performance: {
      uptime: systemMetrics.uptime,
      requests: systemMetrics.requests,
      activeConnections: systemMetrics.activeConnections,
      systemHealth: systemMetrics.status,
      alerts: monitoring.getAlerts()
    }
  });
});

// AI Code Review Routes (implemented directly in server.js)

// Create AI Review
app.post('/api/ai-review/create', async (req, res) => {
  try {
    const { roomId, code, language, analysisTypes } = req.body;
    const userId = req.ip; // Use IP as user identifier
    
    // Validate input
    if (!code || code.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Code is required'
      });
    }

    if (code.length > 50000) {
      return res.status(400).json({
        success: false,
        message: 'Code too large. Maximum 50,000 characters allowed.'
      });
    }

    // Analyze the code first
    const analysis = await aiCodeReviewService.analyzeCode(code, language || 'javascript', { 
      analysisTypes, 
      userId 
    });
    
    // Create review object
    const reviewId = generateReviewId();
    const review = {
      id: reviewId,
      roomId,
      authorId: userId,
      code,
      language: language || 'javascript',
      analysis,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      comments: []
    };
    
    // Store the review
    collaborativeReviews.set(reviewId, review);
    
    // Add to room reviews
    if (!roomReviews.has(roomId)) {
      roomReviews.set(roomId, []);
    }
    roomReviews.get(roomId).unshift(reviewId); // Add to beginning
    
    // Initialize comments array
    reviewComments.set(reviewId, []);

    // Emit real-time event to room members
    io.to(roomId).emit('ai_review_created', {
      reviewId: review.id,
      authorId: userId,
      summary: review.analysis.summary,
      overallScore: review.analysis.overall_score,
      issueCount: review.analysis.issues.length,
      language: review.language,
      created_at: review.created_at
    });

    console.log('Collaborative review created', {
      reviewId,
      roomId,
      authorId: userId,
      language: review.language,
      issuesFound: analysis.issues.length
    });

    res.json({
      success: true,
      data: {
        reviewId: review.id,
        summary: review.analysis.summary,
        overallScore: review.analysis.overall_score,
        issueCount: review.analysis.issues.length,
        analysis: review.analysis
      }
    });

  } catch (error) {
    console.error('AI review creation failed', error.message);

    if (error.message.includes('Rate limit exceeded')) {
      return res.status(429).json({
        success: false,
        message: error.message
      });
    }

    if (error.message.includes('not enabled')) {
      return res.status(503).json({
        success: false,
        message: 'AI Code Review service is currently unavailable'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create AI review'
    });
  }
});

// AI service status - MUST come before parameterized routes
app.get('/api/ai-review/status', async (req, res) => {
  try {
    const metrics = aiCodeReviewService.getMetrics();

    res.json({
      success: true,
      data: {
        enabled: metrics.isEnabled,
        provider: metrics.provider,
        isFree: metrics.isFree,
        cacheSize: metrics.cacheSize,
        activeUsers: metrics.rateLimitTrackers,
        totalRequests: metrics.totalRequests,
        collaborativeReviews: collaborativeReviews.size,
        activeRooms: roomReviews.size,
        totalComments: Array.from(reviewComments.values()).reduce((sum, comments) => sum + comments.length, 0)
      }
    });

  } catch (error) {
    console.error('Failed to get AI service status', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to get service status'
    });
  }
});

// Get specific review
app.get('/api/ai-review/:reviewId', async (req, res) => {
  try {
    const { reviewId } = req.params;
    const review = collaborativeReviews.get(reviewId);
    
    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }
    
    // Get comments for this review
    const comments = reviewComments.get(reviewId) || [];
    
    res.json({
      success: true,
      data: {
        ...review,
        comments
      }
    });

  } catch (error) {
    console.error('Failed to get AI review', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve review'
    });
  }
});

// Get room reviews
app.get('/api/ai-review/room/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const limit = parseInt(req.query.limit) || 10;
    
    const reviewIds = roomReviews.get(roomId) || [];
    const reviews = [];
    
    for (let i = 0; i < Math.min(reviewIds.length, limit); i++) {
      const reviewId = reviewIds[i];
      const review = collaborativeReviews.get(reviewId);
      if (review) {
        const comments = reviewComments.get(reviewId) || [];
        reviews.push({
          id: review.id,
          authorId: review.authorId,
          summary: review.analysis.summary,
          overallScore: review.analysis.overall_score,
          issueCount: review.analysis.issues.length,
          language: review.language,
          created_at: review.created_at,
          commentCount: comments.length
        });
      }
    }

    res.json({
      success: true,
      data: reviews
    });

  } catch (error) {
    console.error('Failed to get room reviews', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve room reviews'
    });
  }
});

// Add comment to review
app.post('/api/ai-review/:reviewId/comment', async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { comment, lineNumber } = req.body;
    const userId = req.ip;

    if (!comment || comment.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Comment is required'
      });
    }

    const review = collaborativeReviews.get(reviewId);
    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }
    
    const newComment = {
      id: generateCommentId(),
      reviewId,
      userId,
      comment: comment.trim(),
      lineNumber,
      timestamp: new Date().toISOString()
    };
    
    // Add comment to review comments
    if (!reviewComments.has(reviewId)) {
      reviewComments.set(reviewId, []);
    }
    reviewComments.get(reviewId).push(newComment);
    
    // Update review timestamp
    review.updated_at = new Date().toISOString();

    // Emit real-time event to room members
    io.to(review.roomId).emit('review_comment_added', {
      reviewId,
      comment: newComment,
      authorId: userId
    });

    console.log('Comment added to review', {
      reviewId,
      commentId: newComment.id,
      userId,
      lineNumber
    });

    res.json({
      success: true,
      data: newComment
    });

  } catch (error) {
    console.error('Failed to add review comment', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to add comment'
    });
  }
});

// Quick analysis
app.post('/api/ai-review/analyze', async (req, res) => {
  try {
    const { code, language, analysisTypes } = req.body;
    const userId = req.ip;

    if (!code || code.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Code is required'
      });
    }

    if (code.length > 10000) {
      return res.status(400).json({
        success: false,
        message: 'Code too large for quick analysis. Maximum 10,000 characters allowed.'
      });
    }

    const analysis = await aiCodeReviewService.analyzeCode(
      code,
      language || 'javascript',
      { analysisTypes, userId }
    );

    res.json({
      success: true,
      data: analysis
    });

  } catch (error) {
    console.error('AI quick analysis failed', error.message);

    if (error.message.includes('Rate limit exceeded')) {
      return res.status(429).json({
        success: false,
        message: error.message
      });
    }

    if (error.message.includes('not enabled')) {
      return res.status(503).json({
        success: false,
        message: 'AI Code Review service is currently unavailable'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to analyze code'
    });
  }
});

// Status endpoint moved above to avoid route conflict

// Serve static files from build directory
app.use(express.static(path.join(__dirname, 'build')));

// Debug endpoint to check build directory
app.get('/debug/build', (req, res) => {
  const fs = require('fs');
  const buildPath = path.join(__dirname, 'build');
  const indexPath = path.join(buildPath, 'index.html');
  
  res.json({
    buildDirExists: fs.existsSync(buildPath),
    indexHtmlExists: fs.existsSync(indexPath),
    buildContents: fs.existsSync(buildPath) ? fs.readdirSync(buildPath) : 'N/A',
    buildPath: buildPath,
    workingDir: __dirname
  });
});

// Catch all handler for React Router
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'build', 'index.html');
  const fs = require('fs');
  
  // Check if build directory exists
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    // Fallback: serve a simple redirect to build the app
    res.status(503).send(`
      <h1>Building Application...</h1>
      <p>The React build is not ready yet. Please wait a moment and refresh.</p>
      <script>setTimeout(() => window.location.reload(), 10000);</script>
    `);
  }
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
    console.log(`🤖 AI Code Review: ${aiCodeReviewService.getMetrics().isEnabled ? 'Enabled' : 'Disabled'}`);
    console.log(`🏠 Collaborative reviews storage ready`);
});

module.exports = app;
