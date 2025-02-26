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
    amount: { type: Number, required: true },
    status: {
      type: String,
      enum: ["funded", "released", "refunded","paid"],
      default: "funded",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Escrow", EscrowSchema);
