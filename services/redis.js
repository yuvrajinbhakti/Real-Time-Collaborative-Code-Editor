const Redis = require('ioredis');
const config = require('../config/environment');
const logger = require('./logger');

class RedisService {
  constructor() {
    this.publisher = null;
    this.subscriber = null;
    this.client = null;
    this.isConnected = false;
    this.connectionAttempts = 0;
    this.maxRetries = 5;
  }

  async connect() {
    try {
      const redisConfig = {
        host: config.REDIS.HOST,
        port: config.REDIS.PORT,
        password: config.REDIS.PASSWORD || undefined,
        db: config.REDIS.DB,
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        keepAlive: 30000,
        connectTimeout: 10000,
        commandTimeout: 5000,
      };

      // Create Redis clients
      this.client = new Redis(redisConfig);
      this.publisher = new Redis(redisConfig);
      this.subscriber = new Redis(redisConfig);

      // Connection event handlers
      this.client.on('connect', () => {
        logger.info('Redis client connected');
        this.isConnected = true;
        this.connectionAttempts = 0;
      });

      this.client.on('error', (error) => {
        logger.error('Redis client error:', error);
        this.handleConnectionError();
      });

      this.publisher.on('error', (error) => {
        logger.error('Redis publisher error:', error);
      });

      this.subscriber.on('error', (error) => {
        logger.error('Redis subscriber error:', error);
      });

      // Connect all clients
      await Promise.all([
        this.client.connect(),
        this.publisher.connect(),
        this.subscriber.connect()
      ]);

      logger.info('Redis service initialized successfully');
      return true;
    } catch (error) {
      logger.error('Failed to connect to Redis:', error);
      this.handleConnectionError();
      return false;
    }
  }

  async handleConnectionError() {
    this.isConnected = false;
    this.connectionAttempts++;

    if (this.connectionAttempts <= this.maxRetries) {
      const delay = Math.pow(2, this.connectionAttempts) * 1000; // Exponential backoff
      logger.warn(`Retrying Redis connection in ${delay}ms (attempt ${this.connectionAttempts}/${this.maxRetries})`);
      
      setTimeout(() => {
        this.connect();
      }, delay);
    } else {
      logger.error('Max Redis connection retries exceeded');
    }
  }

  // Pub/Sub methods for room-based messaging
  async publishToRoom(roomId, event, data) {
    if (!this.isConnected || !this.publisher) {
      logger.warn('Redis not connected, skipping publish');
      return false;
    }

    try {
      const message = JSON.stringify({
        event,
        data,
        timestamp: Date.now(),
        roomId
      });

      await this.publisher.publish(`room:${roomId}`, message);
      logger.debug(`Published to room:${roomId}`, { event, data });
      return true;
    } catch (error) {
      logger.error('Failed to publish message:', error);
      return false;
    }
  }

  async subscribeToRoom(roomId, callback) {
    if (!this.isConnected || !this.subscriber) {
      logger.warn('Redis not connected, cannot subscribe');
      return false;
    }

    try {
      await this.subscriber.subscribe(`room:${roomId}`);
      
      this.subscriber.on('message', (channel, message) => {
        if (channel === `room:${roomId}`) {
          try {
            const parsedMessage = JSON.parse(message);
            callback(parsedMessage);
          } catch (error) {
            logger.error('Failed to parse Redis message:', error);
          }
        }
      });

      logger.debug(`Subscribed to room:${roomId}`);
      return true;
    } catch (error) {
      logger.error('Failed to subscribe to room:', error);
      return false;
    }
  }

  async unsubscribeFromRoom(roomId) {
    if (!this.subscriber) return false;

    try {
      await this.subscriber.unsubscribe(`room:${roomId}`);
      logger.debug(`Unsubscribed from room:${roomId}`);
      return true;
    } catch (error) {
      logger.error('Failed to unsubscribe from room:', error);
      return false;
    }
  }

  // Key-value operations for session management
  async setUserSession(userId, sessionData, ttl = 3600) {
    if (!this.client) return false;

    try {
      await this.client.setex(`user:${userId}`, ttl, JSON.stringify(sessionData));
      return true;
    } catch (error) {
      logger.error('Failed to set user session:', error);
      return false;
    }
  }

  async getUserSession(userId) {
    if (!this.client) return null;

    try {
      const data = await this.client.get(`user:${userId}`);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error('Failed to get user session:', error);
      return null;
    }
  }

  async deleteUserSession(userId) {
    if (!this.client) return false;

    try {
      await this.client.del(`user:${userId}`);
      return true;
    } catch (error) {
      logger.error('Failed to delete user session:', error);
      return false;
    }
  }

  // Room management
  async addUserToRoom(roomId, userId, userData) {
    if (!this.client) return false;

    try {
      await this.client.hset(`room:${roomId}:users`, userId, JSON.stringify(userData));
      await this.client.sadd(`user:${userId}:rooms`, roomId);
      return true;
    } catch (error) {
      logger.error('Failed to add user to room:', error);
      return false;
    }
  }

  async removeUserFromRoom(roomId, userId) {
    if (!this.client) return false;

    try {
      await this.client.hdel(`room:${roomId}:users`, userId);
      await this.client.srem(`user:${userId}:rooms`, roomId);
      return true;
    } catch (error) {
      logger.error('Failed to remove user from room:', error);
      return false;
    }
  }

  async getRoomUsers(roomId) {
    if (!this.client) return [];

    try {
      const users = await this.client.hgetall(`room:${roomId}:users`);
      return Object.entries(users).map(([userId, userData]) => ({
        userId,
        ...JSON.parse(userData)
      }));
    } catch (error) {
      logger.error('Failed to get room users:', error);
      return [];
    }
  }

  // Health check
  async healthCheck() {
    if (!this.client) return false;

    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      logger.error('Redis health check failed:', error);
      return false;
    }
  }

  // Set with expiration
  async setWithExpiration(key, value, expireInSeconds) {
    if (!this.client) return false;
    
    try {
      await this.client.setex(key, expireInSeconds, value);
      return true;
    } catch (error) {
      logger.error('Redis setWithExpiration failed:', error);
      return false;
    }
  }

  // Get value
  async get(key) {
    if (!this.client) return null;
    
    try {
      return await this.client.get(key);
    } catch (error) {
      logger.error('Redis get failed:', error);
      return null;
    }
  }

  // Add to list
  async addToList(key, value) {
    if (!this.client) return false;
    
    try {
      await this.client.lpush(key, value);
      return true;
    } catch (error) {
      logger.error('Redis addToList failed:', error);
      return false;
    }
  }

  // Get list range
  async getList(key, start = 0, end = -1) {
    if (!this.client) return [];
    
    try {
      return await this.client.lrange(key, start, end);
    } catch (error) {
      logger.error('Redis getList failed:', error);
      return [];
    }
  }

  // Metrics
  async getMetrics() {
    if (!this.client) return null;

    try {
      const info = await this.client.info();
      const memory = await this.client.info('memory');
      
      return {
        connected: this.isConnected,
        connectionAttempts: this.connectionAttempts,
        info,
        memory
      };
    } catch (error) {
      logger.error('Failed to get Redis metrics:', error);
      return null;
    }
  }

  async disconnect() {
    try {
      if (this.client) await this.client.disconnect();
      if (this.publisher) await this.publisher.disconnect();
      if (this.subscriber) await this.subscriber.disconnect();
      
      this.isConnected = false;
      logger.info('Redis service disconnected');
    } catch (error) {
      logger.error('Error disconnecting Redis:', error);
    }
  }
}

module.exports = new RedisService(); 