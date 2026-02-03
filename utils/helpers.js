const mongoose = require("mongoose");
const Activity = require("../models/ActionSchema");

// ============================================================================
// SHARED HELPER FUNCTIONS
// Centralized utilities to reduce duplication across routes
// ============================================================================

/**
 * Log user activity to database
 * @param {string} userId - User ID
 * @param {string} action - Action description
 */
const logActivity = async (userId, action) => {
  try {
    await Activity.create({ userId, action });
  } catch (error) {
    console.error("Error logging activity:", error);
  }
};

/**
 * Validate MongoDB ObjectId
 * @param {string} id - ID to validate
 * @returns {boolean} - True if valid ObjectId
 */
const isValidObjectId = (id) => {
  if (!id || typeof id !== "string") return false;
  return (
    mongoose.Types.ObjectId.isValid(id) &&
    new mongoose.Types.ObjectId(id).toString() === id
  );
};

/**
 * Get client IP address from request
 * Handles proxied requests (X-Forwarded-For)
 * @param {object} req - Express request object
 * @returns {string} - Client IP address
 */
const getClientIp = (req) => {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    req.ip ||
    "unknown"
  );
};

/**
 * Format currency in INR
 * @param {number} amount - Amount to format
 * @returns {string} - Formatted currency string
 */
const formatCurrency = (amount) => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
};

/**
 * Calculate platform fee
 * @param {number} amount - Base amount
 * @param {number} feePercent - Fee percentage (default 10%)
 * @returns {number} - Fee amount
 */
const calculatePlatformFee = (amount, feePercent = 10) => {
  return Math.round(amount * (feePercent / 100) * 100) / 100;
};

/**
 * Generate unique reference number
 * @param {string} prefix - Prefix for the reference (e.g., "INV", "AGR")
 * @returns {string} - Unique reference number
 */
const generateReference = (prefix = "REF") => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
};

/**
 * Get date range for a period
 * @param {string} period - Period: "today", "week", "month", "year", "all"
 * @returns {{start: Date, end: Date}} - Date range
 */
const getDateRange = (period) => {
  const now = new Date();
  let start, end;

  switch (period) {
    case "today":
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      end = new Date();
      break;
    case "week":
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      end = new Date();
      break;
    case "month":
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date();
      break;
    case "year":
      start = new Date(now.getFullYear(), 0, 1);
      end = new Date();
      break;
    default:
      start = new Date(0);
      end = new Date();
  }

  return { start, end };
};

/**
 * Sanitize string for safe database storage
 * @param {string} str - String to sanitize
 * @param {number} maxLength - Maximum length
 * @returns {string} - Sanitized string
 */
const sanitizeString = (str, maxLength = 1000) => {
  if (!str || typeof str !== "string") return "";
  return str.trim().slice(0, maxLength);
};

/**
 * Parse pagination parameters
 * @param {object} query - Query parameters
 * @returns {{page: number, limit: number, skip: number}}
 */
const parsePagination = (query) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 20));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

/**
 * Create standard API error response
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code
 * @param {object} details - Additional details
 * @returns {object} - Error response object
 */
const createErrorResponse = (message, statusCode = 500, details = null) => {
  return {
    success: false,
    message,
    statusCode,
    ...(details && { details }),
  };
};

/**
 * Create standard API success response
 * @param {string} message - Success message
 * @param {object} data - Response data
 * @returns {object} - Success response object
 */
const createSuccessResponse = (message, data = {}) => {
  return {
    success: true,
    message,
    ...data,
  };
};

/**
 * Sleep/delay function
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = {
  logActivity,
  isValidObjectId,
  getClientIp,
  formatCurrency,
  calculatePlatformFee,
  generateReference,
  getDateRange,
  sanitizeString,
  parsePagination,
  createErrorResponse,
  createSuccessResponse,
  sleep,
};
