const mongoose = require("mongoose");
const crypto = require("crypto");

// ============================================================================
// AI API KEY SCHEMA
// Admin-managed API keys for AI microservice authentication
// ============================================================================

const AiApiKeySchema = new mongoose.Schema(
  {
    // Auto-generated API key
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: () =>
        `fhub_ai_${crypto.randomBytes(24).toString("hex")}`,
    },

    // Human-readable label
    label: {
      type: String,
      required: true,
      trim: true,
    },

    // Key status
    status: {
      type: String,
      enum: ["active", "blocked", "revoked"],
      default: "active",
      index: true,
    },

    // Request limit (0 = unlimited)
    requestLimit: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Total requests made with this key
    usageCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Last time this key was used
    lastUsedAt: {
      type: Date,
      default: null,
    },

    // Reason for blocking (if blocked)
    blockedReason: {
      type: String,
      default: null,
    },

    blockedAt: {
      type: Date,
      default: null,
    },

    // Which admin created this key
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
  },
  { timestamps: true }
);

// ============================================================================
// METHODS
// ============================================================================

/**
 * Increment usage and check limits.
 * Returns { allowed: boolean, reason?: string }
 */
AiApiKeySchema.methods.recordUsage = async function () {
  this.usageCount += 1;
  this.lastUsedAt = new Date();

  // Check if limit is reached
  if (this.requestLimit > 0 && this.usageCount >= this.requestLimit) {
    this.status = "blocked";
    this.blockedReason = "Request limit reached";
    this.blockedAt = new Date();
  }

  await this.save();
};

module.exports = mongoose.model("AiApiKey", AiApiKeySchema);
