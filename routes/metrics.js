const express = require("express");
const router = express.Router();
const { verifyToken, authorize } = require("../middleware/Auth");
const { getRealtimeStats, resetRealtimeStats } = require("../middleware/LatencyMonitor");
const RequestMetric = require("../models/RequestMetric");
const mongoose = require("mongoose");

// ============================================================================
// ADMIN METRICS ROUTES
// Performance monitoring dashboard for admins
// ============================================================================

/**
 * GET /metrics/realtime
 * Get real-time in-memory stats (fast)
 */
router.get(
  "/realtime",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    try {
      const stats = getRealtimeStats();
      res.json({
        success: true,
        data: stats,
      });
    } catch (err) {
      console.error("Realtime Metrics Error:", err);
      res.status(500).json({ message: "Error fetching metrics" });
    }
  }
);

/**
 * GET /metrics/summary
 * Get aggregated stats from database
 */
router.get(
  "/summary",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    try {
      const { period = "24h" } = req.query;

      const stats = await RequestMetric.getAverageStats(period);
      const byEndpoint = await RequestMetric.getLatencyByEndpoint(period, 15);
      const slowest = await RequestMetric.getSlowestRequests(10);

      res.json({
        success: true,
        period,
        summary: {
          totalRequests: stats.totalRequests,
          avgLatency: Math.round(stats.avgLatency * 100) / 100,
          maxLatency: stats.maxLatency,
          minLatency: stats.minLatency,
          slowRequests: stats.slowRequests,
          slowPercent: stats.totalRequests > 0
            ? Math.round((stats.slowRequests / stats.totalRequests) * 10000) / 100
            : 0,
        },
        topEndpoints: byEndpoint.map((e) => ({
          method: e._id.method,
          route: e._id.path,
          count: e.count,
          avgLatency: Math.round(e.avgLatency * 100) / 100,
          maxLatency: e.maxLatency,
        })),
        slowestRequests: slowest,
      });
    } catch (err) {
      console.error("Summary Metrics Error:", err);
      res.status(500).json({ message: "Error fetching metrics" });
    }
  }
);

/**
 * GET /metrics/endpoints
 * Get detailed latency by endpoint
 */
router.get(
  "/endpoints",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    try {
      const { period = "24h", limit = 50 } = req.query;

      const endpoints = await RequestMetric.getLatencyByEndpoint(
        period,
        parseInt(limit) || 50
      );

      res.json({
        success: true,
        period,
        endpoints: endpoints.map((e) => ({
          method: e._id.method,
          route: e._id.path || "unknown",
          count: e.count,
          avgLatency: Math.round(e.avgLatency * 100) / 100,
          maxLatency: Math.round(e.maxLatency * 100) / 100,
          minLatency: Math.round(e.minLatency * 100) / 100,
        })),
      });
    } catch (err) {
      console.error("Endpoints Metrics Error:", err);
      res.status(500).json({ message: "Error fetching metrics" });
    }
  }
);

/**
 * GET /metrics/slow
 * Get slow requests
 */
router.get(
  "/slow",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    try {
      const { limit = 20 } = req.query;

      const slowRequests = await RequestMetric.getSlowestRequests(
        parseInt(limit) || 20
      );

      res.json({
        success: true,
        slowRequests,
      });
    } catch (err) {
      console.error("Slow Requests Error:", err);
      res.status(500).json({ message: "Error fetching slow requests" });
    }
  }
);

/**
 * GET /metrics/health
 * System health overview
 */
router.get(
  "/health",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    try {
      const realtimeStats = getRealtimeStats();
      
      // Database health
      const dbState = mongoose.connection.readyState;
      const dbStates = {
        0: "disconnected",
        1: "connected",
        2: "connecting",
        3: "disconnecting",
      };

      // Memory usage
      const memUsage = process.memoryUsage();

      res.json({
        success: true,
        health: {
          status: dbState === 1 && realtimeStats.slowRequestPercent < 10 ? "healthy" : "degraded",
          database: dbStates[dbState] || "unknown",
          uptime: process.uptime(),
          memory: {
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + " MB",
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + " MB",
            rss: Math.round(memUsage.rss / 1024 / 1024) + " MB",
          },
          performance: {
            avgLatency: realtimeStats.avgLatency + " ms",
            slowRequestPercent: realtimeStats.slowRequestPercent + "%",
            requestsPerMinute: realtimeStats.requestsPerMinute,
          },
        },
      });
    } catch (err) {
      console.error("Health Check Error:", err);
      res.status(500).json({ message: "Error fetching health" });
    }
  }
);

/**
 * POST /metrics/reset
 * Reset real-time stats
 */
router.post(
  "/reset",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    try {
      resetRealtimeStats();
      res.json({
        success: true,
        message: "Real-time stats reset successfully",
      });
    } catch (err) {
      console.error("Reset Error:", err);
      res.status(500).json({ message: "Error resetting stats" });
    }
  }
);

module.exports = router;
