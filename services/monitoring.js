const os = require('os');
const EventEmitter = require('events');

class MonitoringService extends EventEmitter {
  constructor() {
    super();
    this.metrics = {
      requests: 0,
      activeConnections: 0,
      aiRequests: 0,
      errors: 0,
      startTime: Date.now(),
      lastHealthCheck: Date.now()
    };
    
    this.systemMetrics = {
      cpuUsage: 0,
      memoryUsage: 0,
      loadAverage: 0
    };
    
    this.intervals = [];
    this.isRunning = false;
  }

  // Start monitoring
  start() {
    if (this.isRunning) return;
    
    console.log('📊 Starting monitoring service...');
    this.isRunning = true;
    
    // Collect system metrics every 30 seconds
    const systemInterval = setInterval(() => {
      this.collectSystemMetrics();
    }, 30000);
    
    // Emit health status every 60 seconds
    const healthInterval = setInterval(() => {
      this.emitHealthStatus();
    }, 60000);
    
    this.intervals.push(systemInterval, healthInterval);
    
    // Initial collection
    this.collectSystemMetrics();
    
    console.log('✅ Monitoring service started');
  }

  // Stop monitoring
  stop() {
    if (!this.isRunning) return;
    
    console.log('🛑 Stopping monitoring service...');
    this.isRunning = false;
    
    this.intervals.forEach(interval => clearInterval(interval));
    this.intervals = [];
    
    console.log('✅ Monitoring service stopped');
  }

  // Collect system metrics
  collectSystemMetrics() {
    try {
      // CPU usage
      const cpus = os.cpus();
      let totalIdle = 0;
      let totalTick = 0;
      
      cpus.forEach(cpu => {
        for (const type in cpu.times) {
          totalTick += cpu.times[type];
        }
        totalIdle += cpu.times.idle;
      });
      
      this.systemMetrics.cpuUsage = Math.round((1 - totalIdle / totalTick) * 100);
      
      // Memory usage
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      this.systemMetrics.memoryUsage = Math.round(((totalMem - freeMem) / totalMem) * 100);
      
      // Load average (1 minute)
      const loadAvg = os.loadavg();
      this.systemMetrics.loadAverage = Math.round(loadAvg[0] * 100) / 100;
      
      this.metrics.lastHealthCheck = Date.now();
      
    } catch (error) {
      console.error('Error collecting system metrics:', error.message);
    }
  }

  // Record request
  recordRequest() {
    this.metrics.requests++;
  }

  // Record AI request
  recordAIRequest() {
    this.metrics.aiRequests++;
  }

  // Record error
  recordError() {
    this.metrics.errors++;
  }

  // Update active connections
  updateActiveConnections(count) {
    this.metrics.activeConnections = count;
  }

  // Emit health status
  emitHealthStatus() {
    const uptime = Date.now() - this.metrics.startTime;
    const uptimeHours = Math.round(uptime / (1000 * 60 * 60) * 100) / 100;
    
    const healthStatus = {
      status: this.getHealthStatus(),
      uptime: {
        ms: uptime,
        hours: uptimeHours,
        readable: this.formatUptime(uptime)
      },
      metrics: { ...this.metrics },
      system: { ...this.systemMetrics },
      timestamp: new Date().toISOString()
    };
    
    this.emit('health-update', healthStatus);
    
    // Log health status periodically
    if (this.metrics.requests % 100 === 0 || uptimeHours % 1 === 0) {
      console.log(`📊 Health Status: ${healthStatus.status} | Requests: ${this.metrics.requests} | Uptime: ${healthStatus.uptime.readable}`);
    }
  }

  // Get overall health status
  getHealthStatus() {
    const { cpuUsage, memoryUsage } = this.systemMetrics;
    const { activeConnections } = this.metrics;
    
    // Critical thresholds
    if (cpuUsage > 90 || memoryUsage > 95) {
      return 'critical';
    }
    
    // Warning thresholds
    if (cpuUsage > 70 || memoryUsage > 80 || activeConnections > 800) {
      return 'warning';
    }
    
    // Healthy
    return 'healthy';
  }

  // Get comprehensive metrics
  getMetrics() {
    const uptime = Date.now() - this.metrics.startTime;
    
    return {
      ...this.metrics,
      system: { ...this.systemMetrics },
      uptime: {
        ms: uptime,
        readable: this.formatUptime(uptime)
      },
      status: this.getHealthStatus(),
      timestamp: new Date().toISOString()
    };
  }

  // Format uptime for readability
  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  // Get alerts based on current metrics
  getAlerts() {
    const alerts = [];
    const { cpuUsage, memoryUsage } = this.systemMetrics;
    const { activeConnections, errors } = this.metrics;
    
    if (cpuUsage > 80) {
      alerts.push({
        type: 'warning',
        metric: 'cpu',
        value: cpuUsage,
        message: `High CPU usage: ${cpuUsage}%`
      });
    }
    
    if (memoryUsage > 85) {
      alerts.push({
        type: 'warning',
        metric: 'memory',
        value: memoryUsage,
        message: `High memory usage: ${memoryUsage}%`
      });
    }
    
    if (activeConnections > 750) {
      alerts.push({
        type: 'info',
        metric: 'connections',
        value: activeConnections,
        message: `High connection count: ${activeConnections}`
      });
    }
    
    if (errors > 10) {
      alerts.push({
        type: 'warning',
        metric: 'errors',
        value: errors,
        message: `Error count elevated: ${errors}`
      });
    }
    
    return alerts;
  }

  // Reset metrics (useful for testing or periodic resets)
  resetMetrics() {
    this.metrics.requests = 0;
    this.metrics.aiRequests = 0;
    this.metrics.errors = 0;
    console.log('📊 Metrics reset');
  }
}

// Export singleton instance
const monitoringService = new MonitoringService();

module.exports = monitoringService; 