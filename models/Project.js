const mongoose = require("mongoose");

const ProjectSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    budget: { type: Number, required: true, default: 0.0 },
    status: {
      type: String,
      enum: ["open", "in_progress", "completed", "cancelled", "rejected"],
      default: "open",
    },
    deadline: { type: Date, required: true },
    skillsRequired: { type: [String], required: true },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    freelancerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Project", ProjectSchema);
