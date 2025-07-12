const config = require('../config/environment');
const logger = require('./logger');
const redisService = require('./redis');

class AICodeReviewService {
  constructor() {
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    this.geminiApiKey = process.env.GEMINI_API_KEY;
    this.aiProvider = process.env.AI_PROVIDER || 'gemini'; // Default to free Gemini
    
    this.isEnabled = !!(this.openaiApiKey || this.geminiApiKey);
    this.reviewCache = new Map();
    this.maxCacheSize = 1000;
    this.rateLimitTracker = new Map();
  }

  // Initialize the AI service
  initialize() {
    if (!this.isEnabled) {
      logger.warn('AI Code Review service disabled - No API key provided (OPENAI_API_KEY or GEMINI_API_KEY)');
      return;
    }
    
    if (this.aiProvider === 'gemini' && this.geminiApiKey) {
      logger.info('AI Code Review service initialized with Gemini API (FREE)');
    } else if (this.aiProvider === 'openai' && this.openaiApiKey) {
      logger.info('AI Code Review service initialized with OpenAI API (PAID)');
    } else {
      // Auto-detect available provider
      if (this.geminiApiKey) {
        this.aiProvider = 'gemini';
        logger.info('AI Code Review service initialized with Gemini API (FREE) - auto-detected');
      } else if (this.openaiApiKey) {
        this.aiProvider = 'openai';
        logger.info('AI Code Review service initialized with OpenAI API (PAID) - auto-detected');
      }
    }
  }

  // Analyze code with AI
  async analyzeCode(code, language = 'javascript', options = {}) {
    if (!this.isEnabled) {
      throw new Error('AI Code Review service is not enabled');
    }

    const startTime = Date.now();
    
    try {
      // Check rate limits
      await this.checkRateLimit(options.userId);

      // Generate cache key
      const cacheKey = this.generateCacheKey(code, language, options);
      
      // Check cache first
      if (this.reviewCache.has(cacheKey)) {
        logger.debug('AI code review cache hit');
        return this.reviewCache.get(cacheKey);
      }

      // Prepare the AI prompt
      const prompt = this.buildAnalysisPrompt(code, language, options);
      
      // Call appropriate AI provider
      let aiResponse;
      if (this.aiProvider === 'gemini') {
        aiResponse = await this.callGeminiAPI(prompt);
      } else {
        aiResponse = await this.callOpenAI(prompt);
      }
      
      // Parse and structure the response
      const analysis = this.parseAIResponse(aiResponse, code, language);
      
      // Cache the result
      this.cacheResult(cacheKey, analysis);
      
      logger.performance('AI Code Analysis', startTime, {
        language,
        codeLength: code.length,
        issuesFound: analysis.issues.length,
        userId: options.userId
      });

      return analysis;
    } catch (error) {
      logger.errorWithContext('AI code analysis failed', error, {
        language,
        codeLength: code.length,
        userId: options.userId
      });
      throw error;
    }
  }

  // Build comprehensive analysis prompt
  buildAnalysisPrompt(code, language, options) {
    const analysisTypes = options.analysisTypes || [
      'bugs', 'security', 'performance', 'style', 'maintainability'
    ];

    const prompt = `
You are an expert code reviewer. Please analyze the following ${language} code and provide a comprehensive review.

ANALYSIS REQUIREMENTS:
${analysisTypes.map(type => `- ${type.toUpperCase()}: Check for ${type} issues`).join('\n')}

CODE TO REVIEW:
\`\`\`${language}
${code}
\`\`\`

Please provide your analysis in the following JSON format:
{
  "overall_score": 0-100,
  "summary": "Brief overview of code quality",
  "issues": [
    {
      "type": "bug|security|performance|style|maintainability",
      "severity": "critical|high|medium|low",
      "line": line_number,
      "column": column_number,
      "message": "Description of the issue",
      "suggestion": "How to fix it",
      "code_snippet": "relevant code snippet"
    }
  ],
  "positive_aspects": [
    "List of good practices found in the code"
  ],
  "recommendations": [
    "General recommendations for improvement"
  ],
  "complexity_analysis": {
    "cyclomatic_complexity": "estimate",
    "maintainability_index": "0-100",
    "technical_debt": "low|medium|high"
  }
}

Focus on providing actionable feedback that helps improve code quality.
`;

    return prompt;
  }

  // Call OpenAI API
  async callOpenAI(prompt) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // More cost-effective for code review
        messages: [
          {
            role: 'system',
            content: 'You are an expert code reviewer with deep knowledge of software engineering best practices, security vulnerabilities, and performance optimization.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1, // Low temperature for consistent analysis
        max_tokens: 2000,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  // Call Google Gemini API (FREE)
  async callGeminiAPI(prompt) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${this.geminiApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.1,
          topK: 1,
          topP: 1,
          maxOutputTokens: 2048,
        }
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Gemini API error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      throw new Error('Invalid response from Gemini API');
    }
    
    return data.candidates[0].content.parts[0].text;
  }

  // Parse AI response
  parseAIResponse(aiResponse, originalCode, language) {
    try {
      const analysis = JSON.parse(aiResponse);
      
      // Validate and sanitize the response
      const sanitizedAnalysis = {
        overall_score: Math.max(0, Math.min(100, analysis.overall_score || 0)),
        summary: analysis.summary || 'No summary provided',
        issues: (analysis.issues || []).map(issue => ({
          id: this.generateIssueId(),
          type: issue.type || 'general',
          severity: issue.severity || 'medium',
          line: Math.max(1, issue.line || 1),
          column: Math.max(0, issue.column || 0),
          message: issue.message || 'No message provided',
          suggestion: issue.suggestion || 'No suggestion provided',
          code_snippet: issue.code_snippet || '',
          timestamp: new Date().toISOString()
        })),
        positive_aspects: analysis.positive_aspects || [],
        recommendations: analysis.recommendations || [],
        complexity_analysis: {
          cyclomatic_complexity: analysis.complexity_analysis?.cyclomatic_complexity || 'unknown',
          maintainability_index: analysis.complexity_analysis?.maintainability_index || 0,
          technical_debt: analysis.complexity_analysis?.technical_debt || 'unknown'
        },
        metadata: {
          language,
          analyzed_at: new Date().toISOString(),
          code_length: originalCode.length,
          line_count: originalCode.split('\n').length
        }
      };

      return sanitizedAnalysis;
    } catch (error) {
      logger.error('Failed to parse AI response', { error: error.message });
      
      // Fallback analysis if parsing fails
      return {
        overall_score: 50,
        summary: 'Analysis completed with limited results due to parsing error',
        issues: [],
        positive_aspects: ['Code successfully analyzed'],
        recommendations: ['Consider manual code review'],
        complexity_analysis: {
          cyclomatic_complexity: 'unknown',
          maintainability_index: 50,
          technical_debt: 'unknown'
        },
        metadata: {
          language,
          analyzed_at: new Date().toISOString(),
          code_length: originalCode.length,
          line_count: originalCode.split('\n').length,
          parsing_error: true
        }
      };
    }
  }

  // Generate unique issue ID
  generateIssueId() {
    return `issue_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Cache management
  generateCacheKey(code, language, options) {
    const crypto = require('crypto');
    const key = `${code}_${language}_${JSON.stringify(options.analysisTypes || [])}`;
    return crypto.createHash('md5').update(key).digest('hex');
  }

  cacheResult(key, result) {
    // Implement LRU cache behavior
    if (this.reviewCache.size >= this.maxCacheSize) {
      const firstKey = this.reviewCache.keys().next().value;
      this.reviewCache.delete(firstKey);
    }
    
    this.reviewCache.set(key, result);
  }

  // Rate limiting
  async checkRateLimit(userId) {
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute window
    
    // More generous limits for free Gemini API
    const maxRequests = this.aiProvider === 'gemini' ? 15 : 10;
    
    if (!this.rateLimitTracker.has(userId)) {
      this.rateLimitTracker.set(userId, []);
    }
    
    const userRequests = this.rateLimitTracker.get(userId);
    const recentRequests = userRequests.filter(time => now - time < windowMs);
    
    if (recentRequests.length >= maxRequests) {
      const provider = this.aiProvider === 'gemini' ? 'Gemini (FREE)' : 'OpenAI';
      throw new Error(`Rate limit exceeded for ${provider}. Please wait before requesting another review.`);
    }
    
    recentRequests.push(now);
    this.rateLimitTracker.set(userId, recentRequests);
  }

  // Collaborative review features
  async createCollaborativeReview(roomId, code, language, authorId, options = {}) {
    try {
      // Generate the AI analysis
      const analysis = await this.analyzeCode(code, language, { ...options, userId: authorId });
      
      // Create review object
      const review = {
        id: this.generateReviewId(),
        roomId,
        authorId,
        code,
        language,
        analysis,
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        collaborators: [],
        comments: []
      };

      // Store in Redis for real-time access
      await redisService.setWithExpiration(
        `ai_review:${review.id}`, 
        JSON.stringify(review), 
        24 * 60 * 60 // 24 hours
      );

      // Add to room's review list
      await redisService.addToList(`room_reviews:${roomId}`, review.id);

      // Notify room participants
      await redisService.publishToRoom(roomId, 'ai_review_created', {
        reviewId: review.id,
        authorId,
        summary: analysis.summary,
        issueCount: analysis.issues.length,
        overallScore: analysis.overall_score
      });

      logger.info('AI collaborative review created', {
        reviewId: review.id,
        roomId,
        authorId,
        issueCount: analysis.issues.length
      });

      return review;
    } catch (error) {
      logger.errorWithContext('Failed to create collaborative review', error, {
        roomId,
        authorId,
        language
      });
      throw error;
    }
  }

  // Get review by ID
  async getReview(reviewId) {
    try {
      const reviewData = await redisService.get(`ai_review:${reviewId}`);
      return reviewData ? JSON.parse(reviewData) : null;
    } catch (error) {
      logger.errorWithContext('Failed to get review', error, { reviewId });
      return null;
    }
  }

  // Add comment to review
  async addReviewComment(reviewId, userId, comment, lineNumber = null) {
    try {
      const review = await this.getReview(reviewId);
      if (!review) {
        throw new Error('Review not found');
      }

      const newComment = {
        id: this.generateCommentId(),
        userId,
        comment,
        lineNumber,
        timestamp: new Date().toISOString()
      };

      review.comments.push(newComment);
      review.updated_at = new Date().toISOString();

      // Update in Redis
      await redisService.setWithExpiration(
        `ai_review:${reviewId}`, 
        JSON.stringify(review), 
        24 * 60 * 60
      );

      // Notify room participants
      await redisService.publishToRoom(review.roomId, 'review_comment_added', {
        reviewId,
        comment: newComment
      });

      return newComment;
    } catch (error) {
      logger.errorWithContext('Failed to add review comment', error, {
        reviewId,
        userId
      });
      throw error;
    }
  }

  // Get room reviews
  async getRoomReviews(roomId, limit = 10) {
    try {
      const reviewIds = await redisService.getList(`room_reviews:${roomId}`, 0, limit - 1);
      const reviews = [];

      for (const reviewId of reviewIds) {
        const review = await this.getReview(reviewId);
        if (review) {
          reviews.push(review);
        }
      }

      return reviews.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } catch (error) {
      logger.errorWithContext('Failed to get room reviews', error, { roomId });
      return [];
    }
  }

  // Helper methods
  generateReviewId() {
    return `review_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  generateCommentId() {
    return `comment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Get service metrics
  getMetrics() {
    return {
      isEnabled: this.isEnabled,
      provider: this.aiProvider,
      isFree: this.aiProvider === 'gemini',
      cacheSize: this.reviewCache.size,
      rateLimitTrackers: this.rateLimitTracker.size,
      totalRequests: Array.from(this.rateLimitTracker.values())
        .reduce((sum, requests) => sum + requests.length, 0)
    };
  }

  // Cleanup old cache entries
  cleanup() {
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1 hour
    
    // Clean up rate limit tracker
    for (const [userId, requests] of this.rateLimitTracker.entries()) {
      const recentRequests = requests.filter(time => now - time < maxAge);
      if (recentRequests.length === 0) {
        this.rateLimitTracker.delete(userId);
      } else {
        this.rateLimitTracker.set(userId, recentRequests);
      }
    }
  }
}

module.exports = new AICodeReviewService(); 