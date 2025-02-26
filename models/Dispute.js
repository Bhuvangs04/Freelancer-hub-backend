const mongoose = require("mongoose");

const DisputeSchema = new mongoose.Schema(
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
    freelancerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    raisedBy: { type: String, enum: ["client", "freelancer"], required: true },
    reason: { type: String, required: true },
    status: {
      type: String,
      enum: ["open", "resolved", "escalated"],
      default: "open",
    },
    resolution: { type: String },
    resolvedByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Dispute", DisputeSchema);
