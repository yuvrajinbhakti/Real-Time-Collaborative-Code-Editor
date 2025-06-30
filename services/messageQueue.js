const Bull = require('bull');
const config = require('../config/environment');
const logger = require('./logger');
const otService = require('./operationalTransform');
const redisService = require('./redis');

class MessageQueueService {
  constructor() {
    this.queues = new Map();
    this.processors = new Map();
    this.isInitialized = false;
  }

  // Initialize message queue system
  async initialize() {
    try {
      // Initialize Redis connection first
      const redisConnected = await redisService.connect();
      if (!redisConnected) {
        throw new Error('Redis connection required for message queue');
      }

      // Create queues
      this.createQueues();
      
      // Register processors
      this.registerProcessors();
      
      // Setup queue monitoring
      this.setupQueueMonitoring();
      
      this.isInitialized = true;
      logger.info('Message queue service initialized');
    } catch (error) {
      logger.errorWithContext('Failed to initialize message queue service', error);
      throw error;
    }
  }

  // Create all necessary queues
  createQueues() {
    const redisConfig = {
      host: config.REDIS.HOST,
      port: config.REDIS.PORT,
      password: config.REDIS.PASSWORD || undefined,
      db: config.REDIS.DB,
    };

    // Operation processing queue
    this.queues.set('operations', new Bull('operation processing', {
      redis: redisConfig,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    }));

    // Room management queue
    this.queues.set('rooms', new Bull('room management', {
      redis: redisConfig,
      defaultJobOptions: {
        removeOnComplete: 50,
        removeOnFail: 25,
        attempts: 2,
        backoff: {
          type: 'fixed',
          delay: 1000,
        },
      },
    }));

    // Cleanup queue for background tasks
    this.queues.set('cleanup', new Bull('cleanup tasks', {
      redis: redisConfig,
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 10,
        attempts: 1,
      },
    }));

    // Metrics collection queue
    this.queues.set('metrics', new Bull('metrics collection', {
      redis: redisConfig,
      defaultJobOptions: {
        removeOnComplete: 20,
        removeOnFail: 5,
        attempts: 1,
      },
    }));

    logger.info(`Created ${this.queues.size} message queues`);
  }

  // Register job processors
  registerProcessors() {
    // Operation processing
    this.processors.set('processOperation', async (job) => {
      const { roomId, operation, authorId, socketId } = job.data;
      const startTime = Date.now();
      
      try {
        logger.debug(`Processing operation for room ${roomId}`, {
          operation: operation.type,
          authorId,
          socketId
        });

        // Apply operational transformation
        const result = otService.applyOperation(roomId, operation, authorId);
        
        if (result.success) {
          // Publish to Redis for other server instances
          await redisService.publishToRoom(roomId, 'operation_applied', {
            operation: result.operation,
            content: result.content,
            version: result.version,
            authorId,
            socketId
          });

          logger.performance('Process Operation', startTime, {
            roomId,
            operation: operation.type,
            version: result.version
          });

          return result;
        } else {
          throw new Error(result.error);
        }
      } catch (error) {
        logger.errorWithContext('Failed to process operation', error, {
          roomId,
          operation,
          authorId
        });
        throw error;
      }
    });

    // Room management
    this.processors.set('manageRoom', async (job) => {
      const { action, roomId, userId, userData } = job.data;
      
      try {
        switch (action) {
          case 'join':
            await redisService.addUserToRoom(roomId, userId, userData);
            await redisService.publishToRoom(roomId, 'user_joined', {
              userId,
              userData
            });
            break;
            
          case 'leave':
            await redisService.removeUserFromRoom(roomId, userId);
            await redisService.publishToRoom(roomId, 'user_left', {
              userId
            });
            break;
            
          case 'sync':
            const roomUsers = await redisService.getRoomUsers(roomId);
            const docState = otService.getDocumentState(roomId);
            return {
              users: roomUsers,
              document: docState
            };
            
          default:
            throw new Error(`Unknown room action: ${action}`);
        }
        
        logger.debug(`Room management: ${action}`, { roomId, userId });
      } catch (error) {
        logger.errorWithContext('Failed to manage room', error, {
          action,
          roomId,
          userId
        });
        throw error;
      }
    });

    // Cleanup tasks
    this.processors.set('cleanup', async (job) => {
      const { type } = job.data;
      
      try {
        switch (type) {
          case 'operations':
            otService.cleanup();
            break;
            
          case 'sessions':
            // Clean up expired user sessions
            // This would need additional implementation
            break;
            
          case 'logs':
            // Clean up old log files
            // This would need additional implementation
            break;
            
          default:
            logger.warn(`Unknown cleanup type: ${type}`);
        }
        
        logger.info(`Cleanup completed: ${type}`);
      } catch (error) {
        logger.errorWithContext('Cleanup failed', error, { type });
        throw error;
      }
    });

    // Metrics collection
    this.processors.set('collectMetrics', async (job) => {
      const { timestamp } = job.data;
      
      try {
        const metrics = {
          timestamp,
          system: {
            memory: process.memoryUsage(),
            cpu: process.cpuUsage(),
            uptime: process.uptime()
          },
          redis: await redisService.getMetrics(),
          ot: otService.getMetrics(),
          queues: this.getQueueMetrics()
        };
        
        logger.metrics('system_metrics', metrics);
        return metrics;
      } catch (error) {
        logger.errorWithContext('Failed to collect metrics', error);
        throw error;
      }
    });

    // Register processors with queues
    this.queues.get('operations').process('processOperation', 10, this.processors.get('processOperation'));
    this.queues.get('rooms').process('manageRoom', 5, this.processors.get('manageRoom'));
    this.queues.get('cleanup').process('cleanup', 1, this.processors.get('cleanup'));
    this.queues.get('metrics').process('collectMetrics', 1, this.processors.get('collectMetrics'));

    logger.info(`Registered ${this.processors.size} job processors`);
  }

  // Setup queue monitoring and events
  setupQueueMonitoring() {
    this.queues.forEach((queue, name) => {
      queue.on('completed', (job, result) => {
        logger.debug(`Job completed in queue ${name}`, {
          jobId: job.id,
          duration: Date.now() - job.timestamp,
          data: job.data
        });
      });

      queue.on('failed', (job, error) => {
        logger.error(`Job failed in queue ${name}`, {
          jobId: job.id,
          error: error.message,
          attempts: job.attemptsMade,
          data: job.data
        });
      });

      queue.on('stalled', (job) => {
        logger.warn(`Job stalled in queue ${name}`, {
          jobId: job.id,
          data: job.data
        });
      });

      queue.on('progress', (job, progress) => {
        logger.debug(`Job progress in queue ${name}`, {
          jobId: job.id,
          progress: `${progress}%`
        });
      });
    });
  }

  // Add operation to processing queue
  async queueOperation(roomId, operation, authorId, socketId) {
    if (!this.isInitialized) {
      throw new Error('Message queue service not initialized');
    }

    const operationQueue = this.queues.get('operations');
    
    const job = await operationQueue.add('processOperation', {
      roomId,
      operation,
      authorId,
      socketId,
      timestamp: Date.now()
    }, {
      priority: 10, // High priority for real-time operations
      delay: 0
    });

    logger.debug(`Queued operation for room ${roomId}`, {
      jobId: job.id,
      operation: operation.type
    });

    return job;
  }

  // Add room management task
  async queueRoomAction(action, roomId, userId, userData = {}) {
    if (!this.isInitialized) {
      throw new Error('Message queue service not initialized');
    }

    const roomQueue = this.queues.get('rooms');
    
    const job = await roomQueue.add('manageRoom', {
      action,
      roomId,
      userId,
      userData,
      timestamp: Date.now()
    }, {
      priority: 5
    });

    logger.debug(`Queued room action: ${action}`, {
      jobId: job.id,
      roomId,
      userId
    });

    return job;
  }

  // Schedule cleanup tasks
  async scheduleCleanup(type, delay = 0) {
    if (!this.isInitialized) {
      throw new Error('Message queue service not initialized');
    }

    const cleanupQueue = this.queues.get('cleanup');
    
    const job = await cleanupQueue.add('cleanup', {
      type,
      timestamp: Date.now()
    }, {
      delay
    });

    logger.info(`Scheduled cleanup task: ${type}`, {
      jobId: job.id,
      delay
    });

    return job;
  }

  // Schedule recurring cleanup
  setupRecurringCleanup() {
    const cleanupQueue = this.queues.get('cleanup');
    
    // Clean up operations every hour
    cleanupQueue.add('cleanup', { type: 'operations' }, {
      repeat: { cron: '0 * * * *' } // Every hour
    });

    // Clean up sessions every 6 hours
    cleanupQueue.add('cleanup', { type: 'sessions' }, {
      repeat: { cron: '0 */6 * * *' } // Every 6 hours
    });

    logger.info('Scheduled recurring cleanup tasks');
  }

  // Schedule metrics collection
  setupMetricsCollection() {
    const metricsQueue = this.queues.get('metrics');
    
    // Collect metrics every 5 minutes
    metricsQueue.add('collectMetrics', { 
      timestamp: Date.now() 
    }, {
      repeat: { cron: '*/5 * * * *' }, // Every 5 minutes
      removeOnComplete: 100
    });

    logger.info('Scheduled metrics collection');
  }

  // Get queue statistics
  getQueueMetrics() {
    const metrics = {};
    
    this.queues.forEach(async (queue, name) => {
      try {
        const waiting = await queue.getWaiting();
        const active = await queue.getActive();
        const completed = await queue.getCompleted();
        const failed = await queue.getFailed();
        
        metrics[name] = {
          waiting: waiting.length,
          active: active.length,
          completed: completed.length,
          failed: failed.length
        };
      } catch (error) {
        logger.error(`Failed to get metrics for queue ${name}:`, error);
        metrics[name] = { error: error.message };
      }
    });
    
    return metrics;
  }

  // Get detailed queue status
  async getDetailedQueueStatus() {
    const status = {};
    
    for (const [name, queue] of this.queues.entries()) {
      try {
        const [waiting, active, completed, failed] = await Promise.all([
          queue.getWaiting(),
          queue.getActive(),
          queue.getCompleted(),
          queue.getFailed()
        ]);
        
        status[name] = {
          waiting: waiting.length,
          active: active.length,
          completed: completed.length,
          failed: failed.length,
          paused: await queue.isPaused()
        };
      } catch (error) {
        status[name] = { error: error.message };
      }
    }
    
    return status;
  }

  // Pause all queues
  async pauseAll() {
    const promises = Array.from(this.queues.values()).map(queue => queue.pause());
    await Promise.all(promises);
    logger.info('All queues paused');
  }

  // Resume all queues
  async resumeAll() {
    const promises = Array.from(this.queues.values()).map(queue => queue.resume());
    await Promise.all(promises);
    logger.info('All queues resumed');
  }

  // Clean shutdown
  async shutdown() {
    try {
      // Pause all queues
      await this.pauseAll();
      
      // Wait for active jobs to complete (with timeout)
      const timeout = 30000; // 30 seconds
      const startTime = Date.now();
      
      while (Date.now() - startTime < timeout) {
        const activeJobs = await Promise.all(
          Array.from(this.queues.values()).map(queue => queue.getActive())
        );
        
        const totalActive = activeJobs.reduce((sum, jobs) => sum + jobs.length, 0);
        
        if (totalActive === 0) break;
        
        logger.info(`Waiting for ${totalActive} active jobs to complete...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Close all queues
      const promises = Array.from(this.queues.values()).map(queue => queue.close());
      await Promise.all(promises);
      
      this.queues.clear();
      this.processors.clear();
      this.isInitialized = false;
      
      logger.info('Message queue service shutdown completed');
    } catch (error) {
      logger.errorWithContext('Error during message queue shutdown', error);
    }
  }
}

module.exports = new MessageQueueService(); 