const mongoose = require("mongoose");

const chatSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Project",
    required: true,
    index: true,
  },
  message: { type: String, required: true },
  encrypted: { type: Boolean, default: true },
  status: {
    type: String,
    enum: ["sent", "delivered", "read"],
    default: "sent",
  },
  flagged: { type: Boolean, default: false },
  flagReason: { type: String, default: null },
  timestamp: { type: Date, default: Date.now },
});

chatSchema.index({ projectId: 1, timestamp: -1 });
chatSchema.index({ sender: 1, receiver: 1, projectId: 1 });

module.exports = mongoose.model("Chat", chatSchema);
