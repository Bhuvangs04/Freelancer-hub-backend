const mongoose = require("mongoose");

const TransactionSchema = new mongoose.Schema(
  {
    escrowId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Escrow",
      required: true,
    },
    type: {
      type: String,
      enum: ["deposit", "withdrawal", "release", "refund", "commission"],
      required: true,
    },
    amount: { type: Number, required: true },
    status: {
      type: String,
      enum: ["completed", "failed", "settled", "on_hold"],
      default: "completed",
    },
    RefundedId:{type:String}
  },
  { timestamps: true }
);

module.exports = mongoose.model("Transaction", TransactionSchema);
