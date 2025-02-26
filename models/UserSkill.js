const mongoose = require("mongoose");

const UserSkillSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  skills: [
    {
      name: { type: String, required: true },
      proficiency: {
        type: String,
        enum: [
          "beginner",
          "Beginner",
          "intermediate",
          "Intermediate",
          "expert",
          "Expert",
        ],
        required: true,
      },
    },
  ],
});

module.exports = mongoose.model("UserSkill", UserSkillSchema);
