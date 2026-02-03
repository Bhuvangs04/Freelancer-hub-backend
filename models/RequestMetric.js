const mongoose = require("mongoose");

// ============================================================================
// REQUEST METRICS SCHEMA
// Stores latency data for admin dashboard and analysis
// ============================================================================

const RequestMetricSchema = new mongoose.Schema(
  {
    // Request Info
    method: {
      type: String,
      required: true,
      enum: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    },
    path: {
      type: String,
      required: true,
      index: true,
    },
    route: {
      type: String, // Parameterized route like /api/vi/user/:id
    },
    
    // Timing (in milliseconds)
    latency: {
      type: Number,
      required: true,
    },
    
    // Response Info
    statusCode: {
      type: Number,
      required: true,
    },
    
    // User Info (if authenticated)
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    userRole: {
      type: String,
    },
    
    // Request Metadata
    ip: {
      type: String,
    },
    userAgent: {
      type: String,
    },
    
    // Performance flags
    isSlow: {
      type: Boolean,
      default: false,
    },
  },
  { 
    timestamps: true,
    // Auto-delete metrics older than 7 days
    expireAfterSeconds: 7 * 24 * 60 * 60,
  }
);

// ============================================================================
// INDEXES
// ============================================================================

RequestMetricSchema.index({ createdAt: 1 }, { expireAfterSeconds: 604800 }); // 7 days TTL
RequestMetricSchema.index({ path: 1, method: 1, createdAt: -1 });
RequestMetricSchema.index({ isSlow: 1, createdAt: -1 });

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Get average latency stats
 */
RequestMetricSchema.statics.getAverageStats = async function (period = "1h") {
  const periodMs = {
    "1h": 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
  };

  const since = new Date(Date.now() - (periodMs[period] || periodMs["1h"]));

  const stats = await this.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: null,
        totalRequests: { $sum: 1 },
        avgLatency: { $avg: "$latency" },
        maxLatency: { $max: "$latency" },
        minLatency: { $min: "$latency" },
        p95Latency: { $percentile: { input: "$latency", p: [0.95], method: "approximate" } },
        slowRequests: { $sum: { $cond: ["$isSlow", 1, 0] } },
      },
    },
  ]);

  return stats[0] || {
    totalRequests: 0,
    avgLatency: 0,
    maxLatency: 0,
    minLatency: 0,
    slowRequests: 0,
  };
};

/**
 * Get latency by endpoint
 */
RequestMetricSchema.statics.getLatencyByEndpoint = async function (period = "1h", limit = 20) {
  const periodMs = {
    "1h": 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
  };

  const since = new Date(Date.now() - (periodMs[period] || periodMs["1h"]));

  return this.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: { method: "$method", path: "$route" },
        count: { $sum: 1 },
        avgLatency: { $avg: "$latency" },
        maxLatency: { $max: "$latency" },
        minLatency: { $min: "$latency" },
      },
    },
    { $sort: { avgLatency: -1 } },
    { $limit: limit },
  ]);
};

/**
 * Get slowest requests
 */
RequestMetricSchema.statics.getSlowestRequests = async function (limit = 10) {
  return this.find({ isSlow: true })
    .sort({ latency: -1 })
    .limit(limit)
    .select("method path latency statusCode createdAt userId");
};

module.exports = mongoose.model("RequestMetric", RequestMetricSchema);
