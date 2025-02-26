const mongoose = require("mongoose");

const RefundSchema = new mongoose.Schema(
  {
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
      required: true,
    },
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
    refundAmount: { type: Number, required: true },
    reason: { type: String },
    status: {
      type: String,
      enum: ["initiated", "completed", "failed"],
      default: "initiated",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Refund", RefundSchema);
