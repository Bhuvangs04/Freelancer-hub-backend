// ============================================================================
// CENTRALIZED ERROR HANDLER MIDDLEWARE
// Provides consistent error handling across all routes
// ============================================================================

/**
 * Custom API Error class
 */
class ApiError extends Error {
  constructor(statusCode, message, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.timestamp = new Date().toISOString();
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Create common error types
 */
const ErrorTypes = {
  BadRequest: (message = "Bad Request") => new ApiError(400, message),
  Unauthorized: (message = "Unauthorized") => new ApiError(401, message),
  Forbidden: (message = "Forbidden") => new ApiError(403, message),
  NotFound: (message = "Resource not found") => new ApiError(404, message),
  Conflict: (message = "Conflict") => new ApiError(409, message),
  ValidationError: (message = "Validation failed") => new ApiError(422, message),
  InternalError: (message = "Internal server error") => new ApiError(500, message, false),
};

/**
 * Async handler wrapper - eliminates try-catch in every route
 * @param {Function} fn - Async route handler function
 * @returns {Function} - Express middleware function
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Not Found handler - for undefined routes
 */
const notFoundHandler = (req, res, next) => {
  const error = new ApiError(404, `Route ${req.originalUrl} not found`);
  next(error);
};

/**
 * Global error handler middleware
 */
const errorHandler = (err, req, res, next) => {
  // Default values
  let statusCode = err.statusCode || 500;
  let message = err.message || "Internal Server Error";

  // Handle specific error types
  if (err.name === "ValidationError") {
    statusCode = 400;
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join(", ");
  }

  if (err.name === "CastError" && err.kind === "ObjectId") {
    statusCode = 400;
    message = "Invalid ID format";
  }

  if (err.code === 11000) {
    // MongoDB duplicate key error
    statusCode = 409;
    const field = Object.keys(err.keyValue)[0];
    message = `${field} already exists`;
  }

  if (err.name === "JsonWebTokenError") {
    statusCode = 401;
    message = "Invalid token";
  }

  if (err.name === "TokenExpiredError") {
    statusCode = 401;
    message = "Token expired";
  }

  // Log error in development
  if (process.env.NODE_ENV !== "production") {
    console.error("Error:", {
      message: err.message,
      stack: err.stack,
      statusCode,
    });
  }

  // Send response
  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
    timestamp: new Date().toISOString(),
  });
};

/**
 * Validation error handler helper
 */
const handleValidationErrors = (errors) => {
  if (errors && errors.length > 0) {
    throw ErrorTypes.ValidationError(errors.join(", "));
  }
};

module.exports = {
  ApiError,
  ErrorTypes,
  asyncHandler,
  notFoundHandler,
  errorHandler,
  handleValidationErrors,
};
