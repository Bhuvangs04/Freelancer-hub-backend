const express = require("express");
const { verifyToken, authorize } = require("../middleware/Auth");
const User = require("../models/User");

const security = express.Router();

security.post(
  "/checkAuth/permission/client",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    try {
      res.status(200).send({ message: true });
    } catch (error) {
      console.error(error);
      return res.status(403).send({ message: "Server is unavailable" });
    }
  }
);

security.post(
  "/checkAuth/permission/freelancer",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      res.status(200).send({ message: true });
    } catch (error) {
      console.error(error);
      return res.status(403).send({ message: "Server is unavailable" });
    }
  }
);

/**
 * GET /checkAuth/profile-status
 * Check if user has completed their profile setup
 */
security.get(
  "/checkAuth/profile-status",
  verifyToken,
  authorize(["client", "freelancer"]),
  async (req, res) => {
    try {
      const user = await User.findById(req.user.userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Check if profile is complete based on role
      const isComplete = user.profileComplete || user.checkProfileComplete();

      // If profile is newly complete, update the flag
      if (!user.profileComplete && isComplete) {
        user.profileComplete = true;
        await user.save();
      }

      res.json({
        profileComplete: user.profileComplete,
        role: user.role,
        profilePicture: user.profilePictureUrl || null,
      });
    } catch (error) {
      console.error("Profile status check error:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

module.exports = security;
