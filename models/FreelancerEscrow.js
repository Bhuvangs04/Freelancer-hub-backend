const mongoose = require("mongoose");

const FreelancerEscrowSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    freelancerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    amount: { type: Number, required: true },
    status: {
      type: String,
      enum: ["paid", "withdraw"],
      default: "paid",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("FreelancerEscrow", FreelancerEscrowSchema);
