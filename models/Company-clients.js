const mongoose = require("mongoose");

const CompanySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    companyName: { type: String },
    Position: { type: String },
    Industry: { type: String },
    type: { type: String, enum: ["individual", "company"] },
  },
  { timestamps: true }
);

// Hash password before saving

module.exports = mongoose.model("client-company", CompanySchema);
