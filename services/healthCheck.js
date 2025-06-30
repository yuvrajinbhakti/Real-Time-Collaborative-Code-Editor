const config = require('../config/environment');
const logger = require('./logger');
const redisService = require('./redis');
const otService = require('./operationalTransform');

class HealthCheckService {
  constructor() {
    this.checks = new Map();
    this.healthHistory = [];
    this.maxHistorySize = 100;
    this.checkInterval = config.MONITORING.HEALTH_CHECK_INTERVAL;
    this.intervalId = null;
    this.lastCheckTime = null;
    this.isHealthy = true;
  }

  // Initialize health check system
  initialize() {
    this.registerHealthChecks();
    this.startPeriodicChecks();
    logger.info('Health check service initialized');
  }

  // Register all health checks
  registerHealthChecks() {
    // Database/Redis health check
    this.checks.set('redis', {
      name: 'Redis Connection',
      check: async () => {
        try {
          const isHealthy = await redisService.healthCheck();
          return {
            status: isHealthy ? 'healthy' : 'unhealthy',
            responseTime: Date.now(),
            details: isHealthy ? 'Redis is responding' : 'Redis is not responding'
          };
        } catch (error) {
          return {
            status: 'unhealthy',
            responseTime: Date.now(),
            details: error.message
          };
        }
      },
      critical: true
    });

    // Memory usage check
    this.checks.set('memory', {
      name: 'Memory Usage',
      check: async () => {
        const memUsage = process.memoryUsage();
        const usedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
        const totalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
        const usagePercent = (usedMB / totalMB) * 100;
        
        const status = usagePercent > 90 ? 'critical' : 
                      usagePercent > 75 ? 'warning' : 'healthy';
        
        return {
          status,
          responseTime: Date.now(),
          details: `Memory usage: ${usedMB}MB / ${totalMB}MB (${usagePercent.toFixed(1)}%)`,
          metrics: {
            heapUsed: memUsage.heapUsed,
            heapTotal: memUsage.heapTotal,
            external: memUsage.external,
            rss: memUsage.rss
          }
        };
      },
      critical: false
    });

    // CPU usage check
    this.checks.set('cpu', {
      name: 'CPU Usage',
      check: async () => {
        const cpuUsage = process.cpuUsage();
        const loadAvg = require('os').loadavg();
        
        const status = loadAvg[0] > 4 ? 'critical' : 
                      loadAvg[0] > 2 ? 'warning' : 'healthy';
        
        return {
          status,
          responseTime: Date.now(),
          details: `Load average: ${loadAvg[0].toFixed(2)} (1m), ${loadAvg[1].toFixed(2)} (5m), ${loadAvg[2].toFixed(2)} (15m)`,
          metrics: {
            user: cpuUsage.user,
            system: cpuUsage.system,
            loadAverage: loadAvg
          }
        };
      },
      critical: false
    });

    // Operational Transform service check
    this.checks.set('ot', {
      name: 'Operational Transform',
      check: async () => {
        try {
          const metrics = otService.getMetrics();
          const status = metrics.activeRooms > 1000 ? 'warning' : 'healthy';
          
          return {
            status,
            responseTime: Date.now(),
            details: `Active rooms: ${metrics.activeRooms}, Total operations: ${metrics.totalOperations}`,
            metrics
          };
        } catch (error) {
          return {
            status: 'unhealthy',
            responseTime: Date.now(),
            details: error.message
          };
        }
      },
      critical: false
    });

    // File system check
    this.checks.set('filesystem', {
      name: 'File System',
      check: async () => {
        try {
          const fs = require('fs').promises;
          const stats = require('fs').statSync('./');
          
          // Try to write a test file
          const testFile = './health-check-test.tmp';
          await fs.writeFile(testFile, 'test');
          await fs.unlink(testFile);
          
          return {
            status: 'healthy',
            responseTime: Date.now(),
            details: 'File system is accessible'
          };
        } catch (error) {
          return {
            status: 'unhealthy',
            responseTime: Date.now(),
            details: `File system error: ${error.message}`
          };
        }
      },
      critical: false
    });

    // Socket.IO connection check
    this.checks.set('socketio', {
      name: 'Socket.IO',
      check: async () => {
        // This would need to be injected from the main server
        // For now, we'll just check if the module can be loaded
        try {
          require('socket.io');
          return {
            status: 'healthy',
            responseTime: Date.now(),
            details: 'Socket.IO module is available'
          };
        } catch (error) {
          return {
            status: 'unhealthy',
            responseTime: Date.now(),
            details: `Socket.IO error: ${error.message}`
          };
        }
      },
      critical: true
    });
  }

  // Start periodic health checks
  startPeriodicChecks() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }

    this.intervalId = setInterval(async () => {
      await this.performHealthCheck();
    }, this.checkInterval);

    // Perform initial check
    this.performHealthCheck();
  }

  // Stop periodic health checks
  stopPeriodicChecks() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  // Perform comprehensive health check
  async performHealthCheck() {
    const startTime = Date.now();
    const results = new Map();
    let overallStatus = 'healthy';

    try {
      // Run all health checks in parallel
      const checkPromises = Array.from(this.checks.entries()).map(async ([key, config]) => {
        const checkStartTime = Date.now();
        try {
          const result = await config.check();
          const checkDuration = Date.now() - checkStartTime;
          
          results.set(key, {
            ...result,
            duration: checkDuration,
            critical: config.critical,
            name: config.name
          });

          // Update overall status
          if (config.critical && result.status === 'unhealthy') {
            overallStatus = 'unhealthy';
          } else if (result.status === 'critical') {
            overallStatus = 'critical';
          } else if (result.status === 'warning' && overallStatus === 'healthy') {
            overallStatus = 'warning';
          }
        } catch (error) {
          results.set(key, {
            status: 'unhealthy',
            responseTime: Date.now(),
            duration: Date.now() - checkStartTime,
            details: `Health check failed: ${error.message}`,
            critical: config.critical,
            name: config.name
          });
          
          if (config.critical) {
            overallStatus = 'unhealthy';
          }
        }
      });

      await Promise.all(checkPromises);

      const totalDuration = Date.now() - startTime;
      const healthReport = {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        duration: totalDuration,
        checks: Object.fromEntries(results),
        uptime: process.uptime(),
        version: require('../package.json').version
      };

      // Store in history
      this.healthHistory.push(healthReport);
      if (this.healthHistory.length > this.maxHistorySize) {
        this.healthHistory.shift();
      }

      this.lastCheckTime = Date.now();
      this.isHealthy = overallStatus !== 'unhealthy';

      // Log health status changes
      if (overallStatus !== 'healthy') {
        logger.warn(`Health check status: ${overallStatus}`, {
          duration: totalDuration,
          failedChecks: Array.from(results.entries())
            .filter(([_, result]) => result.status !== 'healthy')
            .map(([key, result]) => ({ check: key, status: result.status, details: result.details }))
        });
      }

      logger.performance('Health Check', startTime, {
        status: overallStatus,
        checksPerformed: results.size
      });

      return healthReport;
    } catch (error) {
      logger.errorWithContext('Health check failed', error);
      
      const errorReport = {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
        error: error.message,
        uptime: process.uptime()
      };

      this.healthHistory.push(errorReport);
      this.isHealthy = false;
      
      return errorReport;
    }
  }

  // Get current health status
  async getHealthStatus() {
    if (!this.lastCheckTime || Date.now() - this.lastCheckTime > this.checkInterval * 2) {
      // Perform fresh check if data is stale
      return await this.performHealthCheck();
    }
    
    return this.healthHistory[this.healthHistory.length - 1] || {
      status: 'unknown',
      timestamp: new Date().toISOString(),
      message: 'No health check data available'
    };
  }

  // Get simple health status for load balancers
  async getSimpleHealthStatus() {
    const status = await this.getHealthStatus();
    return {
      status: status.status === 'healthy' ? 'ok' : 'error',
      timestamp: status.timestamp
    };
  }

  // Get detailed health report
  async getDetailedHealthReport() {
    const currentStatus = await this.getHealthStatus();
    const recentHistory = this.healthHistory.slice(-10);
    
    return {
      current: currentStatus,
      history: recentHistory,
      metrics: {
        totalChecks: this.healthHistory.length,
        averageResponseTime: this.healthHistory.length > 0 
          ? this.healthHistory.reduce((sum, check) => sum + (check.duration || 0), 0) / this.healthHistory.length
          : 0,
        uptimeSeconds: process.uptime(),
        uptimeHours: Math.floor(process.uptime() / 3600)
      }
    };
  }

  // Get health metrics for Prometheus
  getPrometheusMetrics() {
    const status = this.healthHistory[this.healthHistory.length - 1];
    if (!status) return '';

    let metrics = [];
    
    // Overall health status
    metrics.push(`health_status{status="${status.status}"} ${status.status === 'healthy' ? 1 : 0}`);
    
    // Individual check statuses
    if (status.checks) {
      Object.entries(status.checks).forEach(([key, check]) => {
        metrics.push(`health_check_status{check="${key}",status="${check.status}"} ${check.status === 'healthy' ? 1 : 0}`);
        if (check.duration) {
          metrics.push(`health_check_duration_ms{check="${key}"} ${check.duration}`);
        }
      });
    }
    
    // System metrics
    const memUsage = process.memoryUsage();
    metrics.push(`nodejs_memory_heap_used_bytes ${memUsage.heapUsed}`);
    metrics.push(`nodejs_memory_heap_total_bytes ${memUsage.heapTotal}`);
    metrics.push(`nodejs_process_uptime_seconds ${process.uptime()}`);
    
    return metrics.join('\n');
  }

  // Cleanup
  destroy() {
    this.stopPeriodicChecks();
    this.checks.clear();
    this.healthHistory = [];
    logger.info('Health check service destroyed');
  }
}

module.exports = new HealthCheckService(); 