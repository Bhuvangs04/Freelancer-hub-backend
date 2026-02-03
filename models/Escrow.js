const mongoose = require("mongoose");

const EscrowSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    freelancerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // Amount tracking for agreement sync
    amount: { type: Number, required: true }, // Current escrow amount
    originalAmount: { type: Number }, // Initial funded amount (before any adjustments)
    adjustedAmount: { type: Number }, // Amount after agreement sync
    refundedAmount: { type: Number, default: 0 }, // Total refunded to client

    // Agreement reference
    agreementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agreement"
    },

    status: {
      type: String,
      enum: ["funded", "released", "refunded", "paid", "partial_refund", "adjusted"],
      default: "funded",
    },

    // Audit log for amount changes
    adjustmentHistory: [{
      previousAmount: Number,
      newAmount: Number,
      refundAmount: Number,
      reason: String,
      agreementId: { type: mongoose.Schema.Types.ObjectId, ref: "Agreement" },
      adjustedAt: { type: Date, default: Date.now },
    }],
  },
  { timestamps: true }
);

// Pre-save hook to set originalAmount on first save
EscrowSchema.pre("save", function (next) {
  if (this.isNew && !this.originalAmount) {
    this.originalAmount = this.amount;
  }
  next();
});

module.exports = mongoose.model("Escrow", EscrowSchema);

