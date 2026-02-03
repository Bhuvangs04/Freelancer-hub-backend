const mongoose = require("mongoose");

const IdempotencyKeySchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    endpoint: {
      type: String,
      required: true,
    },
    requestHash: {
      type: String,
      required: true,
    },
    response: {
      type: mongoose.Schema.Types.Mixed,
    },
    status: {
      type: String,
      enum: ["processing", "completed", "failed"],
      default: "processing",
    },
    expiresAt: {
      type: Date,
      required: true,
      // Note: TTL index is defined separately below
    },
  },
  { timestamps: true }
);

// TTL index to auto-delete expired keys after 24 hours
IdempotencyKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("IdempotencyKey", IdempotencyKeySchema);
