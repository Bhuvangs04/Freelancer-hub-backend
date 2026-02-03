const mongoose = require("mongoose");

// ============================================================================
// CONTRACT REVIEW SCHEMA
// ============================================================================

const ContractReviewSchema = new mongoose.Schema(
  {
    // Required: Must have completed agreement
    agreementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agreement",
      required: true,
      index: true,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },

    // Reviewer and Reviewee
    reviewerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    revieweeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Review Type
    type: {
      type: String,
      enum: ["client_to_freelancer", "freelancer_to_client"],
      required: true,
    },

    // Individual Ratings (1-5 scale)
    qualityRating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    communicationRating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    timelinessRating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    professionalismRating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    overallRating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },

    // Weighting Factors
    contractValue: {
      type: Number,
      required: true,
      min: 0,
    },
    wasDisputed: {
      type: Boolean,
      default: false,
    },
    wasEarlyDelivery: {
      type: Boolean,
      default: false,
    },
    hadPenalty: {
      type: Boolean,
      default: false,
    },

    // Review Content
    comment: {
      type: String,
      maxlength: 2000,
      trim: true,
    },

    // Verification
    isVerified: {
      type: Boolean,
      default: true, // Auto-verified because linked to completed agreement
    },
    verifiedAt: {
      type: Date,
      default: Date.now,
    },

    // Calculated weighted rating
    weightedRating: {
      type: Number,
    },

    // Response from reviewee
    response: {
      comment: { type: String, maxlength: 1000 },
      respondedAt: { type: Date },
    },
  },
  { timestamps: true }
);

// ============================================================================
// INDEXES
// ============================================================================

// Prevent duplicate reviews
ContractReviewSchema.index(
  { agreementId: 1, reviewerId: 1, revieweeId: 1 },
  { unique: true }
);

// ============================================================================
// PRE-SAVE HOOKS
// ============================================================================

ContractReviewSchema.pre("save", function (next) {
  if (this.isNew || this.isModified("overallRating") || this.isModified("contractValue")) {
    this.calculateWeightedRating();
  }
  next();
});

// ============================================================================
// INSTANCE METHODS
// ============================================================================

/**
 * Calculate weighted rating based on contract value and dispute status
 */
ContractReviewSchema.methods.calculateWeightedRating = function () {
  // Base weight from contract value (higher value = more weight)
  const avgContractValue = 10000; // Assumed average
  let valueMultiplier = Math.min(this.contractValue / avgContractValue, 3); // Cap at 3x
  valueMultiplier = Math.max(valueMultiplier, 0.5); // Minimum 0.5x

  // Dispute penalty (disputed reviews count less)
  const disputeMultiplier = this.wasDisputed ? 0.5 : 1;

  // Calculate weighted rating
  this.weightedRating = this.overallRating * valueMultiplier * disputeMultiplier;

  return this.weightedRating;
};

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Get all reviews for a user
 */
ContractReviewSchema.statics.getReviewsForUser = async function (userId, options = {}) {
  const query = { revieweeId: userId };
  
  if (options.type) {
    query.type = options.type;
  }

  return this.find(query)
    .populate("reviewerId", "username")
    .populate("projectId", "title")
    .sort({ createdAt: -1 })
    .limit(options.limit || 50);
};

/**
 * Calculate average ratings for a user
 */
ContractReviewSchema.statics.calculateAverageRatings = async function (userId) {
  const result = await this.aggregate([
    { $match: { revieweeId: new mongoose.Types.ObjectId(userId) } },
    {
      $group: {
        _id: null,
        totalReviews: { $sum: 1 },
        avgQuality: { $avg: "$qualityRating" },
        avgCommunication: { $avg: "$communicationRating" },
        avgTimeliness: { $avg: "$timelinessRating" },
        avgProfessionalism: { $avg: "$professionalismRating" },
        avgOverall: { $avg: "$overallRating" },
        avgWeighted: { $avg: "$weightedRating" },
        totalContractValue: { $sum: "$contractValue" },
        disputedCount: { $sum: { $cond: ["$wasDisputed", 1, 0] } },
        earlyDeliveryCount: { $sum: { $cond: ["$wasEarlyDelivery", 1, 0] } },
        penaltyCount: { $sum: { $cond: ["$hadPenalty", 1, 0] } },
      },
    },
  ]);

  if (result.length === 0) {
    return {
      totalReviews: 0,
      avgQuality: 0,
      avgCommunication: 0,
      avgTimeliness: 0,
      avgProfessionalism: 0,
      avgOverall: 0,
      avgWeighted: 0,
      totalContractValue: 0,
      disputedCount: 0,
      earlyDeliveryCount: 0,
      penaltyCount: 0,
    };
  }

  return {
    ...result[0],
    avgQuality: Math.round(result[0].avgQuality * 10) / 10,
    avgCommunication: Math.round(result[0].avgCommunication * 10) / 10,
    avgTimeliness: Math.round(result[0].avgTimeliness * 10) / 10,
    avgProfessionalism: Math.round(result[0].avgProfessionalism * 10) / 10,
    avgOverall: Math.round(result[0].avgOverall * 10) / 10,
    avgWeighted: Math.round(result[0].avgWeighted * 10) / 10,
  };
};

/**
 * Calculate Contract Reliability Score (CRS)
 * Score Range: 0-100+
 */
ContractReviewSchema.statics.calculateCRS = async function (userId) {
  const ratings = await this.calculateAverageRatings(userId);
  const Agreement = mongoose.model("Agreement");

  // Get completed contracts count
  const completedContracts = await Agreement.countDocuments({
    $or: [{ clientId: userId }, { freelancerId: userId }],
    status: { $in: ["completed", "active"] },
  });

  // Calculate CRS
  let crs = 0;

  // Completed contracts component (max 40 points)
  crs += Math.min(completedContracts * 4, 40);

  // Contract value component (max 20 points)
  crs += Math.min(ratings.totalContractValue / 5000, 20);

  // Rating component (max 25 points)
  crs += (ratings.avgOverall / 5) * 25;

  // Early delivery bonus (max 10 points)
  crs += Math.min(ratings.earlyDeliveryCount * 2, 10);

  // Dispute penalty (-5 per dispute, max -20)
  crs -= Math.min(ratings.disputedCount * 5, 20);

  // Penalty occurrence penalty (-3 per penalty, max -15)
  crs -= Math.min(ratings.penaltyCount * 3, 15);

  // Ensure minimum 0
  crs = Math.max(crs, 0);

  return {
    score: Math.round(crs),
    level: getCRSLevel(crs),
    breakdown: {
      completedContracts,
      totalContractValue: ratings.totalContractValue,
      avgRating: ratings.avgOverall,
      earlyDeliveries: ratings.earlyDeliveryCount,
      disputes: ratings.disputedCount,
      penalties: ratings.penaltyCount,
    },
    ratings,
  };
};

/**
 * Get CRS level label
 */
function getCRSLevel(score) {
  if (score >= 90) return "Elite";
  if (score >= 75) return "Expert";
  if (score >= 60) return "Professional";
  if (score >= 40) return "Intermediate";
  if (score >= 20) return "Rising";
  return "New";
}

module.exports = mongoose.model("ContractReview", ContractReviewSchema);
