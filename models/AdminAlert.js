const mongoose = require("mongoose");

/**
 * AdminAlert — tracks violation alerts for admin review.
 * Created automatically when a user's violation score crosses thresholds.
 */
const AdminAlertSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      default: null,
    },
    reason: {
      type: String,
      required: true,
    },
    violationScore: {
      type: Number,
      required: true,
    },
    evidenceMessages: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Chat",
      },
    ],
    status: {
      type: String,
      enum: ["pending", "reviewed", "dismissed"],
      default: "pending",
      index: true,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    reviewNotes: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

AdminAlertSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("AdminAlert", AdminAlertSchema);
