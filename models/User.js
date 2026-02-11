const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    profilePictureUrl: { type: String },
    resumeUrl: { type: String },
    bio: { type: String },
    role: { type: String, enum: ["freelancer", "client"], required: true },
    profileComplete: { type: Boolean, default: false },
    isBanned: { type: Boolean, default: false },
    isbanDate: { type: Date },
    otpVerified: { type: Boolean, default: false },
    location: {
      type: String,
      default: "Not specified",
    },
    title: { type: String, default: "Freelancer" },
    experiences: {
      type: [
        {
          company: { type: String, required: true },
          role: { type: String, required: true },
          period: { type: String, required: true },
          description: { type: String },
        },
      ],
      default: [],
    },
    skills: {
      type: [
        {
          name: { type: String, required: true },
          proficiency: {
            type: String,
            enum: ["beginner", "intermediate", "expert"],
            default: "beginner",
          },
        },
      ],
      default: [],
    },
    banExpiresAt: { type: Date },
    Strikes: { type: Number, default: 0 },
    portflio: { type: String, default: "" },
    githubUsername: { type: String },
    status: {
      type: String,
      enum: ["Available", "active", "Busy", "Away"],
      default: "active",
    },
    companyName: { type: String },
    Position: { type: String },
    Industry: { type: String },
  },
  { timestamps: true }
);

// Hash password before saving
UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 13);
  next();
});

// Method to check if profile is complete based on role
UserSchema.methods.checkProfileComplete = function () {
  if (this.role === "freelancer") {
    // Freelancer needs: profile picture, resume, bio, at least 1 skill
    return !!(
      this.profilePictureUrl &&
      this.resumeUrl &&
      this.bio &&
      this.skills &&
      this.skills.length > 0
    );
  } else if (this.role === "client") {
    // Client needs: profile picture, company name, industry
    return !!(this.profilePictureUrl && this.companyName && this.Industry);
  }
  return false;
};

module.exports = mongoose.model("User", UserSchema);
