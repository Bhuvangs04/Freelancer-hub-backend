const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const SkillSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },
  name: { type: String, required: true, unique: true },
});

module.exports = mongoose.model("Skill", SkillSchema);
