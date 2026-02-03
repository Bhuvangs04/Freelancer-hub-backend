// ============================================================================
// VALIDATION UTILITIES
// Centralized validation functions for consistent data validation
// ============================================================================

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} - True if valid email
 */
const isValidEmail = (email) => {
  if (!email || typeof email !== "string") return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
};

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @returns {{valid: boolean, errors: string[]}} - Validation result
 */
const validatePasswordStrength = (password) => {
  const errors = [];

  if (!password || typeof password !== "string") {
    return { valid: false, errors: ["Password is required"] };
  }

  if (password.length < 8) {
    errors.push("Password must be at least 8 characters");
  }

  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  }

  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter");
  }

  if (!/[0-9]/.test(password)) {
    errors.push("Password must contain at least one number");
  }

  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push("Password must contain at least one special character");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

/**
 * Validate strong password (for admin)
 * @param {string} password - Password to validate
 * @returns {{valid: boolean, errors: string[]}} - Validation result
 */
const validateStrongPassword = (password) => {
  const errors = [];

  if (!password || typeof password !== "string") {
    return { valid: false, errors: ["Password is required"] };
  }

  if (password.length < 12) {
    errors.push("Password must be at least 12 characters");
  }

  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  }

  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter");
  }

  if (!/[0-9]/.test(password)) {
    errors.push("Password must contain at least one number");
  }

  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push("Password must contain at least one special character");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

/**
 * Validate URL format
 * @param {string} url - URL to validate
 * @returns {boolean} - True if valid URL
 */
const isValidUrl = (url) => {
  if (!url || typeof url !== "string") return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

/**
 * Validate phone number (Indian format)
 * @param {string} phone - Phone number to validate
 * @returns {boolean} - True if valid
 */
const isValidPhone = (phone) => {
  if (!phone || typeof phone !== "string") return false;
  const phoneRegex = /^[6-9]\d{9}$/;
  return phoneRegex.test(phone.replace(/\D/g, ""));
};

/**
 * Validate amount (positive number)
 * @param {any} amount - Amount to validate
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {boolean} - True if valid
 */
const isValidAmount = (amount, min = 0, max = Infinity) => {
  const num = parseFloat(amount);
  return !isNaN(num) && num >= min && num <= max;
};

/**
 * Validate date
 * @param {any} date - Date to validate
 * @returns {boolean} - True if valid date
 */
const isValidDate = (date) => {
  if (!date) return false;
  const d = new Date(date);
  return d instanceof Date && !isNaN(d);
};

/**
 * Validate date is in future
 * @param {any} date - Date to validate
 * @returns {boolean} - True if future date
 */
const isFutureDate = (date) => {
  if (!isValidDate(date)) return false;
  return new Date(date) > new Date();
};

/**
 * Validate enum value
 * @param {string} value - Value to validate
 * @param {string[]} allowedValues - Allowed values
 * @returns {boolean} - True if valid
 */
const isValidEnum = (value, allowedValues) => {
  if (!value || !Array.isArray(allowedValues)) return false;
  return allowedValues.includes(value);
};

/**
 * Validate file type
 * @param {object} file - Multer file object
 * @param {string[]} allowedTypes - Allowed MIME types
 * @param {number} maxSize - Max file size in bytes
 * @returns {{valid: boolean, error: string|null}}
 */
const validateFile = (file, allowedTypes = [], maxSize = 5 * 1024 * 1024) => {
  if (!file) {
    return { valid: false, error: "No file provided" };
  }

  if (allowedTypes.length > 0 && !allowedTypes.includes(file.mimetype)) {
    return { valid: false, error: `File type not allowed. Allowed: ${allowedTypes.join(", ")}` };
  }

  if (file.size > maxSize) {
    return { valid: false, error: `File too large. Maximum size: ${maxSize / (1024 * 1024)}MB` };
  }

  return { valid: true, error: null };
};

/**
 * Sanitize and validate username
 * @param {string} username - Username to validate
 * @returns {{valid: boolean, sanitized: string, error: string|null}}
 */
const validateUsername = (username) => {
  if (!username || typeof username !== "string") {
    return { valid: false, sanitized: "", error: "Username is required" };
  }

  const sanitized = username.trim();

  if (sanitized.length < 3) {
    return { valid: false, sanitized, error: "Username must be at least 3 characters" };
  }

  if (sanitized.length > 30) {
    return { valid: false, sanitized, error: "Username must be at most 30 characters" };
  }

  if (!/^[a-zA-Z0-9_]+$/.test(sanitized)) {
    return { valid: false, sanitized, error: "Username can only contain letters, numbers, and underscores" };
  }

  return { valid: true, sanitized, error: null };
};

module.exports = {
  isValidEmail,
  validatePasswordStrength,
  validateStrongPassword,
  isValidUrl,
  isValidPhone,
  isValidAmount,
  isValidDate,
  isFutureDate,
  isValidEnum,
  validateFile,
  validateUsername,
};
