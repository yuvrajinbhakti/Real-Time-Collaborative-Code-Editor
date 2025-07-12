const jwt = require('jsonwebtoken');
const { promisify } = require('util');
const User = require('../models/User');
const logger = require('../services/logger');
const crypto = require('crypto');

// Authenticate user with JWT
const authenticate = async (req, res, next) => {
  try {
    // 1) Get token from various sources
    let token;
    
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.jwt) {
      token = req.cookies.jwt;
    } else if (req.headers['x-auth-token']) {
      token = req.headers['x-auth-token'];
    }
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }
    
    // 2) Verify token
    const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);
    
    // 3) Check if user still exists
    const currentUser = await User.findById(decoded.id)
      .select('+password +twoFactorEnabled +twoFactorSecret +loginAttempts +lockUntil');
    
    if (!currentUser) {
      logger.audit('AUTH_TOKEN_INVALID_USER', {
        userId: decoded.id,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      return res.status(401).json({
        success: false,
        message: 'User no longer exists'
      });
    }
    
    // 4) Check if user is active and not blocked
    if (!currentUser.isActive || currentUser.isBlocked) {
      logger.audit('AUTH_BLOCKED_USER_ACCESS', {
        userId: currentUser._id,
        reason: currentUser.blockedReason,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      return res.status(403).json({
        success: false,
        message: 'Account is blocked or inactive'
      });
    }
    
    // 5) Check if user is locked due to failed login attempts
    if (currentUser.isLocked) {
      logger.audit('AUTH_LOCKED_USER_ACCESS', {
        userId: currentUser._id,
        lockUntil: currentUser.lockUntil,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      return res.status(423).json({
        success: false,
        message: 'Account is temporarily locked due to failed login attempts'
      });
    }
    
    // 6) Check if user changed password after token was issued
    if (currentUser.changedPasswordAfter(decoded.iat)) {
      logger.audit('AUTH_PASSWORD_CHANGED_AFTER_TOKEN', {
        userId: currentUser._id,
        tokenIat: decoded.iat,
        passwordChangedAt: currentUser.passwordChangedAt,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      return res.status(401).json({
        success: false,
        message: 'Password changed recently. Please log in again'
      });
    }
    
    // 7) Check if email is verified for critical operations
    if (!currentUser.isEmailVerified && req.baseUrl?.includes('/api/rooms')) {
      return res.status(403).json({
        success: false,
        message: 'Email verification required for room operations'
      });
    }
    
    // 8) Track IP address
    currentUser.trackIPAddress(req.ip);
    await currentUser.save({ validateBeforeSave: false });
    
    // 9) Set user in request
    req.user = currentUser;
    
    // 10) Log successful authentication
    logger.audit('AUTH_SUCCESS', {
      userId: currentUser._id,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      endpoint: req.originalUrl
    });
    
    next();
    
  } catch (error) {
    logger.errorWithContext('Authentication error', error, {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      endpoint: req.originalUrl
    });
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired'
      });
    }
    
    return res.status(500).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};

// Optional authentication (for public/private rooms)
const optionalAuth = async (req, res, next) => {
  try {
    let token;
    
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.jwt) {
      token = req.cookies.jwt;
    }
    
    if (!token) {
      req.user = null;
      return next();
    }
    
    const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);
    const currentUser = await User.findById(decoded.id);
    
    if (currentUser && currentUser.isActive && !currentUser.isBlocked) {
      req.user = currentUser;
    } else {
      req.user = null;
    }
    
    next();
    
  } catch (error) {
    req.user = null;
    next();
  }
};

// Two-factor authentication middleware
const require2FA = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    if (!req.user.twoFactorEnabled) {
      return next();
    }
    
    const token = req.headers['x-2fa-token'] || req.body.twoFactorToken;
    
    if (!token) {
      return res.status(402).json({
        success: false,
        message: 'Two-factor authentication required',
        requires2FA: true
      });
    }
    
    const isValid = req.user.verifyTwoFactor(token);
    
    if (!isValid) {
      logger.audit('2FA_INVALID_TOKEN', {
        userId: req.user._id,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      return res.status(401).json({
        success: false,
        message: 'Invalid two-factor authentication token'
      });
    }
    
    logger.audit('2FA_SUCCESS', {
      userId: req.user._id,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    next();
    
  } catch (error) {
    logger.errorWithContext('2FA verification error', error, {
      userId: req.user?._id,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    return res.status(500).json({
      success: false,
      message: 'Two-factor authentication failed'
    });
  }
};

// Authorization middleware for different roles
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    if (!roles.includes(req.user.plan)) {
      logger.audit('AUTHORIZATION_FAILED', {
        userId: req.user._id,
        userPlan: req.user.plan,
        requiredRoles: roles,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        endpoint: req.originalUrl
      });
      
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions'
      });
    }
    
    next();
  };
};

// Room-specific authorization
const authorizeRoom = (action) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }
      
      const roomId = req.params.roomId || req.body.roomId;
      
      if (!roomId) {
        return res.status(400).json({
          success: false,
          message: 'Room ID required'
        });
      }
      
      const Room = require('../models/Room');
      const room = await Room.findByRoomId(roomId);
      
      if (!room) {
        return res.status(404).json({
          success: false,
          message: 'Room not found'
        });
      }
      
      // Check if user has permission to perform the action
      const hasPermission = room.canUserPerformAction(req.user._id, action);
      
      if (!hasPermission) {
        logger.audit('ROOM_AUTHORIZATION_FAILED', {
          userId: req.user._id,
          roomId: roomId,
          action: action,
          ip: req.ip,
          userAgent: req.get('User-Agent')
        });
        
        return res.status(403).json({
          success: false,
          message: `Insufficient permissions to ${action} in this room`
        });
      }
      
      req.room = room;
      next();
      
    } catch (error) {
      logger.errorWithContext('Room authorization error', error, {
        userId: req.user?._id,
        roomId: req.params.roomId || req.body.roomId,
        action: action,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      return res.status(500).json({
        success: false,
        message: 'Authorization failed'
      });
    }
  };
};

// Rate limiting per user
const userRateLimit = (maxRequests = 100, windowMs = 60 * 1000) => {
  const attempts = new Map();
  
  return (req, res, next) => {
    const userId = req.user?._id?.toString() || req.ip;
    const now = Date.now();
    const windowStart = now - windowMs;
    
    if (!attempts.has(userId)) {
      attempts.set(userId, []);
    }
    
    const userAttempts = attempts.get(userId);
    
    // Remove old attempts
    const recentAttempts = userAttempts.filter(time => time > windowStart);
    attempts.set(userId, recentAttempts);
    
    if (recentAttempts.length >= maxRequests) {
      logger.audit('RATE_LIMIT_EXCEEDED', {
        userId: req.user?._id,
        ip: req.ip,
        endpoint: req.originalUrl,
        attempts: recentAttempts.length,
        maxRequests
      });
      
      return res.status(429).json({
        success: false,
        message: 'Rate limit exceeded',
        retryAfter: Math.ceil(windowMs / 1000)
      });
    }
    
    recentAttempts.push(now);
    next();
  };
};

// Device fingerprinting and suspicious activity detection
const deviceFingerprint = (req, res, next) => {
  try {
    const fingerprint = crypto.createHash('sha256')
      .update(JSON.stringify({
        userAgent: req.get('User-Agent'),
        acceptLanguage: req.get('Accept-Language'),
        acceptEncoding: req.get('Accept-Encoding'),
        connection: req.get('Connection'),
        upgrade: req.get('Upgrade-Insecure-Requests'),
        dnt: req.get('DNT'),
        ip: req.ip
      }))
      .digest('hex');
    
    req.deviceFingerprint = fingerprint;
    
    // Check for suspicious patterns
    const suspiciousPatterns = [
      /bot|crawler|spider|scraper|headless/i,
      /curl|wget|python-requests|postman/i,
      /scanner|security|penetration|test/i
    ];
    
    const userAgent = req.get('User-Agent') || '';
    const isSuspicious = suspiciousPatterns.some(pattern => pattern.test(userAgent));
    
    if (isSuspicious) {
      logger.audit('SUSPICIOUS_DEVICE_DETECTED', {
        userId: req.user?._id,
        ip: req.ip,
        userAgent: userAgent,
        fingerprint: fingerprint,
        endpoint: req.originalUrl
      });
      
      // Don't block immediately, but flag for monitoring
      req.suspiciousDevice = true;
    }
    
    next();
    
  } catch (error) {
    logger.errorWithContext('Device fingerprinting error', error, {
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    next();
  }
};

// Session management
const requireValidSession = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    const sessionId = req.headers['x-session-id'] || req.cookies.sessionId;
    
    if (!sessionId) {
      return res.status(401).json({
        success: false,
        message: 'Session ID required'
      });
    }
    
    const redisService = require('../services/redis');
    const sessionData = await redisService.getSession(sessionId);
    
    if (!sessionData || sessionData.userId !== req.user._id.toString()) {
      logger.audit('INVALID_SESSION', {
        userId: req.user._id,
        sessionId: sessionId,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired session'
      });
    }
    
    // Update session activity
    await redisService.updateSession(sessionId, {
      lastActivity: Date.now(),
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    req.session = sessionData;
    next();
    
  } catch (error) {
    logger.errorWithContext('Session validation error', error, {
      userId: req.user?._id,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    return res.status(500).json({
      success: false,
      message: 'Session validation failed'
    });
  }
};

// Audit logging middleware
const auditAction = (action) => {
  return (req, res, next) => {
    const originalSend = res.send;
    
    res.send = function(body) {
      // Log the action after response
      const success = res.statusCode < 400;
      
      logger.audit(action, {
        userId: req.user?._id,
        success: success,
        statusCode: res.statusCode,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        endpoint: req.originalUrl,
        method: req.method,
        body: req.body,
        params: req.params,
        query: req.query
      });
      
      originalSend.call(this, body);
    };
    
    next();
  };
};

module.exports = {
  authenticate,
  optionalAuth,
  require2FA,
  authorize,
  authorizeRoom,
  userRateLimit,
  deviceFingerprint,
  requireValidSession,
  auditAction
}; 