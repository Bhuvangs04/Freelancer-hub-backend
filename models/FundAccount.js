const mongoose = require("mongoose");

const FundAccountSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  fundAccountId: { type: String, required: true },
  contactId: { type: String, required: true },
  bankDetails: {
    accountNumber: String,
    ifsc: String,
    name: String,
  },
});

module.exports = mongoose.model("FundAccount", FundAccountSchema);
