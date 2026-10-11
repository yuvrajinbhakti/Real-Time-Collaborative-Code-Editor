const express = require('express');
const app = express();
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const ACTIONS = require('./src/Actions');
const otRooms = require('./ot-rooms');
const metrics = require('./services/metrics');
metrics.init();

/**
 * Connect Redis if it is configured, and return it — or null.
 *
 * "Configured" means an explicit REDIS_URL or REDIS_HOST. Without one the
 * defaults point at localhost, and trying that on a host with no Redis produces
 * a connection error on every boot for a feature nobody asked for. That is the
 * shape of the MongoDB failure in the other repository: a hard-coded
 * 127.0.0.1 that could never work in production and logged a stack trace at
 * every start.
 */
async function connectStore() {
  if (!process.env.REDIS_URL && !process.env.REDIS_HOST) {
    console.log('💾 Document persistence: off (set REDIS_URL or REDIS_HOST to enable)');
    return null;
  }
  try {
    const redisService = require('./services/redis');
    const connected = await redisService.connect();
    if (!connected) {
      console.log('💾 Document persistence: off (Redis did not connect)');
      return null;
    }
    console.log('💾 Document persistence: on');
    return redisService;
  } catch (error) {
    console.log(`💾 Document persistence: off (${error.message})`);
    return null;
  }
}

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
aiCodeReviewService.initialize();

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

// Health check endpoints (required for Render deployment)
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: require('./package.json').version
  });
});

/**
 * The endpoint prometheus.yml scrapes. It has been in that config, and in the
 * load test, since long before anything served it.
 */
app.get('/metrics', async (req, res) => {
  if (!metrics.enabled()) {
    // Said plainly rather than returning an empty 200, which a scraper cannot
    // tell from an application that simply has nothing to report.
    return res.status(503).type('text/plain').send('# metrics unavailable: prom-client failed to load\n');
  }
  // Derived gauges are refreshed here rather than on every keystroke — and,
  // for the socket count, rather than on connect and disconnect. Engine.IO has
  // not decremented `clientsCount` yet when the `disconnect` event fires, so a
  // gauge maintained from those events climbs and never comes back down. Read
  // at scrape time it is simply correct.
  metrics.setSockets(io.engine.clientsCount);
  metrics.observeRooms(otRooms.stats());
  res.set('Content-Type', metrics.contentType());
  return res.send(await metrics.text());
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
    environment: process.env.NODE_ENV || 'production',
    nodeVersion: process.version,
    platform: process.platform,
    features: {
      aiCodeReview: aiCodeReviewService.getMetrics().isEnabled,
      collaborativeReviews: collaborativeReviews.size,
      activeRooms: roomReviews.size,
      realTimeCollaboration: true
    },
    // Operational transform state, per room. `history` is the number of
    // operations still rebaseable; it is the figure that decides how expensive a
    // late operation is, so it is worth being able to see it from outside.
    documents: otRooms.stats()
  });
});

// API routes
app.get('/api/status', (req, res) => {
  const aiMetrics = aiCodeReviewService.getMetrics();
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

// Catch all handler for React Router
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

const userSocketMap = {};
function getAllConnectedClients(roomId) {
    return Array.from(io.sockets.adapter.rooms.get(roomId) || [])
        .map((socketId) => ({ socketId, username: userSocketMap[socketId] }))
        // A socket in the room with no username has either not finished joining
        // or is in the middle of leaving — `disconnecting` clears the name while
        // the socket is still a member. Either way it is not a person to draw,
        // and drawing it is permanent: the client list is only ever pruned by a
        // DISCONNECTED event, and one has already been sent for a socket in that
        // state. That is where the nameless avatars came from.
        .filter((client) => Boolean(client.username));
}

io.on('connection', (socket) => {
    console.log('🚀 Socket connected:', socket.id);


    socket.on(ACTIONS.JOIN, ({ roomId, username }) => {
        console.log(`👤 ${username} joining room ${roomId}`);
        userSocketMap[socket.id] = username;
        socket.join(roomId);

        // No document here. It is sent in reply to SYNC instead, because the
        // component that renders it mounts after the socket connects — sending
        // it on JOIN as well meant every client initialised twice, and the
        // second initialisation replaced the document while the collaborative
        // binding was already attached, which reported the replacement as an
        // edit and wiped the room.

        const clients = getAllConnectedClients(roomId);
        clients.forEach(({ socketId }) => {
            io.to(socketId).emit(ACTIONS.JOINED, {
                clients,
                username,
                socketId: socket.id,
            });
        });
    });

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

    /*
     * A reconnecting client asking what it missed.
     *
     * The cheap way back into a room. SYNC hands over a whole fresh snapshot,
     * which is correct but makes the client drop everything it had in flight
     * when the socket died; this hands back just the operations after the
     * revision it reached, so it can rebase what it was holding and keep it.
     *
     * Synchronous, unlike SYNC: a room that is already open is the only case
     * this answers, and `catchUp` says `resync` for every other — including a
     * revision the room has compacted past, and anything the client sends that
     * is not a revision this server issued. The fallback is the snapshot path,
     * so the worst outcome is the behaviour that existed before this route.
     */
    socket.on(ACTIONS.RESYNC, async ({ roomId, revision }) => {
        const result = otRooms.catchUp(roomId, socket.id, revision);

        if (result.error) {
            socket.emit(ACTIONS.OT_ERROR, { reason: result.error });
            return;
        }

        if (result.resync) {
            try {
                const opening = await otRooms.join(roomId, socket.id, userSocketMap[socket.id]);
                socket.emit(ACTIONS.INIT, opening);
            } catch (error) {
                console.error('[ot] resync fallback failed:', error.message);
                socket.emit(ACTIONS.OT_ERROR, { reason: 'could not open the room' });
            }
            return;
        }

        socket.emit(ACTIONS.MISSED, { missed: result.missed, revision: result.revision });
    });

    socket.on(ACTIONS.OPERATION, ({ roomId, message }) => {
        const startedAt = process.hrtime.bigint();
        const result = otRooms.operation(roomId, socket.id, message);
        const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;

        // Three outcomes worth telling apart: applied, rejected (the client is
        // too far behind to rebase), and a duplicate resend that changed
        // nothing. A rising rejection rate is the signal that the retention
        // window is too small.
        metrics.recordOperation(
            result.error ? 'rejected' : result.broadcast ? 'applied' : 'duplicate',
            seconds
        );

        if (result.error) {
            socket.emit(ACTIONS.OT_ERROR, { reason: result.error });
            return;
        }

        // Broadcast before acknowledging. Acknowledging first lets the author
        // send its next operation against a revision the room has not finished
        // distributing, which silently loses one operation per collision — a
        // bug found in ot-core's own fan-out rather than predicted.
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
        const rooms = [...socket.rooms];
        rooms.forEach((roomId) => {
            otRooms.leave(roomId, socket.id);
            socket.in(roomId).emit(ACTIONS.DISCONNECTED, {
                socketId: socket.id,
                username: userSocketMap[socket.id],
            });
        });
        delete userSocketMap[socket.id];
        // `socket.leave()` with no argument leaves a room called "undefined".
        // Disconnecting removes the socket from its rooms anyway, so the call
        // was doing nothing except looking like it did something.
    });
});

const PORT = process.env.PORT || 5000;

// ot-core is an ES module and this file is CommonJS on Node 18, so it is
// loaded asynchronously. The port opens only once it has, because a room
// that accepts edits before it can order them is worse than one that is
// briefly unavailable.
// Redis is optional. If it is not configured — which is the case on the current
// deployment — persistence stays off and everything else works exactly as
// before. A store that cannot be reached must never be the reason two people
// cannot type.
connectStore()
  .then((redisStore) => otRooms.init(redisStore))
  .then(() => {
  server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📡 Socket.IO server ready for connections`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'production'}`);
      console.log(`🤖 AI Code Review: ${aiCodeReviewService.getMetrics().isEnabled ? 'Enabled' : 'Disabled'}`);
      console.log(`🏠 Collaborative reviews storage ready`);
  });
  })
  .catch((error) => {
    console.error('Failed to load ot-core; refusing to start:', error);
    process.exit(1);
  });

module.exports = app;
