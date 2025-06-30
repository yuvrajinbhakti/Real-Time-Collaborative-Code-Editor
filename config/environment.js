require('dotenv').config();

const config = {
  // Application Configuration
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT) || 5000,
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:3000',

  // Redis Configuration
  REDIS: {
    URL: process.env.REDIS_URL || 'redis://localhost:6379',
    HOST: process.env.REDIS_HOST || 'localhost',
    PORT: parseInt(process.env.REDIS_PORT) || 6379,
    PASSWORD: process.env.REDIS_PASSWORD || '',
    DB: parseInt(process.env.REDIS_DB) || 0,
  },

  // Performance Configuration
  PERFORMANCE: {
    MAX_CONCURRENT_USERS: parseInt(process.env.MAX_CONCURRENT_USERS) || 1000,
    RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
    RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    DEBOUNCE_DELAY_MS: parseInt(process.env.DEBOUNCE_DELAY_MS) || 50,
  },

  // Monitoring Configuration
  MONITORING: {
    METRICS_PORT: parseInt(process.env.METRICS_PORT) || 9090,
    ENABLE_METRICS: process.env.ENABLE_METRICS === 'true',
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    ENABLE_HEALTH_CHECKS: process.env.ENABLE_HEALTH_CHECKS !== 'false',
    HEALTH_CHECK_INTERVAL: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 30000,
  },

  // Operational Transform Configuration
  OT: {
    ENABLE_OT: process.env.ENABLE_OT !== 'false',
    CONFLICT_RESOLUTION: process.env.OT_CONFLICT_RESOLUTION !== 'false',
    MAX_OPERATION_QUEUE_SIZE: parseInt(process.env.MAX_OPERATION_QUEUE_SIZE) || 1000,
  },

  // Security Configuration
  SECURITY: {
    CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:3000',
    HELMET_ENABLED: process.env.HELMET_ENABLED !== 'false',
    RATE_LIMITING_ENABLED: process.env.RATE_LIMITING_ENABLED !== 'false',
  },
};

module.exports = config; 