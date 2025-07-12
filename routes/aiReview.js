const express = require('express');
const router = express.Router();
const aiCodeReviewService = require('../services/aiCodeReview');
const logger = require('../services/logger');
const { validate, schemas } = require('../middleware/validation');
const { authenticate, optionalAuth, userRateLimit } = require('../middleware/auth');

// AI Code Review Routes

// Create a new AI code review
router.post('/create', 
  optionalAuth,
  userRateLimit(15, 60 * 1000), // 15 requests per minute (generous for free Gemini)
  validate(schemas.aiCodeReview),
  async (req, res) => {
    try {
      const { roomId, code, language, analysisTypes } = req.body;
      const userId = req.user?._id || req.ip; // Use IP if not authenticated
      
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

      // Create the review
      const review = await aiCodeReviewService.createCollaborativeReview(
        roomId,
        code,
        language || 'javascript',
        userId,
        { analysisTypes }
      );

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
      logger.errorWithContext('AI review creation failed', error, {
        userId: req.user?._id,
        roomId: req.body.roomId,
        ip: req.ip
      });

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
  }
);

// Get a specific review
router.get('/:reviewId', 
  optionalAuth,
  async (req, res) => {
    try {
      const { reviewId } = req.params;
      const review = await aiCodeReviewService.getReview(reviewId);

      if (!review) {
        return res.status(404).json({
          success: false,
          message: 'Review not found'
        });
      }

      res.json({
        success: true,
        data: review
      });

    } catch (error) {
      logger.errorWithContext('Failed to get AI review', error, {
        reviewId: req.params.reviewId,
        userId: req.user?._id
      });

      res.status(500).json({
        success: false,
        message: 'Failed to retrieve review'
      });
    }
  }
);

// Get all reviews for a room
router.get('/room/:roomId', 
  optionalAuth,
  async (req, res) => {
    try {
      const { roomId } = req.params;
      const limit = parseInt(req.query.limit) || 10;
      
      const reviews = await aiCodeReviewService.getRoomReviews(roomId, limit);

      res.json({
        success: true,
        data: reviews.map(review => ({
          id: review.id,
          authorId: review.authorId,
          summary: review.analysis.summary,
          overallScore: review.analysis.overall_score,
          issueCount: review.analysis.issues.length,
          language: review.language,
          created_at: review.created_at,
          commentCount: review.comments.length
        }))
      });

    } catch (error) {
      logger.errorWithContext('Failed to get room reviews', error, {
        roomId: req.params.roomId,
        userId: req.user?._id
      });

      res.status(500).json({
        success: false,
        message: 'Failed to retrieve room reviews'
      });
    }
  }
);

// Add comment to a review
router.post('/:reviewId/comment',
  optionalAuth,
  userRateLimit(20, 60 * 1000), // 20 comments per minute
  validate(schemas.reviewComment),
  async (req, res) => {
    try {
      const { reviewId } = req.params;
      const { comment, lineNumber } = req.body;
      const userId = req.user?._id || req.ip;

      const newComment = await aiCodeReviewService.addReviewComment(
        reviewId,
        userId,
        comment,
        lineNumber
      );

      res.json({
        success: true,
        data: newComment
      });

    } catch (error) {
      logger.errorWithContext('Failed to add review comment', error, {
        reviewId: req.params.reviewId,
        userId: req.user?._id
      });

      if (error.message.includes('Review not found')) {
        return res.status(404).json({
          success: false,
          message: 'Review not found'
        });
      }

      res.status(500).json({
        success: false,
        message: 'Failed to add comment'
      });
    }
  }
);

// Quick code analysis (without storing)
router.post('/analyze',
  optionalAuth,
  userRateLimit(20, 60 * 1000), // 20 requests per minute (generous for free Gemini)
  validate(schemas.quickAnalysis),
  async (req, res) => {
    try {
      const { code, language, analysisTypes } = req.body;
      const userId = req.user?._id || req.ip;

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
      logger.errorWithContext('AI quick analysis failed', error, {
        userId: req.user?._id,
        language: req.body.language
      });

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
  }
);

// Get AI service status
router.get('/status', async (req, res) => {
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
        totalRequests: metrics.totalRequests
      }
    });

  } catch (error) {
    logger.errorWithContext('Failed to get AI service status', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to get service status'
    });
  }
});

// Batch analyze multiple code snippets
router.post('/batch-analyze',
  authenticate, // Require authentication for batch operations
  userRateLimit(2, 60 * 1000), // 2 requests per minute
  async (req, res) => {
    try {
      const { codeSnippets } = req.body;
      const userId = req.user._id;

      if (!Array.isArray(codeSnippets) || codeSnippets.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Code snippets array is required'
        });
      }

      if (codeSnippets.length > 5) {
        return res.status(400).json({
          success: false,
          message: 'Maximum 5 code snippets per batch'
        });
      }

      const results = [];
      
      for (const snippet of codeSnippets) {
        if (!snippet.code || snippet.code.length > 5000) {
          results.push({
            id: snippet.id,
            error: 'Invalid code or code too large (max 5000 characters)'
          });
          continue;
        }

        try {
          const analysis = await aiCodeReviewService.analyzeCode(
            snippet.code,
            snippet.language || 'javascript',
            { analysisTypes: snippet.analysisTypes, userId }
          );

          results.push({
            id: snippet.id,
            analysis: {
              summary: analysis.summary,
              overallScore: analysis.overall_score,
              issueCount: analysis.issues.length,
              criticalIssues: analysis.issues.filter(i => i.severity === 'critical').length
            }
          });
        } catch (error) {
          results.push({
            id: snippet.id,
            error: 'Analysis failed'
          });
        }
      }

      res.json({
        success: true,
        data: results
      });

    } catch (error) {
      logger.errorWithContext('Batch analysis failed', error, {
        userId: req.user._id
      });

      res.status(500).json({
        success: false,
        message: 'Batch analysis failed'
      });
    }
  }
);

module.exports = router; 