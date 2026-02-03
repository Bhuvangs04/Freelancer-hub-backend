const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Razorpay = require("razorpay");
const { verifyToken, authorize } = require("../middleware/Auth");
const Dispute = require("../models/Dispute");
const Agreement = require("../models/Agreement");
const Milestone = require("../models/Milestone");
const Project = require("../models/Project");
const FreelancerEscrow = require("../models/FreelancerEscrow");
const Transaction = require("../models/Transaction");
const sendEmail = require("../utils/sendEmail");
const Activity = require("../models/ActionSchema");

// ============================================================================
// RAZORPAY SETUP
// ============================================================================

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

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
// EMAIL NOTIFICATIONS
// ============================================================================

const sendDisputeFiledEmail = async (email, name, disputeNumber, projectTitle) => {
  const subject = `Dispute Filed: ${disputeNumber}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
      <h2 style="color: #f44336;">⚠️ Dispute Filed</h2>
      <p>Hello ${name},</p>
      <p>A dispute has been filed regarding project <strong>"${projectTitle}"</strong>.</p>
      <p><strong>Dispute Number:</strong> ${disputeNumber}</p>
      <p>You have <strong>72 hours</strong> to respond with your evidence.</p>
      <div style="margin: 30px 0;">
        <a href="https://freelancerhub-five.vercel.app/disputes" 
           style="background-color: #f44336; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">
          View & Respond
        </a>
      </div>
      <hr>
      <p style="font-size: 12px; color: #888;">&copy; 2025 FreelancerHub</p>
    </div>
  `;
  await sendEmail(email, subject, html, true);
};

const sendDisputeResolvedEmail = async (email, name, disputeNumber, decision, amount) => {
  const subject = `Dispute Resolved: ${disputeNumber}`;
  const decisionText = {
    client_favor: "in favor of the client",
    freelancer_favor: "in favor of the freelancer",
    split: "with a split decision",
    dismissed: "as dismissed",
  };
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
      <h2 style="color: #4CAF50;">✅ Dispute Resolved</h2>
      <p>Hello ${name},</p>
      <p>Dispute <strong>${disputeNumber}</strong> has been resolved <strong>${decisionText[decision] || decision}</strong>.</p>
      ${amount ? `<p><strong>Amount Awarded:</strong> ₹${amount.toLocaleString()}</p>` : ""}
      <p>This decision is binding. Please review the full resolution in your dashboard.</p>
      <div style="margin: 30px 0;">
        <a href="https://freelancerhub-five.vercel.app/disputes" 
           style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">
          View Resolution
        </a>
      </div>
      <hr>
      <p style="font-size: 12px; color: #888;">&copy; 2025 FreelancerHub</p>
    </div>
  `;
  await sendEmail(email, subject, html, true);
};

// ============================================================================
// USER ROUTES
// ============================================================================

/**
 * POST /dispute/file
 * File a new dispute (requires arbitration fee payment)
 */
router.post(
  "/file",
  verifyToken,
  authorize(["client", "freelancer"]),
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const userRole = req.user.role;
      const { projectId, milestoneId, category, reason, amountInDispute, evidence } = req.body;

      // Validate inputs
      if (!projectId || !isValidObjectId(projectId)) {
        return res.status(400).json({ message: "Valid projectId is required" });
      }

      const validCategories = ["quality", "deadline", "scope", "payment", "communication", "fraud", "other"];
      if (!category || !validCategories.includes(category)) {
        return res.status(400).json({ message: `Category must be one of: ${validCategories.join(", ")}` });
      }

      if (!reason || reason.length < 50) {
        return res.status(400).json({ message: "Reason must be at least 50 characters" });
      }

      if (!amountInDispute || amountInDispute <= 0) {
        return res.status(400).json({ message: "Amount in dispute is required" });
      }

      // Get project and verify access
      const project = await Project.findById(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const isClient = project.clientId.toString() === userId;
      const isFreelancer = project.freelancerId?.toString() === userId;

      if (!isClient && !isFreelancer) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      // Check for existing open dispute
      const existingDispute = await Dispute.findOne({
        projectId,
        status: { $nin: ["resolved", "withdrawn"] },
      });

      if (existingDispute) {
        return res.status(409).json({
          message: "An open dispute already exists for this project",
          disputeNumber: existingDispute.disputeNumber,
        });
      }

      // Get agreement
      const agreement = await Agreement.findOne({ projectId, status: "active" });

      // Create dispute
      const dispute = new Dispute({
        projectId,
        agreementId: agreement?._id,
        milestoneId: milestoneId || null,
        clientId: project.clientId,
        freelancerId: project.freelancerId,
        filedBy: userId,
        filedAgainst: isClient ? project.freelancerId : project.clientId,
        filerRole: isClient ? "client" : "freelancer",
        category,
        reason,
        amountInDispute,
        evidence: evidence || [],
      });

      await dispute.save();

      // Create Razorpay payment link for arbitration fee
      const paymentLink = await razorpay.paymentLink.create({
        amount: dispute.arbitrationFee * 100, // in paise
        currency: "INR",
        accept_partial: false,
        description: `Arbitration Fee - Dispute ${dispute.disputeNumber}`,
        customer: {
          email: req.user.email || "user@example.com",
        },
        notify: {
          email: true,
        },
        callback_url: `https://freelancerhub-five.vercel.app/disputes/${dispute._id}/payment-success`,
        callback_method: "get",
        notes: {
          dispute_id: dispute._id.toString(),
          dispute_number: dispute.disputeNumber,
        },
      });

      dispute.arbitrationPaymentLink = paymentLink.short_url;
      await dispute.save();

      await logActivity(userId, `Filed dispute ${dispute.disputeNumber} for project ${projectId}`);

      res.status(201).json({
        message: "Dispute filed. Pay arbitration fee to proceed.",
        dispute: {
          _id: dispute._id,
          disputeNumber: dispute.disputeNumber,
          status: dispute.status,
          arbitrationFee: dispute.arbitrationFee,
        },
        paymentLink: paymentLink.short_url,
        paymentAmount: dispute.arbitrationFee,
      });
    } catch (err) {
      console.error("File Dispute Error:", err);
      res.status(500).json({ message: "Error filing dispute", error: err.message });
    }
  }
);

/**
 * POST /dispute/:id/confirm-payment
 * Confirm arbitration fee payment
 */
router.post(
  "/:id/confirm-payment",
  verifyToken,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { payment_id } = req.body;
      const userId = req.user.userId;

      if (!isValidObjectId(id)) {
        return res.status(400).json({ message: "Invalid dispute ID" });
      }

      const dispute = await Dispute.findById(id)
        .populate("filedAgainst", "username email")
        .populate("projectId", "title");

      if (!dispute) {
        return res.status(404).json({ message: "Dispute not found" });
      }

      if (dispute.filedBy.toString() !== userId) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      if (dispute.arbitrationFeePaid) {
        return res.status(409).json({ message: "Fee already paid" });
      }

      await dispute.markFeePaid(payment_id);

      // Notify other party
      try {
        await sendDisputeFiledEmail(
          dispute.filedAgainst.email,
          dispute.filedAgainst.username,
          dispute.disputeNumber,
          dispute.projectId.title
        );
      } catch (emailErr) {
        console.error("Email error:", emailErr);
      }

      res.json({
        message: "Payment confirmed. Dispute is now active.",
        dispute: {
          _id: dispute._id,
          disputeNumber: dispute.disputeNumber,
          status: dispute.status,
          responseDeadline: dispute.responseDeadline,
        },
      });
    } catch (err) {
      console.error("Confirm Payment Error:", err);
      res.status(500).json({ message: "Error confirming payment" });
    }
  }
);

/**
 * POST /dispute/:id/evidence
 * Add evidence to dispute
 */
router.post(
  "/:id/evidence",
  verifyToken,
  authorize(["client", "freelancer"]),
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const { id } = req.params;
      const { type, title, description, url } = req.body;

      if (!isValidObjectId(id)) {
        return res.status(400).json({ message: "Invalid dispute ID" });
      }

      if (!type || !title || !url) {
        return res.status(400).json({ message: "Type, title, and url are required" });
      }

      const dispute = await Dispute.findById(id);

      if (!dispute) {
        return res.status(404).json({ message: "Dispute not found" });
      }

      // Verify access
      const isFiler = dispute.filedBy.toString() === userId;
      const isRespondent = dispute.filedAgainst.toString() === userId;

      if (!isFiler && !isRespondent) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      if (["resolved", "withdrawn"].includes(dispute.status)) {
        return res.status(400).json({ message: "Cannot add evidence to closed dispute" });
      }

      await dispute.addEvidence({ type, title, description, url }, userId);

      res.json({
        message: "Evidence added successfully",
        evidenceCount: dispute.evidence.length,
      });
    } catch (err) {
      console.error("Add Evidence Error:", err);
      res.status(500).json({ message: "Error adding evidence" });
    }
  }
);

/**
 * POST /dispute/:id/respond
 * Respondent submits response
 */
router.post(
  "/:id/respond",
  verifyToken,
  authorize(["client", "freelancer"]),
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const { id } = req.params;
      const { response, evidence } = req.body;

      if (!isValidObjectId(id)) {
        return res.status(400).json({ message: "Invalid dispute ID" });
      }

      if (!response || response.length < 50) {
        return res.status(400).json({ message: "Response must be at least 50 characters" });
      }

      const dispute = await Dispute.findById(id);

      if (!dispute) {
        return res.status(404).json({ message: "Dispute not found" });
      }

      if (dispute.filedAgainst.toString() !== userId) {
        return res.status(403).json({ message: "Only the respondent can submit response" });
      }

      if (dispute.respondentResponse?.response) {
        return res.status(409).json({ message: "Response already submitted" });
      }

      await dispute.submitResponse(response, evidence || []);

      res.json({
        message: "Response submitted. Dispute is now under review.",
        status: dispute.status,
      });
    } catch (err) {
      console.error("Submit Response Error:", err);
      res.status(500).json({ message: "Error submitting response" });
    }
  }
);

/**
 * POST /dispute/:id/withdraw
 * Withdraw dispute
 */
router.post(
  "/:id/withdraw",
  verifyToken,
  authorize(["client", "freelancer"]),
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return res.status(400).json({ message: "Invalid dispute ID" });
      }

      const dispute = await Dispute.findById(id);

      if (!dispute) {
        return res.status(404).json({ message: "Dispute not found" });
      }

      if (dispute.filedBy.toString() !== userId) {
        return res.status(403).json({ message: "Only the filer can withdraw" });
      }

      await dispute.withdraw();

      res.json({
        message: "Dispute withdrawn",
        disputeNumber: dispute.disputeNumber,
      });
    } catch (err) {
      console.error("Withdraw Error:", err);
      res.status(500).json({ message: err.message || "Error withdrawing dispute" });
    }
  }
);

/**
 * GET /dispute/my
 * Get user's disputes
 */
router.get(
  "/my",
  verifyToken,
  authorize(["client", "freelancer"]),
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const { status } = req.query;

      const query = {
        $or: [{ filedBy: userId }, { filedAgainst: userId }],
      };

      if (status) {
        query.status = status;
      }

      const disputes = await Dispute.find(query)
        .populate("projectId", "title")
        .populate("filedBy", "username")
        .populate("filedAgainst", "username")
        .sort({ createdAt: -1 });

      res.json({ disputes });
    } catch (err) {
      console.error("Get Disputes Error:", err);
      res.status(500).json({ message: "Error fetching disputes" });
    }
  }
);

/**
 * GET /dispute/:id
 * Get dispute details
 */
router.get(
  "/:id",
  verifyToken,
  authorize(["client", "freelancer", "admin"]),
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return res.status(400).json({ message: "Invalid dispute ID" });
      }

      const dispute = await Dispute.findById(id)
        .populate("projectId", "title budget description")
        .populate("agreementId", "agreementNumber agreedAmount")
        .populate("milestoneId", "title amount status")
        .populate("clientId", "username email")
        .populate("freelancerId", "username email")
        .populate("assignedAdmin", "username");

      if (!dispute) {
        return res.status(404).json({ message: "Dispute not found" });
      }

      // Verify access
      const isFiler = dispute.filedBy.toString() === userId;
      const isRespondent = dispute.filedAgainst.toString() === userId;
      const isAdmin = req.user.role === "admin";

      if (!isFiler && !isRespondent && !isAdmin) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      res.json({ dispute });
    } catch (err) {
      console.error("Get Dispute Error:", err);
      res.status(500).json({ message: "Error fetching dispute" });
    }
  }
);

// ============================================================================
// ADMIN ROUTES
// ============================================================================

/**
 * GET /dispute/admin/dashboard
 * Admin dispute dashboard
 */
router.get(
  "/admin/dashboard",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    try {
      const { status, priority, limit } = req.query;

      const disputes = await Dispute.getAdminDashboard({
        status,
        priority,
        limit: parseInt(limit) || 50,
      });

      const stats = await Dispute.getStats();

      res.json({ disputes, stats });
    } catch (err) {
      console.error("Admin Dashboard Error:", err);
      res.status(500).json({ message: "Error fetching dashboard" });
    }
  }
);

/**
 * POST /dispute/admin/:id/assign
 * Assign dispute to admin
 */
router.post(
  "/admin/:id/assign",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    try {
      const adminId = req.user.userId;
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return res.status(400).json({ message: "Invalid dispute ID" });
      }

      const dispute = await Dispute.findById(id);

      if (!dispute) {
        return res.status(404).json({ message: "Dispute not found" });
      }

      await dispute.assignToAdmin(adminId);

      res.json({
        message: "Dispute assigned to you",
        disputeNumber: dispute.disputeNumber,
      });
    } catch (err) {
      console.error("Assign Error:", err);
      res.status(500).json({ message: "Error assigning dispute" });
    }
  }
);

/**
 * POST /dispute/admin/:id/resolve
 * Resolve dispute (admin decision)
 */
router.post(
  "/admin/:id/resolve",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    const session = await mongoose.startSession();
    
    try {
      const adminId = req.user.userId;
      const { id } = req.params;
      const { decision, awardedAmount, refundAmount, reasoning, penaltyApplied } = req.body;

      if (!isValidObjectId(id)) {
        return res.status(400).json({ message: "Invalid dispute ID" });
      }

      const validDecisions = ["client_favor", "freelancer_favor", "split", "dismissed"];
      if (!decision || !validDecisions.includes(decision)) {
        return res.status(400).json({ message: `Decision must be one of: ${validDecisions.join(", ")}` });
      }

      if (!reasoning || reasoning.length < 20) {
        return res.status(400).json({ message: "Reasoning must be at least 20 characters" });
      }

      session.startTransaction();

      const dispute = await Dispute.findById(id)
        .populate("clientId", "username email")
        .populate("freelancerId", "username email")
        .session(session);

      if (!dispute) {
        await session.abortTransaction();
        return res.status(404).json({ message: "Dispute not found" });
      }

      if (dispute.status === "resolved") {
        await session.abortTransaction();
        return res.status(409).json({ message: "Dispute already resolved" });
      }

      // Determine awarded party
      let awardedTo = null;
      if (decision === "client_favor") {
        awardedTo = dispute.clientId._id;
      } else if (decision === "freelancer_favor") {
        awardedTo = dispute.freelancerId._id;
      }

      // Resolve dispute
      await dispute.resolve(
        {
          decision,
          awardedTo,
          awardedAmount: awardedAmount || 0,
          refundAmount: refundAmount || 0,
          penaltyApplied: penaltyApplied || false,
          reasoning,
        },
        adminId
      );

      // Process financial resolution if applicable
      if (awardedAmount && awardedAmount > 0 && awardedTo) {
        if (decision === "freelancer_favor") {
          // Pay freelancer
          const freelancerEscrow = new FreelancerEscrow({
            projectId: dispute.projectId,
            freelancerId: dispute.freelancerId._id,
            amount: awardedAmount,
            status: "paid",
          });
          await freelancerEscrow.save({ session });

          await Transaction.create([{
            escrowId: freelancerEscrow._id,
            type: "dispute_award",
            amount: awardedAmount,
            status: "completed",
            description: `Dispute resolution award - ${dispute.disputeNumber}`,
          }], { session });
        }
        // Note: Client refund would be processed via Razorpay refund
      }

      await session.commitTransaction();

      // Send notifications
      try {
        await sendDisputeResolvedEmail(
          dispute.clientId.email,
          dispute.clientId.username,
          dispute.disputeNumber,
          decision,
          decision === "client_favor" ? awardedAmount : null
        );

        await sendDisputeResolvedEmail(
          dispute.freelancerId.email,
          dispute.freelancerId.username,
          dispute.disputeNumber,
          decision,
          decision === "freelancer_favor" ? awardedAmount : null
        );
      } catch (emailErr) {
        console.error("Email error:", emailErr);
      }

      res.json({
        message: "Dispute resolved",
        dispute: {
          disputeNumber: dispute.disputeNumber,
          decision,
          awardedAmount,
        },
      });
    } catch (err) {
      await session.abortTransaction();
      console.error("Resolve Error:", err);
      res.status(500).json({ message: "Error resolving dispute" });
    } finally {
      session.endSession();
    }
  }
);

module.exports = router;
