const mongoose = require("mongoose");

/**
 * PenaltyLog — records every admin moderation action
 * (ban, revoke, partial penalty with refund control).
 */
const PenaltyLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    alertId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminAlert",
      default: null,
    },
    action: {
      type: String,
      enum: ["BAN", "REVOKE", "PENALTY"],
      required: true,
    },
    penaltyAmount: {
      type: Number,
      default: 0,
    },
    refundAmount: {
      type: Number,
      default: 0,
    },
    walletBalanceBefore: {
      type: Number,
      default: 0,
    },
    walletBalanceAfter: {
      type: Number,
      default: 0,
    },
    penaltyReason: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

PenaltyLogSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("PenaltyLog", PenaltyLogSchema);
