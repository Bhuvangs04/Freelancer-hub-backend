const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { verifyToken, authorize } = require("../middleware/Auth");
const Milestone = require("../models/Milestone");
const Agreement = require("../models/Agreement");
const Project = require("../models/Project");
const FreelancerEscrow = require("../models/FreelancerEscrow");
const Transaction = require("../models/Transaction");
const sendEmail = require("../utils/sendEmail");
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
// EMAIL NOTIFICATIONS
// ============================================================================

const sendMilestoneSubmittedEmail = async (clientEmail, clientName, projectTitle, milestoneTitle) => {
  const subject = `Milestone Submitted: "${milestoneTitle}"`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
      <h2 style="color: #4CAF50;">📦 Milestone Submitted for Review</h2>
      <p>Hello ${clientName},</p>
      <p>The freelancer has submitted milestone <strong>"${milestoneTitle}"</strong> for project <strong>"${projectTitle}"</strong>.</p>
      <p style="color: #FF5722;"><strong>⏰ Auto-release in 72 hours if no action taken.</strong></p>
      <div style="margin: 30px 0;">
        <a href="https://freelancerhub-five.vercel.app/milestones" 
           style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">
          Review & Confirm
        </a>
      </div>
      <hr>
      <p style="font-size: 12px; color: #888;">&copy; 2025 FreelancerHub</p>
    </div>
  `;
  await sendEmail(clientEmail, subject, html, true);
};

const sendMilestoneConfirmedEmail = async (freelancerEmail, freelancerName, milestoneTitle, amount, bonus) => {
  const subject = `✅ Milestone Confirmed: "${milestoneTitle}"`;
  const bonusText = bonus > 0 ? `<p style="color: #4CAF50;"><strong>🎉 Early delivery bonus: +₹${bonus}</strong></p>` : "";
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
      <h2 style="color: #4CAF50;">✅ Milestone Confirmed!</h2>
      <p>Hello ${freelancerName},</p>
      <p>Your milestone <strong>"${milestoneTitle}"</strong> has been confirmed by the client.</p>
      <p><strong>Amount Released:</strong> ₹${amount.toLocaleString()}</p>
      ${bonusText}
      <hr>
      <p style="font-size: 12px; color: #888;">&copy; 2025 FreelancerHub</p>
    </div>
  `;
  await sendEmail(freelancerEmail, subject, html, true);
};

const sendMilestoneRevisionEmail = async (freelancerEmail, freelancerName, milestoneTitle, note) => {
  const subject = `🔄 Revision Requested: "${milestoneTitle}"`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
      <h2 style="color: #FF9800;">🔄 Revision Requested</h2>
      <p>Hello ${freelancerName},</p>
      <p>The client has requested a revision for milestone <strong>"${milestoneTitle}"</strong>.</p>
      <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <strong>Client's Feedback:</strong><br>
        ${note}
      </div>
      <div style="margin: 30px 0;">
        <a href="https://freelancerhub-five.vercel.app/milestones" 
           style="background-color: #FF9800; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">
          View & Resubmit
        </a>
      </div>
      <hr>
      <p style="font-size: 12px; color: #888;">&copy; 2025 FreelancerHub</p>
    </div>
  `;
  await sendEmail(freelancerEmail, subject, html, true);
};

// ============================================================================
// ROUTES
// ============================================================================

/**
 * POST /milestone/create
 * Create milestones for a project (client only, after agreement signed)
 */
router.post(
  "/create",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    const session = await mongoose.startSession();
    
    try {
      const clientId = req.user.userId;
      const { agreementId, milestones } = req.body;

      // Validate inputs
      if (!agreementId || !isValidObjectId(agreementId)) {
        return res.status(400).json({ message: "Valid agreementId is required" });
      }

      if (!Array.isArray(milestones) || milestones.length === 0) {
        return res.status(400).json({ message: "At least one milestone is required" });
      }

      session.startTransaction();

      // Verify agreement exists and is active
      const agreement = await Agreement.findOne({
        _id: agreementId,
        clientId: clientId,
        status: "active",
      }).session(session);

      if (!agreement) {
        await session.abortTransaction();
        return res.status(404).json({ message: "Active agreement not found or unauthorized" });
      }

      // Check if milestones already exist
      const existingMilestones = await Milestone.countDocuments({
        agreementId: agreementId,
      }).session(session);

      if (existingMilestones > 0) {
        await session.abortTransaction();
        return res.status(409).json({ message: "Milestones already exist for this agreement" });
      }

      // Validate milestone amounts sum to agreement amount
      const totalMilestoneAmount = milestones.reduce((sum, m) => sum + (m.amount || 0), 0);
      if (Math.abs(totalMilestoneAmount - agreement.agreedAmount) > 0.01) {
        await session.abortTransaction();
        return res.status(400).json({
          message: `Milestone amounts (${totalMilestoneAmount}) must equal agreement amount (${agreement.agreedAmount})`,
        });
      }

      // Create milestones
      const createdMilestones = [];
      for (let i = 0; i < milestones.length; i++) {
        const m = milestones[i];
        
        // Validate required fields
        if (!m.title || !m.description || !m.amount || !m.dueDate) {
          await session.abortTransaction();
          return res.status(400).json({
            message: `Milestone ${i + 1}: title, description, amount, and dueDate are required`,
          });
        }

        const dueDate = new Date(m.dueDate);
        const slaDeadline = new Date(m.slaDeadline || dueDate.getTime() + 3 * 24 * 60 * 60 * 1000); // 3 days grace

        const milestone = new Milestone({
          agreementId: agreementId,
          projectId: agreement.projectId,
          clientId: clientId,
          freelancerId: agreement.freelancerId,
          milestoneNumber: i + 1,
          title: m.title.trim(),
          description: m.description.trim(),
          amount: m.amount,
          dueDate: dueDate,
          slaDeadline: slaDeadline,
          penaltyPercent: m.penaltyPercent || 5,
          bonusPercent: m.bonusPercent || 3,
          status: i === 0 ? "in_progress" : "pending", // First milestone starts immediately
          startedAt: i === 0 ? new Date() : null,
        });

        await milestone.save({ session });
        createdMilestones.push(milestone);
      }

      await session.commitTransaction();

      await logActivity(clientId, `Created ${createdMilestones.length} milestones for project`);

      res.status(201).json({
        message: `${createdMilestones.length} milestones created successfully`,
        milestones: createdMilestones.map(m => ({
          _id: m._id,
          milestoneNumber: m.milestoneNumber,
          title: m.title,
          amount: m.amount,
          dueDate: m.dueDate,
          status: m.status,
        })),
      });
    } catch (err) {
      await session.abortTransaction();
      console.error("Create Milestones Error:", err);
      res.status(500).json({ message: "Error creating milestones", error: err.message });
    } finally {
      session.endSession();
    }
  }
);

/**
 * GET /milestone/project/:projectId
 * Get all milestones for a project
 */
router.get(
  "/project/:projectId",
  verifyToken,
  authorize(["client", "freelancer", "admin"]),
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const { projectId } = req.params;

      if (!isValidObjectId(projectId)) {
        return res.status(400).json({ message: "Invalid project ID" });
      }

      const milestones = await Milestone.find({ projectId })
        .sort({ milestoneNumber: 1 });

      if (milestones.length === 0) {
        return res.status(404).json({ message: "No milestones found" });
      }

      // Verify access
      const isClient = milestones[0].clientId.toString() === userId;
      const isFreelancer = milestones[0].freelancerId.toString() === userId;
      const isAdmin = req.user.role === "admin";

      if (!isClient && !isFreelancer && !isAdmin) {
        return res.status(403).json({ message: "Unauthorized access" });
      }

      // Get summary
      const summary = await Milestone.getProjectSummary(projectId);

      res.json({ milestones, summary });
    } catch (err) {
      console.error("Get Milestones Error:", err);
      res.status(500).json({ message: "Error fetching milestones" });
    }
  }
);

/**
 * POST /milestone/:id/submit
 * Freelancer submits milestone deliverables
 */
router.post(
  "/:id/submit",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const freelancerId = req.user.userId;
      const { id } = req.params;
      const { deliverables } = req.body;

      if (!isValidObjectId(id)) {
        return res.status(400).json({ message: "Invalid milestone ID" });
      }

      if (!Array.isArray(deliverables) || deliverables.length === 0) {
        return res.status(400).json({ message: "At least one deliverable is required" });
      }

      // Validate deliverables
      for (const d of deliverables) {
        if (!d.name || !d.url) {
          return res.status(400).json({ message: "Each deliverable must have name and url" });
        }
      }

      const milestone = await Milestone.findById(id)
        .populate("clientId", "username email");

      if (!milestone) {
        return res.status(404).json({ message: "Milestone not found" });
      }

      if (milestone.freelancerId.toString() !== freelancerId) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      await milestone.submit(deliverables);

      // Send notification to client
      try {
        await sendMilestoneSubmittedEmail(
          milestone.clientId.email,
          milestone.clientId.username,
          milestone.title,
          milestone.title
        );
      } catch (emailErr) {
        console.error("Email error:", emailErr);
      }

      await logActivity(freelancerId, `Submitted milestone: ${milestone.title}`);

      res.json({
        message: "Milestone submitted successfully",
        milestone: {
          _id: milestone._id,
          status: milestone.status,
          submittedAt: milestone.submittedAt,
          autoReleaseScheduledAt: milestone.autoReleaseScheduledAt,
          finalAmount: milestone.finalAmount,
          daysEarly: milestone.daysEarly,
          bonusAmount: milestone.bonusAmount,
        },
      });
    } catch (err) {
      console.error("Submit Milestone Error:", err);
      res.status(500).json({ message: err.message || "Error submitting milestone" });
    }
  }
);

/**
 * POST /milestone/:id/confirm
 * Client confirms milestone completion
 */
router.post(
  "/:id/confirm",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    const session = await mongoose.startSession();
    
    try {
      const clientId = req.user.userId;
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return res.status(400).json({ message: "Invalid milestone ID" });
      }

      session.startTransaction();

      const milestone = await Milestone.findById(id)
        .populate("freelancerId", "username email")
        .session(session);

      if (!milestone) {
        await session.abortTransaction();
        return res.status(404).json({ message: "Milestone not found" });
      }

      if (milestone.clientId.toString() !== clientId) {
        await session.abortTransaction();
        return res.status(403).json({ message: "Unauthorized" });
      }

      // Confirm and release
      await milestone.confirm();
      await milestone.release();

      // Create freelancer escrow payment
      const freelancerEscrow = new FreelancerEscrow({
        projectId: milestone.projectId,
        freelancerId: milestone.freelancerId._id,
        amount: milestone.finalAmount,
        status: "paid",
      });
      await freelancerEscrow.save({ session });

      // Record transaction
      await Transaction.create([{
        escrowId: freelancerEscrow._id,
        type: "release",
        amount: milestone.finalAmount,
        status: "completed",
        description: `Milestone payment: ${milestone.title}`,
      }], { session });

      // Start next milestone if exists
      const nextMilestone = await Milestone.findOne({
        agreementId: milestone.agreementId,
        milestoneNumber: milestone.milestoneNumber + 1,
        status: "pending",
      }).session(session);

      if (nextMilestone) {
        nextMilestone.status = "in_progress";
        nextMilestone.startedAt = new Date();
        await nextMilestone.save({ session });
      }

      await session.commitTransaction();

      // Send notification
      try {
        await sendMilestoneConfirmedEmail(
          milestone.freelancerId.email,
          milestone.freelancerId.username,
          milestone.title,
          milestone.finalAmount,
          milestone.bonusAmount
        );
      } catch (emailErr) {
        console.error("Email error:", emailErr);
      }

      await logActivity(clientId, `Confirmed milestone: ${milestone.title}`);

      res.json({
        message: "Milestone confirmed and payment released",
        milestone: {
          _id: milestone._id,
          status: milestone.status,
          finalAmount: milestone.finalAmount,
          bonusAmount: milestone.bonusAmount,
          penaltyAmount: milestone.penaltyAmount,
        },
        nextMilestone: nextMilestone ? {
          _id: nextMilestone._id,
          title: nextMilestone.title,
          status: nextMilestone.status,
        } : null,
      });
    } catch (err) {
      await session.abortTransaction();
      console.error("Confirm Milestone Error:", err);
      res.status(500).json({ message: err.message || "Error confirming milestone" });
    } finally {
      session.endSession();
    }
  }
);

/**
 * POST /milestone/:id/revision
 * Client requests revision
 */
router.post(
  "/:id/revision",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    try {
      const clientId = req.user.userId;
      const { id } = req.params;
      const { note } = req.body;

      if (!isValidObjectId(id)) {
        return res.status(400).json({ message: "Invalid milestone ID" });
      }

      if (!note || note.trim().length < 20) {
        return res.status(400).json({ message: "Revision note required (min 20 characters)" });
      }

      const milestone = await Milestone.findById(id)
        .populate("freelancerId", "username email");

      if (!milestone) {
        return res.status(404).json({ message: "Milestone not found" });
      }

      if (milestone.clientId.toString() !== clientId) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      await milestone.requestRevision(note.trim(), clientId);

      // Send notification
      try {
        await sendMilestoneRevisionEmail(
          milestone.freelancerId.email,
          milestone.freelancerId.username,
          milestone.title,
          note.trim()
        );
      } catch (emailErr) {
        console.error("Email error:", emailErr);
      }

      await logActivity(clientId, `Requested revision for milestone: ${milestone.title}`);

      res.json({
        message: "Revision requested",
        milestone: {
          _id: milestone._id,
          status: milestone.status,
          revisionCount: milestone.revisionCount,
          maxRevisions: milestone.maxRevisions,
        },
      });
    } catch (err) {
      console.error("Revision Request Error:", err);
      res.status(500).json({ message: err.message || "Error requesting revision" });
    }
  }
);

/**
 * POST /milestone/:id/dispute
 * Either party disputes the milestone
 */
router.post(
  "/:id/dispute",
  verifyToken,
  authorize(["client", "freelancer"]),
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const { id } = req.params;
      const { reason } = req.body;

      if (!isValidObjectId(id)) {
        return res.status(400).json({ message: "Invalid milestone ID" });
      }

      if (!reason || reason.trim().length < 50) {
        return res.status(400).json({ message: "Dispute reason required (min 50 characters)" });
      }

      const milestone = await Milestone.findById(id);

      if (!milestone) {
        return res.status(404).json({ message: "Milestone not found" });
      }

      // Verify access
      const isClient = milestone.clientId.toString() === userId;
      const isFreelancer = milestone.freelancerId.toString() === userId;

      if (!isClient && !isFreelancer) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      await milestone.dispute(reason.trim(), userId);

      await logActivity(userId, `Filed dispute for milestone: ${milestone.title}`);

      res.json({
        message: "Dispute filed. Admin will review within 48 hours.",
        milestone: {
          _id: milestone._id,
          status: milestone.status,
          disputedAt: milestone.disputedAt,
        },
      });
    } catch (err) {
      console.error("Dispute Error:", err);
      res.status(500).json({ message: err.message || "Error filing dispute" });
    }
  }
);

/**
 * GET /milestone/:id
 * Get single milestone details
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
        return res.status(400).json({ message: "Invalid milestone ID" });
      }

      const milestone = await Milestone.findById(id)
        .populate("clientId", "username email")
        .populate("freelancerId", "username email");

      if (!milestone) {
        return res.status(404).json({ message: "Milestone not found" });
      }

      // Verify access
      const isClient = milestone.clientId._id.toString() === userId;
      const isFreelancer = milestone.freelancerId._id.toString() === userId;
      const isAdmin = req.user.role === "admin";

      if (!isClient && !isFreelancer && !isAdmin) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      res.json({ milestone });
    } catch (err) {
      console.error("Get Milestone Error:", err);
      res.status(500).json({ message: "Error fetching milestone" });
    }
  }
);

module.exports = router;
