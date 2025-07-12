const Joi = require('joi');
const xss = require('xss');
const logger = require('../services/logger');

// Custom validation patterns
const patterns = {
  username: /^[a-zA-Z0-9_-]{3,30}$/,
  password: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
  roomId: /^[a-zA-Z0-9-_]{8,50}$/,
  fileName: /^[a-zA-Z0-9._-]+\.[a-zA-Z0-9]+$/,
  filePath: /^[a-zA-Z0-9._/-]+$/,
  mongoId: /^[0-9a-fA-F]{24}$/
};

// Validation schemas
const schemas = {
  userRegistration: Joi.object({
    username: Joi.string()
      .pattern(patterns.username)
      .min(3)
      .max(30)
      .required(),
    email: Joi.string()
      .email()
      .required(),
    password: Joi.string()
      .pattern(patterns.password)
      .min(8)
      .max(128)
      .required(),
    confirmPassword: Joi.string()
      .valid(Joi.ref('password'))
      .required(),
    displayName: Joi.string()
      .min(1)
      .max(50)
      .required()
  }),

  userLogin: Joi.object({
    email: Joi.string()
      .email()
      .required(),
    password: Joi.string()
      .min(8)
      .max(128)
      .required(),
    twoFactorToken: Joi.string()
      .length(6)
      .pattern(/^[0-9]{6}$/)
      .optional()
  }),

  roomCreate: Joi.object({
    name: Joi.string()
      .min(1)
      .max(100)
      .required(),
    description: Joi.string()
      .max(500)
      .allow('')
      .optional(),
    visibility: Joi.string()
      .valid('public', 'private', 'unlisted')
      .default('private'),
    projectType: Joi.string()
      .valid('single-file', 'multi-file', 'git-repo')
      .default('single-file'),
    language: Joi.string()
      .min(2)
      .max(20)
      .default('javascript')
  }),

  fileCreate: Joi.object({
    name: Joi.string()
      .pattern(patterns.fileName)
      .min(1)
      .max(100)
      .required(),
    path: Joi.string()
      .pattern(patterns.filePath)
      .min(1)
      .max(200)
      .required(),
    content: Joi.string()
      .max(1024 * 1024)
      .allow('')
      .optional(),
    language: Joi.string()
      .min(2)
      .max(20)
      .default('javascript')
  }),

  codeExecute: Joi.object({
    code: Joi.string()
      .max(100000)
      .required(),
    language: Joi.string()
      .valid('javascript', 'python', 'java', 'cpp', 'go', 'rust')
      .required(),
    input: Joi.string()
      .max(10000)
      .allow('')
      .optional(),
    timeout: Joi.number()
      .min(1)
      .max(30)
      .default(10)
  }),

  commentCreate: Joi.object({
    content: Joi.string()
      .min(1)
      .max(1000)
      .required(),
    file: Joi.string()
      .pattern(patterns.filePath)
      .required(),
    line: Joi.number()
      .min(1)
      .required(),
    column: Joi.number()
      .min(0)
      .optional()
  }),

  chatMessage: Joi.object({
    message: Joi.string()
      .min(1)
      .max(500)
      .required(),
    type: Joi.string()
      .valid('text', 'code', 'file')
      .default('text')
  }),

  aiCodeReview: Joi.object({
    roomId: Joi.string()
      .pattern(patterns.roomId)
      .required(),
    code: Joi.string()
      .min(1)
      .max(50000)
      .required(),
    language: Joi.string()
      .valid('javascript', 'typescript', 'python', 'java', 'cpp', 'c', 'html', 'css', 'json', 'xml', 'sql', 'php', 'ruby', 'go', 'rust', 'swift', 'kotlin', 'dart', 'scala', 'r', 'matlab', 'shell', 'powershell')
      .default('javascript'),
    analysisTypes: Joi.array()
      .items(Joi.string().valid('bugs', 'security', 'performance', 'style', 'maintainability', 'complexity', 'documentation'))
      .default(['bugs', 'security', 'performance', 'style', 'maintainability'])
  }),

  quickAnalysis: Joi.object({
    code: Joi.string()
      .min(1)
      .max(10000)
      .required(),
    language: Joi.string()
      .valid('javascript', 'typescript', 'python', 'java', 'cpp', 'c', 'html', 'css', 'json', 'xml', 'sql', 'php', 'ruby', 'go', 'rust', 'swift', 'kotlin', 'dart', 'scala', 'r', 'matlab', 'shell', 'powershell')
      .default('javascript'),
    analysisTypes: Joi.array()
      .items(Joi.string().valid('bugs', 'security', 'performance', 'style', 'maintainability', 'complexity', 'documentation'))
      .default(['bugs', 'security', 'performance', 'style', 'maintainability'])
  }),

  reviewComment: Joi.object({
    comment: Joi.string()
      .min(1)
      .max(1000)
      .required(),
    lineNumber: Joi.number()
      .min(1)
      .optional()
  })
};

// Sanitization functions
const sanitize = {
  html: (input) => {
    if (typeof input !== 'string') return input;
    
    return xss(input, {
      whiteList: {},
      stripIgnoreTag: true,
      stripIgnoreTagBody: ['script', 'style', 'iframe', 'object', 'embed']
    });
  },

  code: (input) => {
    if (typeof input !== 'string') return input;
    
    const dangerousPatterns = [
      /<\?php.*?\?>/gi,
      /<script.*?>.*?<\/script>/gi,
      /<%.*?%>/gi,
      /;\s*(drop|delete|truncate|alter|create|insert|update)\s+/gi,
      /\.\.[\/\\]/g
    ];
    
    let sanitized = input;
    dangerousPatterns.forEach(pattern => {
      sanitized = sanitized.replace(pattern, '/* POTENTIALLY_DANGEROUS_CODE_REMOVED */');
    });
    
    return sanitized;
  },

  fileName: (input) => {
    if (typeof input !== 'string') return input;
    
    return input
      .replace(/[<>:"|?*\x00-\x1f]/g, '')
      .replace(/\.\./g, '')
      .replace(/^\./, '')
      .trim()
      .substring(0, 100);
  },

  chatMessage: (input) => {
    if (typeof input !== 'string') return input;
    
    return xss(input, {
      whiteList: {
        b: [],
        i: [],
        u: [],
        strong: [],
        em: [],
        code: [],
        pre: []
      }
    });
  }
};

// Validation middleware factory
const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    try {
      const data = req[source];
      const { error, value } = schema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
        allowUnknown: false
      });
      
      if (error) {
        const validationErrors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          value: detail.context?.value
        }));
        
        logger.audit && logger.audit('VALIDATION_ERROR', {
          userId: req.user?._id,
          endpoint: req.originalUrl,
          method: req.method,
          errors: validationErrors,
          ip: req.ip,
          userAgent: req.get('User-Agent')
        });
        
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: validationErrors
        });
      }
      
      req[source] = value;
      next();
      
    } catch (err) {
      logger.errorWithContext && logger.errorWithContext('Validation middleware error', err, {
        userId: req.user?._id,
        endpoint: req.originalUrl,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      return res.status(500).json({
        success: false,
        message: 'Validation processing failed'
      });
    }
  };
};

// Sanitization middleware
const sanitizeInput = (fields = []) => {
  return (req, res, next) => {
    try {
      const sanitizeRecursive = (obj, path = '') => {
        if (typeof obj === 'string') {
          if (path.includes('code') || path.includes('content')) {
            return sanitize.code(obj);
          } else if (path.includes('fileName') || path.includes('name')) {
            return sanitize.fileName(obj);
          } else if (path.includes('message') || path.includes('chat')) {
            return sanitize.chatMessage(obj);
          } else {
            return sanitize.html(obj);
          }
        }
        
        if (Array.isArray(obj)) {
          return obj.map((item, index) => sanitizeRecursive(item, `${path}[${index}]`));
        }
        
        if (obj && typeof obj === 'object') {
          const sanitized = {};
          for (const [key, value] of Object.entries(obj)) {
            sanitized[key] = sanitizeRecursive(value, path ? `${path}.${key}` : key);
          }
          return sanitized;
        }
        
        return obj;
      };
      
      if (fields.length > 0) {
        fields.forEach(field => {
          if (req.body[field] !== undefined) {
            req.body[field] = sanitizeRecursive(req.body[field], field);
          }
        });
      } else {
        req.body = sanitizeRecursive(req.body);
      }
      
      next();
      
    } catch (err) {
      logger.errorWithContext && logger.errorWithContext('Sanitization middleware error', err, {
        userId: req.user?._id,
        endpoint: req.originalUrl,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      return res.status(500).json({
        success: false,
        message: 'Input sanitization failed'
      });
    }
  };
};

module.exports = {
  schemas,
  validate,
  sanitize,
  sanitizeInput,
  patterns
};
