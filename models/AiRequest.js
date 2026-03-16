const mongoose = require("mongoose");
const crypto = require("crypto");

// ============================================================================
// AI REQUEST SCHEMA
// Tracks every interaction between AI microservices and the gateway
// ============================================================================

const AiRequestSchema = new mongoose.Schema(
  {
    // Unique request identifier for AI service callbacks
    requestId: {
      type: String,
      unique: true,
      index: true,
      default: () => `air_${crypto.randomBytes(12).toString("hex")}`,
    },

    // Which action was requested
    action: {
      type: String,
      required: true,
      enum: [
        "recommend_freelancers",
        "recommend_projects",
        "detect_fake_account",
        "get_user_profile",
        "get_project_details",
        "predict_success",
        "detect_fake_profile",
      ],
      index: true,
    },

    // Parameters sent by the AI service (flexible shape per action)
    params: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },

    // Which AI service made the request
    aiServiceName: {
      type: String,
      default: "unknown",
      trim: true,
    },

    // Request lifecycle status
    status: {
      type: String,
      enum: ["pending", "data_sent", "completed", "failed"],
      default: "pending",
      index: true,
    },

    // Snapshot of data sent back to the AI service (optional audit trail)
    responseData: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    // AI service result (stored via the /result callback)
    aiResult: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    // Error message if the request failed
    errorMessage: {
      type: String,
      default: null,
    },

    // Which API key was used for this request
    apiKeyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AiApiKey",
      default: null,
      index: true,
    },

    // Timestamps for lifecycle tracking
    dataSentAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// ============================================================================
// INDEXES
// ============================================================================

AiRequestSchema.index({ action: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("AiRequest", AiRequestSchema);
