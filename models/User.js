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
    isBanned: { type: Boolean, default: false },
    otpVerified:{type:Boolean,default:false},
    banExpiresAt: { type: Date },
    Strikes: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["Available", "active", "Busy", "Away"],
      default: "active",
    },
    companyName: { type: String },
    Position: { type: String },
    Industry : { type: String },
  },
  { timestamps: true }
);

// Hash password before saving
UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 13);
  next();
});

module.exports = mongoose.model("User", UserSchema);
