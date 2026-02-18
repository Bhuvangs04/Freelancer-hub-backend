const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const { verifyToken, authorize } = require("../middleware/Auth");
const Admin = require("../models/Admin");
const AdminActivityLog = require("../models/AdminActivityLog");
const sendEmail = require("../utils/sendEmail");

// ============================================================================
// HELPERS
// ============================================================================

const getClientIp = (req) =>
  req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
  req.connection?.remoteAddress ||
  req.ip ||
  "unknown";

const logAdminActivity = async (adminId, action, opts = {}) => {
  try {
    await AdminActivityLog.create({
      adminId,
      action,
      targetType: opts.targetType || null,
      targetId: opts.targetId || null,
      reason: opts.reason || "",
      metadata: opts.metadata || {},
      ipAddress: opts.ipAddress || "",
    });
  } catch (err) {
    console.error("Error logging admin activity:", err);
  }
};

// Super Admin only middleware
const requireSuperAdmin = (req, res, next) => {
  if (req.user?.role !== "super_admin") {
    return res.status(403).json({
      message: "Forbidden. Super Admin access required.",
    });
  }
  next();
};

// Generate a secure random password
const generateSecurePassword = () => {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";
  const special = "!@#$%^&*()_+-=";
  const all = upper + lower + digits + special;

  let password = "";
  // Ensure at least one of each
  password += upper[crypto.randomInt(upper.length)];
  password += lower[crypto.randomInt(lower.length)];
  password += digits[crypto.randomInt(digits.length)];
  password += special[crypto.randomInt(special.length)];

  // Fill to 16 chars
  for (let i = 4; i < 16; i++) {
    password += all[crypto.randomInt(all.length)];
  }

  // Shuffle
  return password
    .split("")
    .sort(() => crypto.randomInt(3) - 1)
    .join("");
};

// ============================================================================
// 1. ADMIN SETTINGS (Any admin — self-management)
// ============================================================================

/**
 * GET /admin/settings/profile
 * Get own profile info
 */
router.get(
  "/settings/profile",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const admin = await Admin.findById(req.user.userId).select(
        "username email role twoFactorEnabled lastLoginAt lastLoginIp createdAt mustChangePassword"
      );
      if (!admin) return res.status(404).json({ message: "Admin not found" });

      const backupCodesRemaining = admin.twoFactorBackupCodes
        ? admin.twoFactorBackupCodes.filter((c) => !c.used).length
        : 0;

      res.json({
        admin: {
          _id: admin._id,
          username: admin.username,
          email: admin.email,
          role: admin.role,
          twoFactorEnabled: admin.twoFactorEnabled,
          lastLoginAt: admin.lastLoginAt,
          lastLoginIp: admin.lastLoginIp,
          createdAt: admin.createdAt,
          mustChangePassword: admin.mustChangePassword,
          backupCodesRemaining,
        },
      });
    } catch (err) {
      console.error("Get profile error:", err);
      res.status(500).json({ message: "Error fetching profile" });
    }
  }
);

/**
 * PUT /admin/settings/profile
 * Update own name
 */
router.put(
  "/settings/profile",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const { username } = req.body;
      if (!username || username.trim().length < 3) {
        return res.status(400).json({ message: "Username must be at least 3 characters" });
      }

      const admin = await Admin.findById(req.user.userId);
      if (!admin) return res.status(404).json({ message: "Admin not found" });

      // Check uniqueness
      const existing = await Admin.findOne({
        username: username.trim(),
        _id: { $ne: admin._id },
      });
      if (existing) {
        return res.status(409).json({ message: "Username already taken" });
      }

      admin.username = username.trim();
      await admin.save();

      await logAdminActivity(req.user.userId, "PROFILE_UPDATE", {
        targetType: "admin",
        targetId: admin._id,
        metadata: { username: admin.username },
        ipAddress: getClientIp(req),
      });

      res.json({ message: "Profile updated", username: admin.username });
    } catch (err) {
      console.error("Update profile error:", err);
      res.status(500).json({ message: "Error updating profile" });
    }
  }
);

/**
 * PUT /admin/settings/password
 * Change own password
 */
router.put(
  "/settings/password",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Current and new password are required" });
      }

      const admin = await Admin.findById(req.user.userId);
      if (!admin) return res.status(404).json({ message: "Admin not found" });

      const isPasswordValid = await admin.comparePassword(currentPassword);
      if (!isPasswordValid) {
        return res.status(401).json({ message: "Current password is incorrect" });
      }

      // Validate password strength
      const hasUpper = /[A-Z]/.test(newPassword);
      const hasLower = /[a-z]/.test(newPassword);
      const hasNum = /[0-9]/.test(newPassword);
      const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newPassword);

      if (newPassword.length < 12 || !hasUpper || !hasLower || !hasNum || !hasSpecial) {
        return res.status(400).json({
          message: "Password must be 12+ characters with uppercase, lowercase, number, and special character",
        });
      }

      admin.password = newPassword;
      admin.mustChangePassword = false;
      await admin.save();

      await logAdminActivity(req.user.userId, "PASSWORD_CHANGE", {
        targetType: "admin",
        targetId: admin._id,
        ipAddress: getClientIp(req),
      });

      res.json({ message: "Password changed successfully" });
    } catch (err) {
      console.error("Change password error:", err);
      res.status(500).json({ message: "Error changing password" });
    }
  }
);

/**
 * POST /admin/settings/2fa/setup
 * Generate TOTP secret and QR code for 2FA setup
 */
router.post(
  "/settings/2fa/setup",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const admin = await Admin.findById(req.user.userId);
      if (!admin) return res.status(404).json({ message: "Admin not found" });

      if (admin.twoFactorEnabled) {
        return res.status(400).json({ message: "2FA is already enabled" });
      }

      // Allow admin to provide their own secret or generate one
      const { customSecret } = req.body;
      let secret;

      if (customSecret) {
        // Validate that it's a valid base32 string
        const base32Regex = /^[A-Z2-7]+=*$/;
        if (!base32Regex.test(customSecret.toUpperCase())) {
          return res.status(400).json({ message: "Invalid secret key format. Must be base32 encoded." });
        }
        secret = { base32: customSecret.toUpperCase() };
      } else {
        secret = speakeasy.generateSecret({
          name: `FreelancerHub Admin (${admin.email})`,
          issuer: "FreelancerHub",
          length: 32,
        });
      }

      // Store temporarily (not enabled yet, user needs to verify)
      admin.twoFactorSecret = secret.base32;
      await admin.save();

      // Generate QR code
      const otpauthUrl =
        customSecret
          ? speakeasy.otpauthURL({
              secret: secret.base32,
              encoding: "base32",
              label: `FreelancerHub Admin (${admin.email})`,
              issuer: "FreelancerHub",
            })
          : secret.otpauth_url;

      const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

      res.json({
        message: "Scan QR code with your authenticator app, then verify with a code",
        secret: secret.base32,
        qrCode: qrCodeDataUrl,
      });
    } catch (err) {
      console.error("2FA setup error:", err);
      res.status(500).json({ message: "Error setting up 2FA" });
    }
  }
);

/**
 * POST /admin/settings/2fa/verify
 * Verify TOTP code to complete 2FA setup
 */
router.post(
  "/settings/2fa/verify",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const { totp_code } = req.body;
      if (!totp_code) {
        return res.status(400).json({ message: "TOTP code is required" });
      }

      const admin = await Admin.findById(req.user.userId);
      if (!admin) return res.status(404).json({ message: "Admin not found" });

      if (!admin.twoFactorSecret) {
        return res.status(400).json({ message: "Please run 2FA setup first" });
      }

      if (admin.twoFactorEnabled) {
        return res.status(400).json({ message: "2FA is already enabled" });
      }

      // Verify the code
      const isValid = speakeasy.totp.verify({
        secret: admin.twoFactorSecret,
        encoding: "base32",
        token: totp_code.toString().trim(),
        window: 2,
      });

      if (!isValid) {
        return res.status(401).json({ message: "Invalid verification code" });
      }

      // Enable 2FA and generate backup codes
      admin.twoFactorEnabled = true;
      const backupCodes = admin.generateBackupCodes();
      await admin.save();

      await logAdminActivity(req.user.userId, "2FA_ENABLED", {
        targetType: "admin",
        targetId: admin._id,
        ipAddress: getClientIp(req),
      });

      res.json({
        message: "2FA enabled successfully",
        backupCodes,
      });
    } catch (err) {
      console.error("2FA verify error:", err);
      res.status(500).json({ message: "Error verifying 2FA" });
    }
  }
);

/**
 * POST /admin/settings/2fa/disable
 * Disable 2FA (requires current TOTP and password)
 */
router.post(
  "/settings/2fa/disable",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const { password, totp_code } = req.body;
      if (!password || !totp_code) {
        return res.status(400).json({ message: "Password and TOTP code are required" });
      }

      const admin = await Admin.findById(req.user.userId);
      if (!admin) return res.status(404).json({ message: "Admin not found" });

      if (!admin.twoFactorEnabled) {
        return res.status(400).json({ message: "2FA is not enabled" });
      }

      // Verify password
      const isPasswordValid = await admin.comparePassword(password);
      if (!isPasswordValid) {
        return res.status(401).json({ message: "Invalid password" });
      }

      // Verify TOTP
      const isValid = speakeasy.totp.verify({
        secret: admin.twoFactorSecret,
        encoding: "base32",
        token: totp_code.toString().trim(),
        window: 2,
      });

      if (!isValid) {
        return res.status(401).json({ message: "Invalid TOTP code" });
      }

      admin.twoFactorEnabled = false;
      admin.twoFactorSecret = null;
      admin.twoFactorBackupCodes = [];
      await admin.save();

      await logAdminActivity(req.user.userId, "2FA_DISABLED", {
        targetType: "admin",
        targetId: admin._id,
        ipAddress: getClientIp(req),
      });

      res.json({ message: "2FA disabled successfully" });
    } catch (err) {
      console.error("Disable 2FA error:", err);
      res.status(500).json({ message: "Error disabling 2FA" });
    }
  }
);

/**
 * GET /admin/settings/2fa/backup-codes
 * View remaining backup codes count
 */
router.get(
  "/settings/2fa/backup-codes",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const admin = await Admin.findById(req.user.userId);
      if (!admin) return res.status(404).json({ message: "Admin not found" });

      if (!admin.twoFactorEnabled) {
        return res.status(400).json({ message: "2FA is not enabled" });
      }

      const remaining = admin.twoFactorBackupCodes.filter((c) => !c.used);

      res.json({
        total: admin.twoFactorBackupCodes.length,
        remaining: remaining.length,
        codes: remaining.map((c) => c.code),
      });
    } catch (err) {
      console.error("Backup codes error:", err);
      res.status(500).json({ message: "Error fetching backup codes" });
    }
  }
);

/**
 * POST /admin/settings/2fa/regenerate-backup
 * Regenerate backup codes (requires TOTP)
 */
router.post(
  "/settings/2fa/regenerate-backup",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const { totp_code } = req.body;
      if (!totp_code) {
        return res.status(400).json({ message: "TOTP code is required" });
      }

      const admin = await Admin.findById(req.user.userId);
      if (!admin) return res.status(404).json({ message: "Admin not found" });

      if (!admin.twoFactorEnabled) {
        return res.status(400).json({ message: "2FA is not enabled" });
      }

      // Verify TOTP
      const isValid = speakeasy.totp.verify({
        secret: admin.twoFactorSecret,
        encoding: "base32",
        token: totp_code.toString().trim(),
        window: 2,
      });

      if (!isValid) {
        return res.status(401).json({ message: "Invalid TOTP code" });
      }

      const backupCodes = admin.generateBackupCodes();
      await admin.save();

      await logAdminActivity(req.user.userId, "BACKUP_CODES_REGENERATED", {
        targetType: "admin",
        targetId: admin._id,
        ipAddress: getClientIp(req),
      });

      res.json({
        message: "Backup codes regenerated",
        backupCodes,
      });
    } catch (err) {
      console.error("Regenerate backup codes error:", err);
      res.status(500).json({ message: "Error regenerating backup codes" });
    }
  }
);

// ============================================================================
// 2. SUPER ADMIN ROUTES (Admin Management)
// ============================================================================

/**
 * GET /admin/management/admins
 * List all admins (Super Admin only)
 */
router.get(
  "/management/admins",
  verifyToken,
  authorize(["super_admin"]),
  requireSuperAdmin,
  async (req, res) => {
    try {
      const admins = await Admin.find()
        .select("username email role isActive twoFactorEnabled lastLoginAt createdAt mustChangePassword")
        .sort({ createdAt: -1 });

      res.json({ admins });
    } catch (err) {
      console.error("List admins error:", err);
      res.status(500).json({ message: "Error fetching admins" });
    }
  }
);

/**
 * POST /admin/management/admins
 * Create a new admin (Super Admin only)
 */
router.post(
  "/management/admins",
  verifyToken,
  authorize(["super_admin"]),
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { username, email } = req.body;

      if (!username || !email) {
        return res.status(400).json({
          message: "Username and email are required",
        });
      }

      // Auto-generate a secure secret code (min 16 chars, must have letters + numbers)
      const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
      const digits = "0123456789";
      const allChars = letters + digits;
      // Guarantee at least 2 letters and 2 digits, rest random from all
      let secretParts = [];
      secretParts.push(letters[crypto.randomInt(letters.length)]);
      secretParts.push(letters[crypto.randomInt(letters.length)]);
      secretParts.push(digits[crypto.randomInt(digits.length)]);
      secretParts.push(digits[crypto.randomInt(digits.length)]);
      for (let i = 0; i < 16; i++) {
        secretParts.push(allChars[crypto.randomInt(allChars.length)]);
      }
      // Shuffle
      const secretCode = secretParts.sort(() => crypto.randomInt(3) - 1).join("");

      // Check if email already exists
      const existing = await Admin.findOne({ email: email.toLowerCase() });
      if (existing) {
        return res.status(409).json({ message: "Admin with this email already exists" });
      }

      // Check if username already exists
      const existingUsername = await Admin.findOne({ username: username.trim() });
      if (existingUsername) {
        return res.status(409).json({ message: "Username already taken" });
      }

      // Generate secure password
      const tempPassword = generateSecurePassword();

      // Create admin
      const admin = new Admin({
        username: username.trim(),
        email: email.toLowerCase().trim(),
        password: tempPassword,
        role: "admin",
        mustChangePassword: true,
        isActive: true,
      });

      // Set secret code
      await admin.setSecretCode(secretCode);
      await admin.save();

      // Send credentials via email
      try {
        const emailHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; padding: 20px; background: linear-gradient(135deg, #7c3aed, #4f46e5); border-radius: 12px 12px 0 0;">
              <h1 style="color: white; margin: 0;">FreelancerHub Admin</h1>
              <p style="color: rgba(255,255,255,0.8); margin: 5px 0 0;">Your admin account has been created</p>
            </div>
            <div style="padding: 30px; background: #f8fafc; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
              <h2 style="color: #1e293b; margin-top: 0;">Welcome, ${username}!</h2>
              <p style="color: #475569;">Your admin account has been created by the Super Admin. Here are your login credentials:</p>
              
              
              
              <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <p style="margin: 8px 0;"><strong>Email:</strong> ${email}</p>
                <p style="margin: 8px 0;"><strong>Temporary Password:</strong> <code style="background: #f1f5f9; padding: 2px 8px; border-radius: 4px; font-size: 14px;">${tempPassword}</code></p>
                <p style="margin: 8px 0;"><strong>Secret Code:</strong> <code style="background: #f1f5f9; padding: 2px 8px; border-radius: 4px; font-size: 14px;">${secretCode}</code></p>
              </div>

              <div style="background: #fef3c7; border: 1px solid #fbbf24; border-radius: 8px; padding: 15px; margin: 20px 0;">
                <p style="color: #92400e; margin: 0; font-weight: bold;">⚠️ Important:</p>
                <ul style="color: #92400e; margin: 10px 0 0; padding-left: 20px;">
                  <li>You must change your password on first login</li>
                  <li>You must enable Two-Factor Authentication (2FA)</li>
                  <li>Keep your secret code safe — it's required for login</li>
                </ul>
              </div>

              <p style="color: #64748b; font-size: 12px; margin-top: 20px;">
                This is an automated message from FreelancerHub. Do not share your credentials with anyone.
              </p>
            </div>
          </div>
        `;

        await sendEmail(email, "Your FreelancerHub Admin Account", emailHtml);
      } catch (emailErr) {
        console.error("Failed to send admin creation email:", emailErr);
        // Don't fail the creation, just log the error
      }

      await logAdminActivity(req.user.userId, "ADMIN_CREATE", {
        targetType: "admin",
        targetId: admin._id,
        metadata: { username, email },
        ipAddress: getClientIp(req),
      });

      res.status(201).json({
        message: "Admin created and credentials sent via email",
        admin: {
          _id: admin._id,
          username: admin.username,
          email: admin.email,
          role: admin.role,
        },
      });
    } catch (err) {
      console.error("Create admin error:", err);
      res.status(500).json({ message: "Error creating admin" });
    }
  }
);

/**
 * DELETE /admin/management/admins/:adminId
 * Delete an admin (Super Admin only)
 */
router.delete(
  "/management/admins/:adminId",
  verifyToken,
  authorize(["super_admin"]),
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { adminId } = req.params;
      const { reason } = req.body;

      // Prevent self-deletion
      if (adminId === req.user.userId) {
        return res.status(400).json({ message: "Cannot delete your own account" });
      }

      const admin = await Admin.findById(adminId);
      if (!admin) return res.status(404).json({ message: "Admin not found" });

      // Prevent deletion of other super admins
      if (admin.role === "super_admin") {
        return res.status(403).json({ message: "Cannot delete another super admin" });
      }

      await Admin.findByIdAndDelete(adminId);

      await logAdminActivity(req.user.userId, "ADMIN_DELETE", {
        targetType: "admin",
        targetId: adminId,
        reason: reason || "No reason provided",
        metadata: { username: admin.username, email: admin.email },
        ipAddress: getClientIp(req),
      });

      res.json({ message: "Admin deleted successfully" });
    } catch (err) {
      console.error("Delete admin error:", err);
      res.status(500).json({ message: "Error deleting admin" });
    }
  }
);

/**
 * PUT /admin/management/admins/:adminId/block
 * Block an admin (Super Admin only)
 */
router.put(
  "/management/admins/:adminId/block",
  verifyToken,
  authorize(["super_admin"]),
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { adminId } = req.params;
      const { reason } = req.body;

      if (adminId === req.user.userId) {
        return res.status(400).json({ message: "Cannot block your own account" });
      }

      const admin = await Admin.findById(adminId);
      if (!admin) return res.status(404).json({ message: "Admin not found" });

      if (admin.role === "super_admin") {
        return res.status(403).json({ message: "Cannot block another super admin" });
      }

      admin.isActive = false;
      await admin.save();

      await logAdminActivity(req.user.userId, "ADMIN_BLOCK", {
        targetType: "admin",
        targetId: adminId,
        reason: reason || "No reason provided",
        metadata: { username: admin.username },
        ipAddress: getClientIp(req),
      });

      res.json({ message: "Admin blocked successfully" });
    } catch (err) {
      console.error("Block admin error:", err);
      res.status(500).json({ message: "Error blocking admin" });
    }
  }
);

/**
 * PUT /admin/management/admins/:adminId/unblock
 * Unblock an admin (Super Admin only)
 */
router.put(
  "/management/admins/:adminId/unblock",
  verifyToken,
  authorize(["super_admin"]),
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { adminId } = req.params;

      const admin = await Admin.findById(adminId);
      if (!admin) return res.status(404).json({ message: "Admin not found" });

      admin.isActive = true;
      await admin.save();

      await logAdminActivity(req.user.userId, "ADMIN_UNBLOCK", {
        targetType: "admin",
        targetId: adminId,
        metadata: { username: admin.username },
        ipAddress: getClientIp(req),
      });

      res.json({ message: "Admin unblocked successfully" });
    } catch (err) {
      console.error("Unblock admin error:", err);
      res.status(500).json({ message: "Error unblocking admin" });
    }
  }
);

/**
 * POST /admin/management/admins/:adminId/reset-password
 * Reset admin's password and send via email (Super Admin only)
 */
router.post(
  "/management/admins/:adminId/reset-password",
  verifyToken,
  authorize(["super_admin"]),
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { adminId } = req.params;

      const admin = await Admin.findById(adminId);
      if (!admin) return res.status(404).json({ message: "Admin not found" });

      if (admin.role === "super_admin" && adminId !== req.user.userId) {
        return res.status(403).json({ message: "Cannot reset another super admin's password" });
      }

      const newPassword = generateSecurePassword();
      admin.password = newPassword;
      admin.mustChangePassword = true;
      await admin.save();

      // Send reset email
      try {
        const emailHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; padding: 20px; background: linear-gradient(135deg, #7c3aed, #4f46e5); border-radius: 12px 12px 0 0;">
              <h1 style="color: white; margin: 0;">Password Reset</h1>
            </div>
            <div style="padding: 30px; background: #f8fafc; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
              <p style="color: #475569;">Your password has been reset by the Super Admin. Here is your new temporary password:</p>
              <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
                <code style="background: #f1f5f9; padding: 8px 16px; border-radius: 6px; font-size: 16px; letter-spacing: 1px;">${newPassword}</code>
              </div>
              <p style="color: #ef4444; font-weight: bold;">You must change this password upon your next login.</p>
            </div>
          </div>
        `;
        await sendEmail(admin.email, "FreelancerHub Admin — Password Reset", emailHtml);
      } catch (emailErr) {
        console.error("Failed to send password reset email:", emailErr);
      }

      await logAdminActivity(req.user.userId, "ADMIN_PASSWORD_RESET", {
        targetType: "admin",
        targetId: adminId,
        metadata: { username: admin.username },
        ipAddress: getClientIp(req),
      });

      res.json({ message: "Password reset successfully. New credentials sent via email." });
    } catch (err) {
      console.error("Reset password error:", err);
      res.status(500).json({ message: "Error resetting password" });
    }
  }
);

/**
 * POST /admin/management/admins/:adminId/reset-mfa
 * Reset admin's MFA / 2FA (Super Admin only)
 */
router.post(
  "/management/admins/:adminId/reset-mfa",
  verifyToken,
  authorize(["super_admin"]),
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { adminId } = req.params;

      const admin = await Admin.findById(adminId);
      if (!admin) return res.status(404).json({ message: "Admin not found" });

      if (admin.role === "super_admin" && adminId !== req.user.userId) {
        return res.status(403).json({ message: "Cannot reset another super admin's MFA" });
      }

      admin.twoFactorEnabled = false;
      admin.twoFactorSecret = null;
      admin.twoFactorBackupCodes = [];
      await admin.save();

      // Send notification email
      try {
        const emailHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; padding: 20px; background: linear-gradient(135deg, #dc2626, #ef4444); border-radius: 12px 12px 0 0;">
              <h1 style="color: white; margin: 0;">MFA Reset Notice</h1>
            </div>
            <div style="padding: 30px; background: #f8fafc; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
              <p style="color: #475569;">Your Two-Factor Authentication (2FA) has been reset by the Super Admin.</p>
              <p style="color: #ef4444; font-weight: bold;">Please re-enable 2FA from your admin settings immediately after your next login.</p>
            </div>
          </div>
        `;
        await sendEmail(admin.email, "FreelancerHub Admin — MFA Reset", emailHtml);
      } catch (emailErr) {
        console.error("Failed to send MFA reset email:", emailErr);
      }

      await logAdminActivity(req.user.userId, "ADMIN_MFA_RESET", {
        targetType: "admin",
        targetId: adminId,
        metadata: { username: admin.username },
        ipAddress: getClientIp(req),
      });

      res.json({ message: "MFA reset successfully" });
    } catch (err) {
      console.error("Reset MFA error:", err);
      res.status(500).json({ message: "Error resetting MFA" });
    }
  }
);

module.exports = router;
