const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const { verifyToken, authorize } = require("../middleware/Auth");
const { createTokenForUser } = require("../middleware/Auth");
const User = require("../models/User");
const Admin = require("../models/Admin");
const speakeasy = require("speakeasy");

const xorKey = "SecureOnlyThingsAreDone";

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * XOR Decryption for obfuscated credentials
 */
function xorDecrypt(obfuscatedString, key) {
  try {
    let decoded = atob(obfuscatedString)
      .split("")
      .map((c, i) => c.charCodeAt(0) ^ key.charCodeAt(i % key.length));
    return String.fromCharCode(...decoded);
  } catch {
    return null;
  }
}

/**
 * Get client IP address
 */
function getClientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.connection?.remoteAddress ||
    req.ip ||
    "unknown"
  );
}

// ============================================================================
// LOGIN ROUTES
// ============================================================================

/**
 * POST /:userDetails/login
 * Unified login for users and admins
 * 
 * For Admin (Manager):
 * - Requires secretCode
 * - Requires totp_code if 2FA is enabled
 * - Account lockout after failed attempts
 */
router.post("/:userDetails/login", async (req, res) => {
  const { userDetails } = req.params;
  let { email, password, secretCode, totp_code } = req.body;

  try {
    // Validate input types
    if (typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ message: "Invalid request format" });
    }

    // Decrypt credentials
    email = xorDecrypt(email, xorKey);
    password = xorDecrypt(password, xorKey);

    if (!email || !password) {
      return res.status(400).json({ message: "Invalid credentials format" });
    }

    const clientIp = getClientIp(req);
    let user;
    let tokenRole;

    // ================================================================
    // ADMIN LOGIN (Enhanced Security)
    // ================================================================
    if (userDetails === "Manager") {
      // Find admin with lockout check
      const result = await Admin.findByCredentials(email);

      if (result.error === "INVALID_CREDENTIALS") {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      if (result.error === "ACCOUNT_DISABLED") {
        return res.status(403).json({
          message: "Account has been disabled. Contact super admin.",
        });
      }

      if (result.error === "ACCOUNT_LOCKED") {
        return res.status(423).json({
          message: `Account locked. Try again in ${result.remainingMinutes} minutes.`,
          lockedUntil: result.remainingMinutes,
        });
      }

      const admin = result.admin;

      // Verify password
      const isPasswordValid = await admin.comparePassword(password);
      if (!isPasswordValid) {
        await admin.incLoginAttempts();
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Verify secret code
      if (!secretCode) {
        return res.status(400).json({ message: "Secret code is required" });
      }

      const isSecretValid = await admin.verifySecretCode(secretCode);
      if (!isSecretValid) {
        await admin.incLoginAttempts();
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Check if 2FA is enabled
      if (admin.twoFactorEnabled) {
        if (!totp_code) {
          return res.status(400).json({
            message: "2FA code required",
            requires2FA: true,
          });
        }

        // Try TOTP verification first
        let isTotpValid = speakeasy.totp.verify({
          secret: admin.twoFactorSecret,
          encoding: "base32",
          token: totp_code.toString().trim(),
          window: 2,
        });

        // If TOTP fails, try backup code
        if (!isTotpValid) {
          const backupUsed = await admin.useBackupCode(totp_code.toString().trim());
          if (!backupUsed) {
            await admin.incLoginAttempts();
            return res.status(401).json({ message: "Invalid 2FA code" });
          }
          // Warn about backup code usage
          console.warn(`Admin ${admin.email} used a backup code from IP: ${clientIp}`);
        }
      }

      // Check if password change is required
      if (admin.mustChangePassword) {
        return res.status(403).json({
          message: "Password change required",
          requiresPasswordChange: true,
        });
      }

      // Reset login attempts and update last login
      await admin.resetLoginAttempts();
      admin.lastLoginIp = clientIp;
      await admin.save();

      user = admin;
      tokenRole = "admin";
    }
    // ================================================================
    // USER LOGIN (Client/Freelancer)
    // ================================================================
    else if (userDetails === "Client") {
      user = await User.findOne({ email: email.toLowerCase() });

      if (!user) {
        return res.status(401).json({ message: "Invalid email" });
      }

      // Check ban status
      if (user.isBanned) {
        return res.status(403).json({
          message: "Account is banned due to unusual activity",
          user: {
            username: user.username,
            banDate: user.isbanDate,
            reviewDate: new Date(
              user.isbanDate.getTime() + 6 * 24 * 60 * 60 * 1000
            ),
          },
          reason:
            "We've detected unusual activity on your account that violates our terms of service.",
        });
      }

      // Verify password
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({ message: "Invalid password" });
      }

      tokenRole = user.role;
    } else {
      return res.status(404).json({ message: "Invalid login type" });
    }

    // ================================================================
    // CREATE TOKEN AND RESPOND
    // ================================================================
    const tokenDetails = {
      userId: user._id,
      username: user.username,
      role: tokenRole,
    };

    const token = await createTokenForUser(tokenDetails);

    res.cookie("token", token, {
      sameSite: "None",
      httpOnly: true,
      secure: true,
      path: "/",
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });

    res.json({
      message: "Login successful",
      username: user.username,
      email: user.email,
      role: tokenRole,
      chat_id: user._id,
      profileComplete: user.profileComplete || false,
      profilePicture: user.profilePictureUrl || null,
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// ============================================================================
// ADMIN-ONLY ROUTES
// ============================================================================

/**
 * POST /admin/change-password
 * Force password change for admin
 */
router.post(
  "/admin/change-password",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    const { currentPassword, newPassword, totp_code } = req.body;

    try {
      if (!currentPassword || !newPassword || !totp_code) {
        return res.status(400).json({
          message: "Current password, new password, and 2FA code are required",
        });
      }

      const admin = await Admin.findById(req.user.userId);
      if (!admin) {
        return res.status(404).json({ message: "Admin not found" });
      }

      // Verify current password
      const isPasswordValid = await admin.comparePassword(currentPassword);
      if (!isPasswordValid) {
        return res.status(401).json({ message: "Invalid current password" });
      }

      // Verify 2FA
      if (admin.twoFactorEnabled) {
        const isTotpValid = speakeasy.totp.verify({
          secret: admin.twoFactorSecret,
          encoding: "base32",
          token: totp_code.toString().trim(),
          window: 2,
        });

        if (!isTotpValid) {
          return res.status(401).json({ message: "Invalid 2FA code" });
        }
      }

      // Validate new password strength
      const hasUppercase = /[A-Z]/.test(newPassword);
      const hasLowercase = /[a-z]/.test(newPassword);
      const hasNumber = /[0-9]/.test(newPassword);
      const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newPassword);

      if (
        newPassword.length < 12 ||
        !hasUppercase ||
        !hasLowercase ||
        !hasNumber ||
        !hasSpecial
      ) {
        return res.status(400).json({
          message:
            "Password must be 12+ characters with uppercase, lowercase, number, and special character",
        });
      }

      // Update password
      admin.password = newPassword;
      admin.mustChangePassword = false;
      await admin.save();

      // Clear token to force re-login
      res.clearCookie("token", {
        sameSite: "None",
        secure: true,
        path: "/",
      });

      res.json({
        message: "Password changed successfully. Please log in again.",
      });
    } catch (error) {
      console.error("Change Password Error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

/**
 * POST /admin/disable-2fa
 * Disable 2FA (requires secret code and current TOTP)
 */
router.post(
  "/admin/disable-2fa",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    const { secretCode, totp_code } = req.body;

    try {
      if (!secretCode || !totp_code) {
        return res.status(400).json({
          message: "Secret code and 2FA code are required",
        });
      }

      const admin = await Admin.findById(req.user.userId);
      if (!admin) {
        return res.status(404).json({ message: "Admin not found" });
      }

      // Verify secret code
      const isSecretValid = await admin.verifySecretCode(secretCode);
      if (!isSecretValid) {
        return res.status(401).json({ message: "Invalid secret code" });
      }

      // Verify current TOTP
      const isTotpValid = speakeasy.totp.verify({
        secret: admin.twoFactorSecret,
        encoding: "base32",
        token: totp_code.toString().trim(),
        window: 2,
      });

      if (!isTotpValid) {
        return res.status(401).json({ message: "Invalid 2FA code" });
      }

      // Disable 2FA
      admin.twoFactorEnabled = false;
      admin.twoFactorSecret = null;
      admin.twoFactorBackupCodes = [];
      await admin.save();

      res.json({
        message: "2FA disabled. Your account is now less secure.",
      });
    } catch (error) {
      console.error("Disable 2FA Error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// ============================================================================
// LOGOUT AND VERIFICATION ROUTES
// ============================================================================

/**
 * GET /logout
 * Logout user by clearing token
 */
router.get("/logout", verifyToken, async (req, res) => {
  res.clearCookie("token", {
    sameSite: "None",
    secure: true,
    path: "/",
  });
  res.json({ message: "Logout successful" });
});

/**
 * POST /verify-chatting-id
 * Verify chat ID for authenticated user
 */
router.post("/verify-chatting-id", verifyToken, async (req, res) => {
  try {
    res.json({ chat_id: req.user.userId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
