const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Razorpay = require("razorpay");
const { verifyToken, authorize } = require("../middleware/Auth");
const Dispute = require("../models/Dispute");
const Agreement = require("../models/Agreement");
const Milestone = require("../models/Milestone");
const Project = require("../models/Project");
const Escrow = require("../models/Escrow");
const FreelancerEscrow = require("../models/FreelancerEscrow");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
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
        callback_url: `${process.env.FRONTEND_URL || "https://freelancerhub-five.vercel.app"}/disputes/${dispute._id}/payment-success`,
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
 * POST /dispute/:id/message
 * Add a chat message to the dispute thread (both parties + admin)
 */
router.post(
  "/:id/message",
  verifyToken,
  authorize(["client", "freelancer", "admin"]),
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const userRole = req.user.role;
      const { id } = req.params;
      const { message } = req.body;

      if (!isValidObjectId(id)) {
        return res.status(400).json({ message: "Invalid dispute ID" });
      }

      if (!message || message.trim().length === 0) {
        return res.status(400).json({ message: "Message is required" });
      }

      const dispute = await Dispute.findById(id);
      if (!dispute) {
        return res.status(404).json({ message: "Dispute not found" });
      }

      // Verify access
      const isFiler = dispute.filedBy.toString() === userId;
      const isRespondent = dispute.filedAgainst.toString() === userId;
      const isAdmin = userRole === "admin";

      if (!isFiler && !isRespondent && !isAdmin) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      if (["resolved", "withdrawn"].includes(dispute.status)) {
        return res.status(400).json({ message: "Cannot message on a closed dispute" });
      }

      dispute.chatLogs.push({
        message: message.trim(),
        sender: userId,
        senderRole: isAdmin ? "admin" : (isFiler ? dispute.filerRole : (dispute.filerRole === "client" ? "freelancer" : "client")),
        timestamp: new Date(),
      });
      await dispute.save();

      res.json({
        message: "Message sent",
        chatLogs: dispute.chatLogs,
      });
    } catch (err) {
      console.error("Send Message Error:", err);
      res.status(500).json({ message: "Error sending message" });
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
        .populate("projectId", "title budget description status")
        .populate("agreementId", "agreementNumber agreedAmount")
        .populate("milestoneId", "title amount status")
        .populate("clientId", "username email")
        .populate("freelancerId", "username email")
        .populate("filedBy", "username email")
        .populate("filedAgainst", "username email")
        .populate("assignedAdmin", "username");

      if (!dispute) {
        return res.status(404).json({ message: "Dispute not found" });
      }

      // Verify access
      const filerId = dispute.filedBy?._id?.toString() || dispute.filedBy?.toString();
      const respondentId = dispute.filedAgainst?._id?.toString() || dispute.filedAgainst?.toString();
      const isFiler = filerId === userId;
      const isRespondent = respondentId === userId;
      const isAdmin = req.user.role === "admin";

      if (!isFiler && !isRespondent && !isAdmin) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      // Fetch latest agreement & escrow for this project (admin reference)
      let agreementRef = null;
      let escrowRef = null;

      if (dispute.projectId?._id) {
        const projectId = dispute.projectId._id;

        agreementRef = await Agreement.findOne({ projectId, status: "active" })
          .select("agreementNumber agreedAmount status deliverables deadline projectDescription clientSignature.signed freelancerSignature.signed createdAt")
          .lean();

        escrowRef = await Escrow.findOne({ projectId })
          .select("amount originalAmount refundedAmount status adjustmentHistory")
          .lean();
      }

      res.json({ dispute, agreementRef, escrowRef });
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
 *
 * Real-world flow:
 * 1. Auto-calculate amounts from escrow (admin can override for split)
 * 2. Update escrow status and record adjustment history
 * 3. Create FreelancerEscrow (for freelancer payouts) and Transaction records
 * 4. Transition Project status (completed / cancelled / as-is)
 * 5. Update Agreement status
 * 6. Send email notifications to both parties
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

      // ── Input validation ──
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

      // ── Load dispute + parties ──
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

      // ── Load escrow (the money pool) ──
      const escrow = await Escrow.findOne({ projectId: dispute.projectId }).session(session);
      const escrowAmount = escrow ? (escrow.originalAmount || escrow.amount) : 0;

      // ── Auto-calculate financial amounts from escrow ──
      let finalAward = 0;   // amount going to freelancer
      let finalRefund = 0;  // amount going back to client

      if (decision === "freelancer_favor") {
        // Full escrow amount goes to freelancer
        finalAward = escrowAmount;
        finalRefund = 0;
      } else if (decision === "client_favor") {
        // Full escrow amount refunded to client
        finalAward = 0;
        finalRefund = escrowAmount;
      } else if (decision === "split") {
        // Admin specifies amounts, or default 50/50
        finalAward = (awardedAmount && awardedAmount > 0) ? awardedAmount : Math.floor(escrowAmount / 2);
        finalRefund = (refundAmount && refundAmount > 0) ? refundAmount : (escrowAmount - finalAward);

        // Validate split doesn't exceed escrow
        if (finalAward + finalRefund > escrowAmount) {
          await session.abortTransaction();
          return res.status(400).json({
            message: `Split amounts (₹${finalAward} + ₹${finalRefund} = ₹${finalAward + finalRefund}) exceed escrow (₹${escrowAmount})`,
          });
        }
      }
      // dismissed → finalAward = 0, finalRefund = 0 (no money movement)

      // ── Determine awarded party ──
      let awardedTo = null;
      if (decision === "client_favor") awardedTo = dispute.clientId._id;
      else if (decision === "freelancer_favor") awardedTo = dispute.freelancerId._id;

      // ── Resolve the dispute record (with session) ──
      dispute.resolution = {
        decision,
        awardedTo,
        awardedAmount: finalAward,
        refundAmount: finalRefund,
        penaltyApplied: penaltyApplied || false,
        reasoning,
        resolvedBy: adminId,
        resolvedAt: new Date(),
      };
      dispute.status = "resolved";
      dispute.adminActions.push({
        action: "resolved",
        adminId,
        note: `Decision: ${decision} | Award: ₹${finalAward} | Refund: ₹${finalRefund}`,
      });
      await dispute.save({ session });

      // ============================================================
      // ESCROW SYNC — update the main Escrow status
      // ============================================================
      if (escrow && ["funded", "adjusted"].includes(escrow.status)) {
        if (decision === "freelancer_favor") {
          escrow.status = "released";
          escrow.refundedAmount = 0;
          escrow.adjustmentHistory.push({
            previousAmount: escrow.amount,
            newAmount: escrow.amount,
            refundAmount: 0,
            reason: `[DISPUTE RESOLVED] ${dispute.disputeNumber} — Full release to freelancer`,
            adjustedAt: new Date(),
          });
          await escrow.save({ session });

        } else if (decision === "client_favor") {
          escrow.status = "refunded";
          escrow.refundedAmount = escrowAmount;
          escrow.adjustmentHistory.push({
            previousAmount: escrow.amount,
            newAmount: 0,
            refundAmount: escrowAmount,
            reason: `[DISPUTE RESOLVED] ${dispute.disputeNumber} — Full refund to client`,
            adjustedAt: new Date(),
          });
          escrow.amount = 0;
          await escrow.save({ session });

        } else if (decision === "split") {
          escrow.status = "partial_refund";
          escrow.refundedAmount = finalRefund;
          escrow.adjustmentHistory.push({
            previousAmount: escrow.amount,
            newAmount: finalAward,
            refundAmount: finalRefund,
            reason: `[DISPUTE RESOLVED] ${dispute.disputeNumber} — Split (₹${finalAward} freelancer / ₹${finalRefund} client)`,
            adjustedAt: new Date(),
          });
          escrow.amount = finalAward;
          await escrow.save({ session });
        }
        // dismissed → escrow stays as-is
      }

      // ============================================================
      // FINANCIAL RECORDS — FreelancerEscrow + Transactions
      // ============================================================

      // ── Freelancer payout (freelancer_favor or split) ──
      if ((decision === "freelancer_favor" || decision === "split") && finalAward > 0) {
        const freelancerEscrow = new FreelancerEscrow({
          projectId: dispute.projectId,
          freelancerId: dispute.freelancerId._id,
          amount: finalAward,
          status: "paid",
        });
        await freelancerEscrow.save({ session });

        await Transaction.create([{
          escrowId: freelancerEscrow._id,
          type: "dispute_award",
          amount: finalAward,
          status: "completed",
          description: `Dispute ${decision === "split" ? "split " : ""}award to freelancer — ${dispute.disputeNumber}`,
        }], { session });
      }

      // ── Client refund (client_favor or split) ──
      if ((decision === "client_favor" || decision === "split") && finalRefund > 0 && escrow) {
        await Transaction.create([{
          escrowId: escrow._id,
          type: "dispute_refund",
          amount: finalRefund,
          status: "completed",
          description: `Dispute ${decision === "split" ? "split " : ""}refund to client — ${dispute.disputeNumber}`,
          RefundedId: dispute.clientId._id.toString(),
        }], { session });
      }

      // ============================================================
      // PROJECT STATUS TRANSITION
      // ============================================================
      const project = await Project.findById(dispute.projectId).session(session);
      if (project) {
        if (decision === "freelancer_favor") {
          // Freelancer did the work → mark project as completed
          project.status = "completed";
        } else if (decision === "client_favor") {
          // Full refund → cancel the project
          project.status = "cancelled";
        } else if (decision === "split") {
          // Compromise reached → mark project as completed
          project.status = "completed";
        }
        // dismissed → project stays as-is (dispute was invalid)
        if (decision !== "dismissed") {
          await project.save({ session });
        }
      }

      // ============================================================
      // AGREEMENT STATUS TRANSITION
      // ============================================================
      const agreementDoc = await Agreement.findOne({ projectId: dispute.projectId }).sort({ createdAt: -1 }).session(session);
      if (agreementDoc && agreementDoc.status !== "cancelled" && agreementDoc.status !== "completed") {
        if (decision === "client_favor") {
          agreementDoc.status = "cancelled";
        } else if (decision === "freelancer_favor" || decision === "split") {
          agreementDoc.status = "completed";
        }
        if (decision !== "dismissed") {
          await agreementDoc.save({ session });
        }
      }

      await session.commitTransaction();

      // ============================================================
      // EMAIL NOTIFICATIONS
      // ============================================================
      try {
        // Notify client
        await sendDisputeResolvedEmail(
          dispute.clientId.email,
          dispute.clientId.username,
          dispute.disputeNumber,
          decision,
          decision === "client_favor" ? finalRefund : (decision === "split" ? finalRefund : null)
        );

        // Notify freelancer
        await sendDisputeResolvedEmail(
          dispute.freelancerId.email,
          dispute.freelancerId.username,
          dispute.disputeNumber,
          decision,
          decision === "freelancer_favor" ? finalAward : (decision === "split" ? finalAward : null)
        );
      } catch (emailErr) {
        console.error("Email error:", emailErr);
      }

      res.json({
        message: "Dispute resolved successfully",
        dispute: {
          disputeNumber: dispute.disputeNumber,
          decision,
          awardedAmount: finalAward,
          refundAmount: finalRefund,
        },
        projectStatus: project?.status,
      });
    } catch (err) {
      await session.abortTransaction();
      console.error("Resolve Error:", err);
      res.status(500).json({ message: "Error resolving dispute", error: err.message });
    } finally {
      session.endSession();
    }
  }
);

/**
 * PUT /dispute/admin/:id/priority
 * Update dispute priority
 */
router.put(
  "/admin/:id/priority",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { priority } = req.body;
      const validPriorities = ["low", "medium", "high", "urgent"];

      if (!isValidObjectId(id)) {
        return res.status(400).json({ message: "Invalid dispute ID" });
      }
      if (!priority || !validPriorities.includes(priority)) {
        return res.status(400).json({ message: `Priority must be one of: ${validPriorities.join(", ")}` });
      }

      const dispute = await Dispute.findById(id);
      if (!dispute) {
        return res.status(404).json({ message: "Dispute not found" });
      }

      dispute.priority = priority;
      dispute.adminActions.push({
        action: "priority_changed",
        adminId: req.user.userId,
        note: `Priority set to ${priority}`,
      });
      await dispute.save();

      res.json({ message: `Priority updated to ${priority}`, dispute });
    } catch (err) {
      console.error("Priority Update Error:", err);
      res.status(500).json({ message: "Error updating priority" });
    }
  }
);

/**
 * POST /dispute/admin/:id/escalate
 * Escalate dispute
 */
router.post(
  "/admin/:id/escalate",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { note } = req.body;

      if (!isValidObjectId(id)) {
        return res.status(400).json({ message: "Invalid dispute ID" });
      }

      const dispute = await Dispute.findById(id);
      if (!dispute) {
        return res.status(404).json({ message: "Dispute not found" });
      }

      dispute.status = "escalated";
      dispute.adminActions.push({
        action: "escalated",
        adminId: req.user.userId,
        note: note || "Escalated to higher authority",
      });
      await dispute.save();

      res.json({ message: "Dispute escalated", dispute });
    } catch (err) {
      console.error("Escalate Error:", err);
      res.status(500).json({ message: "Error escalating dispute" });
    }
  }
);

module.exports = router;
