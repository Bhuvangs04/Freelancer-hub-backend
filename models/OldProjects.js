const mongoose = require("mongoose");

const OldProjectsSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    frameworks: [{ type: String, required: true }],
    freelancerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    link:{type:String,default:""},
  },
  { timestamps: true }
);

module.exports = mongoose.model("OldProject", OldProjectsSchema);
