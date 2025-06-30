const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const config = require('../config/environment');

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

// Tell winston about the colors
winston.addColors(colors);

// Format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf((info) => {
    const { timestamp, level, message, ...meta } = info;
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    return `${timestamp} [${level}]: ${message} ${metaStr}`;
  })
);

// Format for file output
const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create transports
const transports = [
  // Console transport
  new winston.transports.Console({
    level: config.NODE_ENV === 'development' ? 'debug' : 'info',
    format: consoleFormat,
  }),
];

// Add file transports in production
if (config.NODE_ENV === 'production') {
  // Error log file
  transports.push(
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      format: fileFormat,
      maxSize: '10m',
      maxFiles: '30d',
      zippedArchive: true,
    })
  );

  // Combined log file
  transports.push(
    new DailyRotateFile({
      filename: 'logs/combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      format: fileFormat,
      maxSize: '10m',
      maxFiles: '30d',
      zippedArchive: true,
    })
  );

  // HTTP log file
  transports.push(
    new DailyRotateFile({
      filename: 'logs/http-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'http',
      format: fileFormat,
      maxSize: '10m',
      maxFiles: '7d',
      zippedArchive: true,
    })
  );
}

// Create the logger
const logger = winston.createLogger({
  level: config.MONITORING.LOG_LEVEL,
  levels,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports,
  exitOnError: false,
});

// Add request logging middleware
logger.httpMiddleware = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const { method, url, ip } = req;
    const { statusCode } = res;
    
    logger.http('HTTP Request', {
      method,
      url,
      statusCode,
      duration: `${duration}ms`,
      ip,
      userAgent: req.get('User-Agent'),
    });
  });
  
  next();
};

// Add performance logging
logger.performance = (operation, startTime, metadata = {}) => {
  const duration = Date.now() - startTime;
  logger.info(`Performance: ${operation}`, {
    operation,
    duration: `${duration}ms`,
    ...metadata,
  });
};

// Add error context logging
logger.errorWithContext = (message, error, context = {}) => {
  logger.error(message, {
    error: {
      message: error.message,
      stack: error.stack,
      name: error.name,
    },
    context,
  });
};

// Add metrics logging
logger.metrics = (metric, value, tags = {}) => {
  logger.info(`Metric: ${metric}`, {
    metric,
    value,
    tags,
    timestamp: new Date().toISOString(),
  });
};

// Add socket event logging
logger.socket = (event, data, socketId, roomId) => {
  logger.debug(`Socket Event: ${event}`, {
    event,
    socketId,
    roomId,
    data: typeof data === 'object' ? JSON.stringify(data) : data,
  });
};

// Add connection logging
logger.connection = (type, details) => {
  logger.info(`Connection: ${type}`, {
    type,
    ...details,
  });
};

// Create logs directory if it doesn't exist
const fs = require('fs');
const path = require('path');

if (config.NODE_ENV === 'production') {
  const logsDir = path.join(__dirname, '..', 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
}

module.exports = logger; 