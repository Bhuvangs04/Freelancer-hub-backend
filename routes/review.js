const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { verifyToken, authorize } = require("../middleware/Auth");
const ContractReview = require("../models/ContractReview");
const Agreement = require("../models/Agreement");
const Milestone = require("../models/Milestone");
const Activity = require("../models/ActionSchema");

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const logActivity = async (userId, action) => {
  try {
    await Activity.create({ userId, action });
  } catch (error) {
    console.error("Error logging activity:", error);
  }
};

const isValidObjectId = (id) => {
  return (
    mongoose.Types.ObjectId.isValid(id) &&
    new mongoose.Types.ObjectId(id).toString() === id
  );
};

// ============================================================================
// ROUTES
// ============================================================================

/**
 * POST /review/create
 * Submit a review (ONLY after completed contract)
 */
router.post(
  "/create",
  verifyToken,
  authorize(["client", "freelancer"]),
  async (req, res) => {
    try {
      const reviewerId = req.user.userId;
      const {
        agreementId,
        qualityRating,
        communicationRating,
        timelinessRating,
        professionalismRating,
        overallRating,
        comment,
      } = req.body;

      // Validate agreementId
      if (!agreementId || !isValidObjectId(agreementId)) {
        return res.status(400).json({ message: "Valid agreementId is required" });
      }

      // Validate ratings
      const ratings = [qualityRating, communicationRating, timelinessRating, professionalismRating, overallRating];
      for (const rating of ratings) {
        if (!rating || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
          return res.status(400).json({ message: "All ratings must be integers between 1 and 5" });
        }
      }

      // Get agreement and verify completion
      const agreement = await Agreement.findById(agreementId);
      if (!agreement) {
        return res.status(404).json({ message: "Agreement not found" });
      }

      // Verify agreement is completed (fully signed and work done)
      if (!["active", "completed"].includes(agreement.status)) {
        return res.status(400).json({
          message: "Reviews can only be submitted for completed contracts",
        });
      }

      // Verify reviewer is part of this agreement
      const isClient = agreement.clientId.toString() === reviewerId;
      const isFreelancer = agreement.freelancerId.toString() === reviewerId;

      if (!isClient && !isFreelancer) {
        return res.status(403).json({ message: "Unauthorized to review this agreement" });
      }

      // Determine review type and reviewee
      const type = isClient ? "client_to_freelancer" : "freelancer_to_client";
      const revieweeId = isClient ? agreement.freelancerId : agreement.clientId;

      // Check for existing review
      const existingReview = await ContractReview.findOne({
        agreementId,
        reviewerId,
        revieweeId,
      });

      if (existingReview) {
        return res.status(409).json({ message: "You have already reviewed this agreement" });
      }

      // Get milestone stats for this agreement
      const milestones = await Milestone.find({ agreementId });
      const wasDisputed = milestones.some(m => m.status === "disputed");
      const wasEarlyDelivery = milestones.some(m => m.daysEarly > 0);
      const hadPenalty = milestones.some(m => m.penaltyAmount > 0);

      // Create review
      const review = new ContractReview({
        agreementId,
        projectId: agreement.projectId,
        reviewerId,
        revieweeId,
        type,
        qualityRating,
        communicationRating,
        timelinessRating,
        professionalismRating,
        overallRating,
        contractValue: agreement.agreedAmount,
        wasDisputed,
        wasEarlyDelivery,
        hadPenalty,
        comment: comment?.trim().slice(0, 2000),
      });

      await review.save();

      await logActivity(reviewerId, `Submitted review for agreement ${agreement.agreementNumber}`);

      res.status(201).json({
        message: "Review submitted successfully",
        review: {
          _id: review._id,
          overallRating: review.overallRating,
          weightedRating: review.weightedRating,
        },
      });
    } catch (err) {
      console.error("Create Review Error:", err);
      res.status(500).json({ message: "Error creating review", error: err.message });
    }
  }
);

/**
 * GET /review/user/:userId
 * Get all reviews for a user
 */
router.get(
  "/user/:userId",
  verifyToken,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { type, limit } = req.query;

      if (!isValidObjectId(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }

      const reviews = await ContractReview.getReviewsForUser(userId, {
        type,
        limit: parseInt(limit) || 20,
      });

      const averages = await ContractReview.calculateAverageRatings(userId);

      res.json({
        reviews,
        summary: averages,
      });
    } catch (err) {
      console.error("Get Reviews Error:", err);
      res.status(500).json({ message: "Error fetching reviews" });
    }
  }
);

/**
 * GET /review/reputation/:userId
 * Get Contract Reliability Score (CRS) for a user
 */
router.get(
  "/reputation/:userId",
  async (req, res) => {
    try {
      const { userId } = req.params;

      if (!isValidObjectId(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }

      const crs = await ContractReview.calculateCRS(userId);

      res.json({
        userId,
        contractReliabilityScore: crs.score,
        level: crs.level,
        breakdown: crs.breakdown,
        ratings: crs.ratings,
      });
    } catch (err) {
      console.error("Get Reputation Error:", err);
      res.status(500).json({ message: "Error fetching reputation" });
    }
  }
);

/**
 * POST /review/:id/respond
 * Respond to a review (reviewee only)
 */
router.post(
  "/:id/respond",
  verifyToken,
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const { id } = req.params;
      const { comment } = req.body;

      if (!isValidObjectId(id)) {
        return res.status(400).json({ message: "Invalid review ID" });
      }

      if (!comment || comment.trim().length < 10) {
        return res.status(400).json({ message: "Response must be at least 10 characters" });
      }

      const review = await ContractReview.findById(id);

      if (!review) {
        return res.status(404).json({ message: "Review not found" });
      }

      if (review.revieweeId.toString() !== userId) {
        return res.status(403).json({ message: "Only the reviewee can respond" });
      }

      if (review.response?.comment) {
        return res.status(409).json({ message: "Already responded to this review" });
      }

      review.response = {
        comment: comment.trim().slice(0, 1000),
        respondedAt: new Date(),
      };

      await review.save();

      res.json({
        message: "Response submitted",
        response: review.response,
      });
    } catch (err) {
      console.error("Respond to Review Error:", err);
      res.status(500).json({ message: "Error submitting response" });
    }
  }
);

/**
 * GET /review/pending
 * Get agreements awaiting review by current user
 */
router.get(
  "/pending",
  verifyToken,
  authorize(["client", "freelancer"]),
  async (req, res) => {
    try {
      const userId = req.user.userId;

      // Get all active/completed agreements where user is involved
      const agreements = await Agreement.find({
        $or: [{ clientId: userId }, { freelancerId: userId }],
        status: { $in: ["active", "completed"] },
      }).populate("projectId", "title");

      // Check which ones have been reviewed
      const pendingReviews = [];
      for (const agreement of agreements) {
        const existingReview = await ContractReview.findOne({
          agreementId: agreement._id,
          reviewerId: userId,
        });

        if (!existingReview) {
          const isClient = agreement.clientId.toString() === userId;
          pendingReviews.push({
            agreementId: agreement._id,
            agreementNumber: agreement.agreementNumber,
            projectTitle: agreement.projectId?.title || agreement.projectTitle,
            revieweeType: isClient ? "freelancer" : "client",
            agreedAmount: agreement.agreedAmount,
            completedAt: agreement.updatedAt,
          });
        }
      }

      res.json({
        pendingReviews,
        count: pendingReviews.length,
      });
    } catch (err) {
      console.error("Get Pending Reviews Error:", err);
      res.status(500).json({ message: "Error fetching pending reviews" });
    }
  }
);

module.exports = router;
