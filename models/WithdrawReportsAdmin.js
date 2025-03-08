const mongoose = require("mongoose");

const AdminWithdrawSchema = new mongoose.Schema({
  freelancerId: { type: String, required: true, ref: "User" },
  type: { type: String, enum: ["income", "withdraw"], required: true },
  amount: { type: Number, required: true },
  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending",
  },
  description: String,
  createdAt: { type: Date, default: Date.now },

  bankDetails: {
    accountNumber: { type: String, required: true },
    accountName: { type: String, required: true },
    ifscCode: { type: String, required: true },
  },
});

module.exports = mongoose.model("AdminWithdraw", AdminWithdrawSchema);
