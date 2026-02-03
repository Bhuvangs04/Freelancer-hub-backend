const JWT = require("jsonwebtoken");
const Action = require("../models/ActionSchema");

// ============================================================================
// JWT SECRET - From environment variable (Critical Security Fix)
// ============================================================================

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error("CRITICAL: JWT_SECRET not set in environment variables!");
    // Fallback for development only - should never be used in production
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET must be set in production");
    }
    return "development-only-secret-change-in-production";
  }
  return secret;
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Log user activity
 */
const logActivity = async (userId, action) => {
  try {
    await Action.create({ userId, action });
  } catch (error) {
    console.error("Error logging activity:", error);
  }
};

// ============================================================================
// TOKEN FUNCTIONS
// ============================================================================

/**
 * Create JWT token for authenticated user
 */
async function createTokenForUser(user) {
  const payload = {
    userId: user.userId,
    username: user.username,
    role: user.role,
  };
  const token = JWT.sign(payload, getJwtSecret(), { expiresIn: "1d" });
  return token;
}

/**
 * Verify JWT token middleware
 */
async function verifyToken(req, res, next) {
  const token = req.cookies.token;

  if (!token) {
    return res.status(403).json({
      errorType: "No Direct Access Allowed",
      message: "Please login to access this resource.",
      errorCode: 403,
      errorStatus: "Forbidden",
    });
  }

  try {
    const decoded = JWT.verify(token, getJwtSecret());
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({
        error: "Token expired. Please login again."
      });
    }
    return res.status(403).json({ error: "Unauthorized" });
  }
}

// ============================================================================
// AUTHORIZATION MIDDLEWARE
// ============================================================================

/**
 * Role-based authorization middleware
 * @param {string[]} roles - Allowed roles
 */
const authorize = (roles) => async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    if (!roles.includes(req.user.role)) {
      await logActivity(
        req.user.userId,
        `Attempted unauthorized access. Route requires: ${roles.join(", ")}`
      );
      return res.status(403).json({
        message: "Forbidden",
        error: "You do not have the necessary permissions.",
      });
    }
    next();
  } catch (error) {
    console.error("Authorization error:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

module.exports = { createTokenForUser, verifyToken, authorize, logActivity };
