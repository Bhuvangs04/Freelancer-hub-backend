const express = require("express");
const router = express.Router();
const User = require("../models/User");
const OTP = require("../models/OTP"); // Model for storing OTPs
const sendEmail = require("../utils/sendEmail"); // Utility to send emails
const Admin = require("../models/Admin");

router.post("/send-otp", async (req, res) => {
  const { email } = req.body;
  try {
    if (!email) return res.status(400).json({ message: "Email is required." });
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpEntry = await OTP.findOne({ email });

    if (otpEntry) {
      otpEntry.otp = otpCode;
      otpEntry.createdAt = Date.now();
      await otpEntry.save();
    } else {
      await new OTP({ email, otp: otpCode, createdAt: Date.now() }).save();
    }

    await sendEmail(
      email,
      "Verification Code - FreelancerHub",
      `<div style="font-family: Arial, sans-serif; max-width: 500px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px; text-align: center; background-color: #f9f9f9;">
        <h2 style="color: #333;">FreelancerHub OTP Verification</h2>
        <p style="font-size: 16px;">Your OTP code is:</p>
        <h1 style="color: #4CAF50; margin: 10px 0;">${otpCode}</h1>
        <p style="font-size: 14px; color: #555;">Please enter this code to verify your email. This OTP is valid for only 10 minutes.</p>
        <hr style="margin: 20px 0;">
        <p style="font-size: 12px; color: #888;">If you did not request this, please ignore this email.</p>
        <footer style="margin-top: 20px; font-size: 12px; color: #999;">&copy; 2025 FreelancerHub. All Rights Reserved.</footer>
      </div>`
    );
    res.status(200).json({ message: "OTP sent successfully." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error sending OTP." });
  }
});

router.post("/verify-otp", async (req, res) => {
  const { email, otp } = req.body;
  try {
    const validOtp = await OTP.findOne({ email, otp });
    if (!validOtp) return res.status(400).json({ message: "Invalid OTP." });

    const otpAge = Date.now() - validOtp.createdAt;
    if (otpAge > 10 * 60 * 1000) {
      await OTP.deleteOne({ email });
      return res
        .status(400)
        .json({ message: "OTP expired. Please request a new one." });
    }

    validOtp.isVerified = true;
    await validOtp.save();
    res.status(200).json({ message: "OTP Verified successfully." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error verifying OTP." });
  }
});

router.post("/signup", async (req, res) => {
  const { username, password, email, role } = req.body;
  try {
    if (!username || !password || !email || !role) {
      return res.status(400).json({ message: "All fields are required." });
    }

    const validOtp = await OTP.findOne({ email, isVerified: true });
    if (!validOtp)
      return res.status(400).json({ message: "Invalid or unverified OTP." });

    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      return res
        .status(409)
        .json({ message: "Username or email already exists." });
    }

    const newUser = new User({
      username,
      password,
      email,
      role,
      otpVerified: true,
    });

    await newUser.save();
    await OTP.deleteOne({ email });
    res.status(201).json({ message: "Signup successful." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error." });
  }
});

router.post("/signup/admin", async (req, res) => {
  const { username, password, email, secret_code } = req.body;
  console.log("Admin signup route hit");
  try {
    if (!username || !password || !email || !secret_code) {
      return res.status(400).json({ message: "All fields are required." });
    }

    const existingUser = await Admin.findOne({
      $or: [{ username }, { email }],
    });
    if (existingUser) {
      return res
        .status(409)
        .json({ message: "Username or email already exists." });
    }

    const newUser = new Admin({
      username,
      password,
      email,
      role: "admin",
      secret_code,
    });

    await newUser.save();
    res.status(201).json({ message: "Signup successful." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error." });
  }
});

module.exports = router;
