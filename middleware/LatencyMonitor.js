const RequestMetric = require("../models/RequestMetric");

// ============================================================================
// REQUEST LATENCY MONITORING MIDDLEWARE
// Measures and logs response time for every request
// ============================================================================

// Configuration
const SLOW_REQUEST_THRESHOLD_MS = 1000; // Requests > 1s are flagged as slow
const LOG_ALL_REQUESTS = process.env.NODE_ENV !== "production";
const STORE_METRICS = true; // Set to false to disable DB storage

// In-memory stats for real-time monitoring
const realtimeStats = {
  totalRequests: 0,
  totalLatency: 0,
  maxLatency: 0,
  slowRequests: 0,
  lastRequests: [], // Last 100 requests for quick access
  startTime: Date.now(),
};

/**
 * Get parameterized route path (replace IDs with :id)
 */
const getRoutePath = (path) => {
  return path
    .replace(/\/[a-f\d]{24}/gi, "/:id") // MongoDB ObjectId
    .replace(/\/\d+/g, "/:id") // Numeric IDs
    .replace(/\/[a-f\d-]{36}/gi, "/:uuid"); // UUIDs
};

/**
 * Latency monitoring middleware
 */
const latencyMonitor = (req, res, next) => {
  const startTime = process.hrtime.bigint();
  const startDate = new Date();

  // Capture original end method
  const originalEnd = res.end;

  res.end = function (...args) {
    const endTime = process.hrtime.bigint();
    const latencyNs = endTime - startTime;
    const latencyMs = Number(latencyNs) / 1e6; // Convert to milliseconds

    // Update real-time stats
    realtimeStats.totalRequests++;
    realtimeStats.totalLatency += latencyMs;
    if (latencyMs > realtimeStats.maxLatency) {
      realtimeStats.maxLatency = latencyMs;
    }

    const isSlow = latencyMs > SLOW_REQUEST_THRESHOLD_MS;
    if (isSlow) {
      realtimeStats.slowRequests++;
    }

    // Keep last 100 requests
    realtimeStats.lastRequests.unshift({
      method: req.method,
      path: req.path,
      latency: Math.round(latencyMs * 100) / 100,
      status: res.statusCode,
      time: startDate,
    });
    if (realtimeStats.lastRequests.length > 100) {
      realtimeStats.lastRequests.pop();
    }

    // Console logging
    const logColor = isSlow ? "\x1b[31m" : latencyMs > 500 ? "\x1b[33m" : "\x1b[32m";
    const resetColor = "\x1b[0m";
    
    if (LOG_ALL_REQUESTS || isSlow) {
      console.log(
        `${logColor}[${req.method}]${resetColor} ${req.path} - ${res.statusCode} - ${latencyMs.toFixed(2)}ms${isSlow ? " ⚠️ SLOW" : ""}`
      );
    }

    // Store in database (async, don't block response)
    if (STORE_METRICS && req.path !== "/health") {
      setImmediate(async () => {
        try {
          await RequestMetric.create({
            method: req.method,
            path: req.path,
            route: getRoutePath(req.path),
            latency: Math.round(latencyMs * 100) / 100,
            statusCode: res.statusCode,
            userId: req.user?.userId,
            userRole: req.user?.role,
            ip: req.ip || req.connection?.remoteAddress,
            userAgent: req.get("User-Agent")?.substring(0, 200),
            isSlow,
          });
        } catch (err) {
          // Silently fail - don't break app for metrics
          if (process.env.NODE_ENV !== "production") {
            console.error("Failed to store metric:", err.message);
          }
        }
      });
    }

    // Call original end
    return originalEnd.apply(this, args);
  };

  next();
};

/**
 * Get real-time stats (in-memory)
 */
const getRealtimeStats = () => {
  const uptime = Date.now() - realtimeStats.startTime;
  const avgLatency = realtimeStats.totalRequests > 0
    ? realtimeStats.totalLatency / realtimeStats.totalRequests
    : 0;

  return {
    totalRequests: realtimeStats.totalRequests,
    avgLatency: Math.round(avgLatency * 100) / 100,
    maxLatency: Math.round(realtimeStats.maxLatency * 100) / 100,
    slowRequests: realtimeStats.slowRequests,
    slowRequestPercent: realtimeStats.totalRequests > 0
      ? Math.round((realtimeStats.slowRequests / realtimeStats.totalRequests) * 10000) / 100
      : 0,
    requestsPerMinute: Math.round((realtimeStats.totalRequests / (uptime / 60000)) * 100) / 100,
    uptimeMinutes: Math.round(uptime / 60000),
    lastRequests: realtimeStats.lastRequests.slice(0, 20),
  };
};

/**
 * Reset real-time stats
 */
const resetRealtimeStats = () => {
  realtimeStats.totalRequests = 0;
  realtimeStats.totalLatency = 0;
  realtimeStats.maxLatency = 0;
  realtimeStats.slowRequests = 0;
  realtimeStats.lastRequests = [];
  realtimeStats.startTime = Date.now();
};

module.exports = {
  latencyMonitor,
  getRealtimeStats,
  resetRealtimeStats,
  SLOW_REQUEST_THRESHOLD_MS,
};
