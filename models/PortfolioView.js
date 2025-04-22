const mongoose = require("mongoose");

const PortfolioViewSchema = new mongoose.Schema({
  freelancerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  ip: { type: String },
  location: {
    country: String,
    region: String,
    city: String,
  },
  timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model("PortfolioView", PortfolioViewSchema);
