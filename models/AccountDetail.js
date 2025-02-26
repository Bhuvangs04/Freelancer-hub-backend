const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const AccountDetailsSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },
  userId: { type: String, required: true, ref: "User" },
  accountNumber: { type: String, required: true, unique: true },
  bankName: { type: String, required: true },
  ifscCode: { type: String, required: true },
  accountType: { type: String, enum: ["savings", "current"], required: true },
});

module.exports = mongoose.model("AccountDetails", AccountDetailsSchema);
