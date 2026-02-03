const mongoose = require("mongoose");

const BidSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    freelancerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    resume_permission: { type: Boolean, required: true, default: false },
    amount: { type: Number, required: true },
    message: { type: String },
    status: {
      type: String,
      enum: ["pending", "sign_pending", "accepted", "rejected", "agreement_cancelled", "withdrawn"],
      default: "pending",
    },
    // Reason for cancellation (used when status is agreement_cancelled)
    cancellationReason: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Bid", BidSchema);
