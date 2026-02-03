// ============================================================================
// APPLICATION CONSTANTS
// Centralized configuration values for consistency across the application
// ============================================================================

// ============================================================================
// USER ROLES
// ============================================================================

const ROLES = {
  CLIENT: "client",
  FREELANCER: "freelancer",
  ADMIN: "admin",
};

const ALL_ROLES = Object.values(ROLES);

// ============================================================================
// PROJECT STATUS
// ============================================================================

const PROJECT_STATUS = {
  OPEN: "open",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  ON_HOLD: "on_hold",
};

const ALL_PROJECT_STATUSES = Object.values(PROJECT_STATUS);

// ============================================================================
// BID STATUS
// ============================================================================

const BID_STATUS = {
  PENDING: "pending",
  SIGN_PENDING: "sign_pending",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  AGREEMENT_CANCELLED: "agreement_cancelled",
  WITHDRAWN: "withdrawn",
};

const ALL_BID_STATUSES = Object.values(BID_STATUS);

// ============================================================================
// AGREEMENT STATUS
// ============================================================================

const AGREEMENT_STATUS = {
  PENDING_CLIENT: "pending_client",
  PENDING_FREELANCER: "pending_freelancer",
  ACTIVE: "active",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  DISPUTED: "disputed",
};

const ALL_AGREEMENT_STATUSES = Object.values(AGREEMENT_STATUS);

// ============================================================================
// MILESTONE STATUS
// ============================================================================

const MILESTONE_STATUS = {
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  SUBMITTED: "submitted",
  REVISION: "revision",
  CONFIRMED: "confirmed",
  DISPUTED: "disputed",
  RELEASED: "released",
  CANCELLED: "cancelled",
};

const ALL_MILESTONE_STATUSES = Object.values(MILESTONE_STATUS);

// ============================================================================
// DISPUTE STATUS
// ============================================================================

const DISPUTE_STATUS = {
  PENDING_PAYMENT: "pending_payment",
  OPEN: "open",
  UNDER_REVIEW: "under_review",
  AWAITING_RESPONSE: "awaiting_response",
  RESOLVED: "resolved",
  ESCALATED: "escalated",
  WITHDRAWN: "withdrawn",
};

const ALL_DISPUTE_STATUSES = Object.values(DISPUTE_STATUS);

// ============================================================================
// DISPUTE CATEGORIES
// ============================================================================

const DISPUTE_CATEGORIES = {
  QUALITY: "quality",
  DEADLINE: "deadline",
  SCOPE: "scope",
  PAYMENT: "payment",
  COMMUNICATION: "communication",
  FRAUD: "fraud",
  OTHER: "other",
};

const ALL_DISPUTE_CATEGORIES = Object.values(DISPUTE_CATEGORIES);

// ============================================================================
// PAYMENT STATUS
// ============================================================================

const PAYMENT_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
  REFUNDED: "refunded",
};

const ALL_PAYMENT_STATUSES = Object.values(PAYMENT_STATUS);

// ============================================================================
// SKILL VERIFICATION STATUS
// ============================================================================

const SKILL_VERIFICATION_STATUS = {
  PENDING: "pending",
  VERIFIED: "verified",
  REJECTED: "rejected",
  EXPIRED: "expired",
};

const ALL_SKILL_VERIFICATION_STATUSES = Object.values(SKILL_VERIFICATION_STATUS);

// ============================================================================
// DEFAULT VALUES
// ============================================================================

const DEFAULTS = {
  PLATFORM_FEE_PERCENT: 10,
  MAX_FILE_SIZE_MB: 10,
  MAX_IMAGE_SIZE_MB: 5,
  PAGINATION_LIMIT: 20,
  MAX_PAGINATION_LIMIT: 100,
  AUTO_RELEASE_HOURS: 72,
  RESPONSE_DEADLINE_HOURS: 72,
  RESOLUTION_DEADLINE_DAYS: 7,
  PASSWORD_MIN_LENGTH: 8,
  ADMIN_PASSWORD_MIN_LENGTH: 12,
  USERNAME_MIN_LENGTH: 3,
  USERNAME_MAX_LENGTH: 30,
  MAX_REVISIONS: 3,
  PENALTY_PERCENT_PER_DAY: 5,
  MAX_PENALTY_PERCENT: 50,
  BONUS_PERCENT: 3,
};

// ============================================================================
// ARBITRATION FEE TIERS
// ============================================================================

const ARBITRATION_FEE_TIERS = [
  { maxAmount: 5000, fee: 100 },
  { maxAmount: 20000, fee: 200 },
  { maxAmount: 50000, fee: 350 },
  { maxAmount: Infinity, fee: 500 },
];

/**
 * Get arbitration fee based on dispute amount
 * @param {number} amount - Dispute amount
 * @returns {number} - Arbitration fee
 */
const getArbitrationFee = (amount) => {
  for (const tier of ARBITRATION_FEE_TIERS) {
    if (amount <= tier.maxAmount) {
      return tier.fee;
    }
  }
  return 500;
};

// ============================================================================
// CRS LEVELS
// ============================================================================

const CRS_LEVELS = {
  NEW: { min: 0, max: 19, label: "New" },
  RISING: { min: 20, max: 39, label: "Rising" },
  INTERMEDIATE: { min: 40, max: 59, label: "Intermediate" },
  PROFESSIONAL: { min: 60, max: 74, label: "Professional" },
  EXPERT: { min: 75, max: 89, label: "Expert" },
  ELITE: { min: 90, max: Infinity, label: "Elite" },
};

/**
 * Get CRS level from score
 * @param {number} score - CRS score
 * @returns {string} - Level label
 */
const getCRSLevel = (score) => {
  for (const [, level] of Object.entries(CRS_LEVELS)) {
    if (score >= level.min && score <= level.max) {
      return level.label;
    }
  }
  return "New";
};

// ============================================================================
// ALLOWED FILE TYPES
// ============================================================================

const ALLOWED_FILE_TYPES = {
  IMAGES: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  DOCUMENTS: ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ARCHIVES: ["application/zip", "application/x-rar-compressed"],
  ALL: ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip"],
};

module.exports = {
  ROLES,
  ALL_ROLES,
  PROJECT_STATUS,
  ALL_PROJECT_STATUSES,
  BID_STATUS,
  ALL_BID_STATUSES,
  AGREEMENT_STATUS,
  ALL_AGREEMENT_STATUSES,
  MILESTONE_STATUS,
  ALL_MILESTONE_STATUSES,
  DISPUTE_STATUS,
  ALL_DISPUTE_STATUSES,
  DISPUTE_CATEGORIES,
  ALL_DISPUTE_CATEGORIES,
  PAYMENT_STATUS,
  ALL_PAYMENT_STATUSES,
  SKILL_VERIFICATION_STATUS,
  ALL_SKILL_VERIFICATION_STATUSES,
  DEFAULTS,
  ARBITRATION_FEE_TIERS,
  getArbitrationFee,
  CRS_LEVELS,
  getCRSLevel,
  ALLOWED_FILE_TYPES,
};
