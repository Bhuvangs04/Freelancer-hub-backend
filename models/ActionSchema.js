const mongoose = require("mongoose");

const activitySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  action: { type: String, required: true }, // e.g., "Updated Profile", "Made a Payment"
  timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Action", activitySchema);
