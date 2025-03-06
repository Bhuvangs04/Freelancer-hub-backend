const mongoose = require("mongoose");

const DisputeSchema = new mongoose.Schema(
  {
    userID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
    },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    freelancerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    raisedBy: { type: String, enum: ["client", "freelancer"], required: true },
    reason: { type: String, required: true },
    status: {
      type: String,
      enum: ["open", "resolved", "escalated"],
      default: "open",
    },
    resolution: { type: String },
    file_url: { type: String, required: true },
    resolvedByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Dispute", DisputeSchema);
