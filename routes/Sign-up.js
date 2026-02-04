const express = require("express");
const router = express.Router();
const User = require("../models/User");
const OTP = require("../models/OTP");
const sendEmail = require("../utils/sendEmail");
const Admin = require("../models/Admin");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const crypto = require("crypto");

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate email format
 */
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate password strength for regular users
 * - Minimum 8 characters
 * - At least one letter and one number
 */
const isValidUserPassword = (password) => {
  if (!password || password.length < 8) return false;
  return /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
};

/**
 * Validate password strength for admin users
 * - Minimum 12 characters
 * - At least one uppercase, one lowercase, one number, one special char
 */
const isValidAdminPassword = (password) => {
  if (!password || password.length < 12) return false;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
  return hasUppercase && hasLowercase && hasNumber && hasSpecial;
};

/**
 * Validate secret code strength for admin
 * - Minimum 16 characters
 * - Must contain letters and numbers
 */
const isValidSecretCode = (code) => {
  if (!code || code.length < 16) return false;
  return /[a-zA-Z]/.test(code) && /[0-9]/.test(code);
};

/**
 * Sanitize input string
 */
const sanitize = (str) => {
  if (!str || typeof str !== "string") return "";
  return str.trim().slice(0, 100);
};

// ============================================================================
// USER OTP ROUTES
// ============================================================================

/**
 * POST /send-otp
 * Send OTP for email verification
 */
router.post("/send-otp", async (req, res) => {
  const { email } = req.body;

  try {
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ message: "Valid email is required." });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Generate secure OTP
    const otpCode = crypto.randomInt(100000, 999999).toString();

    // Rate limiting: Check for recent OTP
    const recentOtp = await OTP.findOne({
      email: normalizedEmail,
      createdAt: { $gt: Date.now() - 60 * 1000 }, // Within last minute
    });

    if (recentOtp) {
      return res.status(429).json({
        message: "Please wait 60 seconds before requesting another OTP.",
      });
    }

    // Upsert OTP record
    await OTP.findOneAndUpdate(
      { email: normalizedEmail },
      {
        email: normalizedEmail,
        otp: otpCode,
        createdAt: Date.now(),
        isVerified: false,
      },
      { upsert: true, new: true }
    );

    res.status(200).json({ message: "OTP sent successfully." });

    sendEmail(
      normalizedEmail,
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
    ).catch(err => {
      console.error("Async OTP email failed:", err);
    });
  } catch (error) {
    console.error("Send OTP Error:", error);
    if (!res.headersSent) {
      res.status(500).json({ message: "Error sending OTP." });
    }
  }
});

/**
 * POST /verify-otp
 * Verify OTP code
 */
router.post("/verify-otp", async (req, res) => {
  const { email, otp } = req.body;

  try {
    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required." });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const validOtp = await OTP.findOne({
      email: normalizedEmail,
      otp: otp.toString().trim(),
    });

    if (!validOtp) {
      return res.status(400).json({ message: "Invalid OTP." });
    }

    // Check OTP expiry (10 minutes)
    const otpAge = Date.now() - validOtp.createdAt;
    if (otpAge > 10 * 60 * 1000) {
      await OTP.deleteOne({ email: normalizedEmail });
      return res.status(400).json({
        message: "OTP expired. Please request a new one.",
      });
    }

    validOtp.isVerified = true;
    await validOtp.save();

    res.status(200).json({ message: "OTP verified successfully." });
  } catch (error) {
    console.error("Verify OTP Error:", error);
    res.status(500).json({ message: "Error verifying OTP." });
  }
});

// ============================================================================
// USER SIGNUP ROUTE
// ============================================================================

/**
 * POST /signup
 * Register a new user (client/freelancer)
 */
router.post("/signup", async (req, res) => {
  const { username, password, email, role } = req.body;

  try {
    // Validate all required fields
    if (!username || !password || !email || !role) {
      return res.status(400).json({ message: "All fields are required." });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const sanitizedUsername = sanitize(username);

    // Validate email
    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ message: "Invalid email format." });
    }

    // Validate role
    const allowedRoles = ["client", "freelancer"];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        message: "Invalid role. Must be 'client' or 'freelancer'.",
      });
    }

    // Validate password for users
    if (!isValidUserPassword(password)) {
      return res.status(400).json({
        message: "Password must be at least 8 characters with letters and numbers.",
      });
    }

    // Verify OTP was completed
    const validOtp = await OTP.findOne({
      email: normalizedEmail,
      isVerified: true,
    });

    if (!validOtp) {
      return res.status(400).json({ message: "Email not verified. Please complete OTP verification." });
    }

    // Check for existing user
    const existingUser = await User.findOne({
      $or: [
        { username: sanitizedUsername },
        { email: normalizedEmail },
      ],
    });

    if (existingUser) {
      return res.status(409).json({
        message: "Username or email already exists.",
      });
    }

    // Create new user
    const newUser = new User({
      username: sanitizedUsername,
      password,
      email: normalizedEmail,
      role,
      otpVerified: true,
    });

    await newUser.save();
    await OTP.deleteOne({ email: normalizedEmail });

    res.status(201).json({ message: "Signup successful." });
  } catch (error) {
    console.error("User Signup Error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});

// ============================================================================
// ADMIN SIGNUP ROUTES (Enhanced Security)
// ============================================================================

/**
 * POST /signup/admin
 * Register a new admin with enhanced security
 * 
 * Requirements:
 * - Strong password (12+ chars with uppercase, lowercase, number, special)
 * - Strong secret code (16+ chars)
 * - Setup 2FA after registration
 */
router.post("/signup/admin", async (req, res) => {
  const { username, password, email, secret_code } = req.body;

  try {
    // Validate all required fields
    if (!username || !password || !email || !secret_code) {
      return res.status(400).json({ message: "All fields are required." });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const sanitizedUsername = sanitize(username);

    // Validate email
    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ message: "Invalid email format." });
    }

    // Validate admin password strength
    if (!isValidAdminPassword(password)) {
      return res.status(400).json({
        message: "Admin password must be at least 12 characters with uppercase, lowercase, number, and special character.",
      });
    }

    // Validate secret code strength
    if (!isValidSecretCode(secret_code)) {
      return res.status(400).json({
        message: "Secret code must be at least 16 characters with letters and numbers.",
      });
    }

    // Check for existing admin
    const existingUser = await Admin.findOne({
      $or: [
        { username: sanitizedUsername },
        { email: normalizedEmail },
      ],
    });

    if (existingUser) {
      return res.status(409).json({
        message: "Username or email already exists.",
      });
    }

    // Generate TOTP secret for 2FA
    const totpSecret = speakeasy.generateSecret({
      name: `FreelancerHub Admin (${sanitizedUsername})`,
      length: 32,
    });

    // Create new admin
    const newAdmin = new Admin({
      username: sanitizedUsername,
      password,
      email: normalizedEmail,
      role: "admin",
      twoFactorSecret: totpSecret.base32,
      twoFactorEnabled: false, // Must be enabled after setup
      mustChangePassword: false,
    });

    // Hash and set secret code
    await newAdmin.setSecretCode(secret_code);

    // Generate backup codes
    const backupCodes = newAdmin.generateBackupCodes();

    await newAdmin.save();

    // Generate QR code for 2FA setup
    const qrCodeDataUrl = await QRCode.toDataURL(totpSecret.otpauth_url);

    res.status(201).json({
      message: "Admin signup successful. Please set up 2FA to complete registration.",
      twoFactorSetup: {
        qrCode: qrCodeDataUrl,
        manualKey: totpSecret.base32,
        backupCodes: backupCodes,
      },
      instructions: [
        "1. Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.)",
        "2. Save your backup codes in a secure location",
        "3. Call /signup/admin/verify-2fa with a TOTP code to enable 2FA",
      ],
    });
  } catch (error) {
    console.error("Admin Signup Error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});

/**
 * POST /signup/admin/verify-2fa
 * Verify and enable 2FA for admin account after signup
 */
router.post("/signup/admin/verify-2fa", async (req, res) => {
  const { email, totp_code } = req.body;

  try {
    if (!email || !totp_code) {
      return res.status(400).json({
        message: "Email and TOTP code are required.",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const admin = await Admin.findOne({
      email: normalizedEmail,
      twoFactorEnabled: false,
    });

    if (!admin) {
      return res.status(404).json({
        message: "Admin not found or 2FA already enabled.",
      });
    }

    // Verify TOTP code
    const isValid = speakeasy.totp.verify({
      secret: admin.twoFactorSecret,
      encoding: "base32",
      token: totp_code.toString().trim(),
      window: 2, // Allow 2 time steps tolerance
    });

    if (!isValid) {
      return res.status(400).json({
        message: "Invalid TOTP code. Please try again.",
      });
    }

    // Enable 2FA
    admin.twoFactorEnabled = true;
    await admin.save();

    res.status(200).json({
      message: "2FA enabled successfully. Your admin account is now protected.",
    });
  } catch (error) {
    console.error("Admin 2FA Verification Error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});

/**
 * POST /signup/admin/regenerate-backup-codes
 * Regenerate backup codes for admin (requires 2FA verification)
 */
router.post("/signup/admin/regenerate-backup-codes", async (req, res) => {
  const { email, secret_code, totp_code } = req.body;

  try {
    if (!email || !secret_code || !totp_code) {
      return res.status(400).json({
        message: "Email, secret code, and TOTP code are required.",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const admin = await Admin.findOne({
      email: normalizedEmail,
      twoFactorEnabled: true,
    });

    if (!admin) {
      return res.status(404).json({
        message: "Admin not found or 2FA not enabled.",
      });
    }

    // Verify secret code
    const isSecretValid = await admin.verifySecretCode(secret_code);
    if (!isSecretValid) {
      return res.status(401).json({ message: "Invalid secret code." });
    }

    // Verify TOTP
    const isTotpValid = speakeasy.totp.verify({
      secret: admin.twoFactorSecret,
      encoding: "base32",
      token: totp_code.toString().trim(),
      window: 2,
    });

    if (!isTotpValid) {
      return res.status(401).json({ message: "Invalid TOTP code." });
    }

    // Generate new backup codes
    const backupCodes = admin.generateBackupCodes();
    await admin.save();

    res.status(200).json({
      message: "Backup codes regenerated. Old codes are now invalid.",
      backupCodes: backupCodes,
    });
  } catch (error) {
    console.error("Regenerate Backup Codes Error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});

module.exports = router;
