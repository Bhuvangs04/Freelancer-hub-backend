const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { verifyToken, authorize } = require("../middleware/Auth");
const Agreement = require("../models/Agreement");
const Project = require("../models/Project");
const Bid = require("../models/Bid");
const User = require("../models/User");
const Ongoing = require("../models/OnGoingProject.Schema");
const Escrow = require("../models/Escrow");
const sendEmail = require("../utils/sendEmail");
const Activity = require("../models/ActionSchema");

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Log user activity
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
 */
const isValidObjectId = (id) => {
  return (
    mongoose.Types.ObjectId.isValid(id) &&
    new mongoose.Types.ObjectId(id).toString() === id
  );
};

/**
 * Get client IP address
 */
const getClientIp = (req) => {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.connection?.remoteAddress ||
    req.ip ||
    "unknown"
  );
};

/**
 * Calculate platform fee (example: 10%)
 */
const calculatePlatformFee = (amount) => {
  const feePercentage = 0.1; // 10%
  return Math.round(amount * feePercentage * 100) / 100;
};

// ============================================================================
// EMAIL TEMPLATES
// ============================================================================

/**
 * Send email to client when agreement is created (in draft status)
 */
const sendClientAgreementCreated = async (clientEmail, clientName, projectTitle, agreementNumber) => {
  const subject = `Agreement Created for "${projectTitle}" - Review & Send for Signing`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
      <h2 style="color: #333;">📄 Agreement Created</h2>
      <p>Hello ${clientName},</p>
      <p>An agreement has been created for your project <strong>"${projectTitle}"</strong>.</p>
      <p><strong>Agreement Number:</strong> ${agreementNumber}</p>
      <p>Please log in to your FreelancerHub account to:</p>
      <ul>
        <li>Review the agreement terms</li>
        <li>Edit the agreement if needed</li>
        <li>Send it to the freelancer for signing</li>
      </ul>
      <div style="margin: 30px 0;">
        <a href="http://localhost:8080/agreements" 
           style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">
          Review Agreement
        </a>
      </div>
      <p style="color: #666; font-size: 14px;">
        The freelancer will be notified once you send the agreement for signing.
      </p>
      <hr style="margin: 30px 0;">
      <p style="font-size: 12px; color: #888;">&copy; 2025 FreelancerHub. All Rights Reserved.</p>
    </div>
  `;
  await sendEmail(clientEmail, subject, html, true);
};

/**
 * Send signature request email to freelancer (first to sign)
 */
const sendFreelancerSignatureRequest = async (freelancerEmail, freelancerName, projectTitle, agreementNumber, amount) => {
  const subject = `Action Required: Sign Agreement for "${projectTitle}"`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
      <h2 style="color: #333;">✍️ Agreement Ready for Your Signature</h2>
      <p>Hello ${freelancerName},</p>
      <p>The client has finalized the agreement for project <strong>"${projectTitle}"</strong> and is waiting for your signature.</p>
      <p><strong>Agreement Number:</strong> ${agreementNumber}</p>
      <p><strong>Agreed Amount:</strong> ₹${amount.toLocaleString()}</p>
      <p>Please log in to FreelancerHub to review and sign the agreement.</p>
      <div style="margin: 30px 0;">
        <a href="http://localhost:8080/agreements" 
           style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">
          Review & Sign Agreement
        </a>
      </div>
      <p style="color: #666; font-size: 14px;">
        After you sign, the client will complete their signature and the project will begin.
      </p>
      <hr style="margin: 30px 0;">
      <p style="font-size: 12px; color: #888;">&copy; 2025 FreelancerHub. All Rights Reserved.</p>
    </div>
  `;
  await sendEmail(freelancerEmail, subject, html, true);
};

/**
 * Send signature request email to client (after freelancer has signed)
 */
const sendClientSignatureRequest = async (clientEmail, clientName, projectTitle, agreementNumber, freelancerName) => {
  const subject = `Action Required: Freelancer Signed - Complete Agreement for "${projectTitle}"`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
      <h2 style="color: #333;">✅ Freelancer Has Signed!</h2>
      <p>Hello ${clientName},</p>
      <p>Great news! <strong>${freelancerName}</strong> has signed the agreement for project <strong>"${projectTitle}"</strong>.</p>
      <p><strong>Agreement Number:</strong> ${agreementNumber}</p>
      <p>Please log in to complete your signature and start the project.</p>
      <div style="margin: 30px 0;">
        <a href="http://localhost:8080/agreements" 
           style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">
          Sign Agreement
        </a>
      </div>
      <p style="color: #666; font-size: 14px;">
        Once you sign, the project will officially begin and funds will be held in escrow.
      </p>
      <hr style="margin: 30px 0;">
      <p style="font-size: 12px; color: #888;">&copy; 2025 FreelancerHub. All Rights Reserved.</p>
    </div>
  `;
  await sendEmail(clientEmail, subject, html, true);
};

/**
 * Send agreement completion notification to both parties
 */
const sendAgreementCompletionNotification = async (clientEmail, freelancerEmail, projectTitle, agreementNumber) => {
  const subject = `Agreement Fully Executed - "${projectTitle}"`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
      <h2 style="color: #4CAF50;">✅ Agreement Fully Signed!</h2>
      <p>Both parties have signed the agreement for project <strong>"${projectTitle}"</strong>.</p>
      <p><strong>Agreement Number:</strong> ${agreementNumber}</p>
      <p>The project can now officially begin. Funds are held securely in escrow.</p>
      <div style="margin: 30px 0;">
        <a href="http://localhost:8080/projects" 
           style="background-color: #2196F3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">
          Go to Project
        </a>
      </div>
      <hr style="margin: 30px 0;">
      <p style="font-size: 12px; color: #888;">&copy; 2025 FreelancerHub. All Rights Reserved.</p>
    </div>
  `;
  
  await Promise.all([
    sendEmail(clientEmail, subject, html, true),
    sendEmail(freelancerEmail, subject, html, true),
  ]);
};

// ============================================================================
// ROUTES
// ============================================================================

/**
 * POST /agreement/create
 * Create a new agreement when a bid is accepted
 * Required: projectId, bidId
 */
router.post(
  "/create",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    const session = await mongoose.startSession();
    
    try {
      const clientId = req.user.userId;
      const { projectId, bidId } = req.body;

      // Validate inputs
      if (!projectId || !isValidObjectId(projectId)) {
        return res.status(400).json({ message: "Valid projectId is required" });
      }
      if (!bidId || !isValidObjectId(bidId)) {
        return res.status(400).json({ message: "Valid bidId is required" });
      }

      session.startTransaction();

      // Verify project ownership
      const project = await Project.findOne({
        _id: projectId,
        clientId: clientId,
      }).session(session);

      if (!project) {
        await session.abortTransaction();
        return res.status(404).json({ message: "Project not found or unauthorized" });
      }

      // Check for existing active agreement
      const existingAgreement = await Agreement.getCurrentAgreementForProject(projectId);
      if (existingAgreement) {
        await session.abortTransaction();
        return res.status(409).json({
          message: "An active agreement already exists for this project",
          agreementId: existingAgreement._id,
          agreementNumber: existingAgreement.agreementNumber,
        });
      }

      // Get the bid
      const bid = await Bid.findOne({
        _id: bidId,
        projectId: projectId,
      }).session(session);

      if (!bid) {
        await session.abortTransaction();
        return res.status(404).json({ message: "Bid not found" });
      }

      // Get freelancer details
      const freelancer = await User.findById(bid.freelancerId).session(session);
      if (!freelancer) {
        await session.abortTransaction();
        return res.status(404).json({ message: "Freelancer not found" });
      }

      // Get client details for email
      const client = await User.findById(clientId).session(session);

      // Calculate amounts
      const agreedAmount = bid.amount;
      const platformFee = calculatePlatformFee(agreedAmount);
      const totalAmount = agreedAmount + platformFee;

      // Create agreement
      const agreement = new Agreement({
        projectId: projectId,
        bidId: bidId,
        clientId: clientId,
        freelancerId: bid.freelancerId,
        projectTitle: project.title,
        projectDescription: project.description,
        agreedAmount: agreedAmount,
        platformFee: platformFee,
        totalAmount: totalAmount,
        deadline: project.deadline,
        deliverables: project.description,
        status: "draft",
      });

      await agreement.save({ session });

      // Update bid status - agreement created but not yet signed by both parties
      // Bid will be marked as 'accepted' only when agreement becomes 'active' (both sign)
      bid.status = "sign_pending";
      await bid.save({ session });

      // Update project with freelancer
      project.freelancerId = bid.freelancerId;
      await project.save({ session });

      await session.commitTransaction();

      // Send email notification to client about reviewing the agreement
      try {
        await sendClientAgreementCreated(
          client.email,
          client.username,
          project.title,
          agreement.agreementNumber
        );
      } catch (emailError) {
        console.error("Failed to send agreement created email:", emailError);
      }

      await logActivity(
        clientId,
        `Created agreement ${agreement.agreementNumber} for project "${project.title}"`
      );

      res.status(201).json({
        message: "Agreement created successfully. Please review and edit if needed, then send for signing.",
        agreement: {
          _id: agreement._id,
          agreementNumber: agreement.agreementNumber,
          projectTitle: agreement.projectTitle,
          agreedAmount: agreement.agreedAmount,
          platformFee: agreement.platformFee,
          totalAmount: agreement.totalAmount,
          deadline: agreement.deadline,
          status: agreement.status,
        },
      });
    } catch (err) {
      await session.abortTransaction();
      console.error("Create Agreement Error:", err);
      res.status(500).json({ message: "Error creating agreement", error: err.message });
    } finally {
      session.endSession();
    }
  }
);

/**
 * GET /agreement/:id
 * Get agreement details
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
        return res.status(400).json({ message: "Invalid agreement ID" });
      }

      const agreement = await Agreement.findById(id)
        .populate("clientId", "username email")
        .populate("freelancerId", "username email")
        .populate("projectId", "title status");

      if (!agreement) {
        return res.status(404).json({ message: "Agreement not found" });
      }

      // Verify access (client, freelancer, or admin)
      const isClient = agreement.clientId._id.toString() === userId;
      const isFreelancer = agreement.freelancerId._id.toString() === userId;
      const isAdmin = req.user.role === "admin";

      if (!isClient && !isFreelancer && !isAdmin) {
        return res.status(403).json({ message: "Unauthorized access" });
      }

      // Determine user's role for this agreement
      const userRole = isClient ? "client" : isFreelancer ? "freelancer" : "admin";
      console.log("User Role:", userRole);

      res.json({ agreement, userRole });
    } catch (err) {
      console.error("Get Agreement Error:", err);
      res.status(500).json({ message: "Error fetching agreement" });
    }
  }
);

/**
 * GET /agreement/project/:projectId
 * Get agreement for a specific project
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

      const agreement = await Agreement.findOne({
        projectId: projectId,
        status: { $ne: "cancelled" },
      })
        .sort({ version: -1 })
        .populate("clientId", "username email")
        .populate("freelancerId", "username email");

      if (!agreement) {
        return res.status(404).json({ message: "No agreement found for this project" });
      }

      // Verify access
      const isClient = agreement.clientId._id.toString() === userId;
      const isFreelancer = agreement.freelancerId._id.toString() === userId;
      const isAdmin = req.user.role === "admin";

      if (!isClient && !isFreelancer && !isAdmin) {
        return res.status(403).json({ message: "Unauthorized access" });
      }

      res.json({ agreement });
    } catch (err) {
      console.error("Get Project Agreement Error:", err);
      res.status(500).json({ message: "Error fetching agreement" });
    }
  }
);

/**
 * GET /agreement/my/list
 * Get all agreements for the current user
 */
router.get(
  "/my/list",
  verifyToken,
  authorize(["client", "freelancer"]),
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const userRole = req.user.role;
      const { status } = req.query;

      const query = userRole === "client"
        ? { clientId: userId }
        : { freelancerId: userId };

      if (status) {
        query.status = status;
      }

      const agreements = await Agreement.find(query)
        .sort({ createdAt: -1 })
        .populate("clientId", "username email")
        .populate("freelancerId", "username email")
        .select("-terms"); // Exclude long terms from list

      res.json({ agreements, userRole });
    } catch (err) {
      console.error("List Agreements Error:", err);
      res.status(500).json({ message: "Error fetching agreements" });
    }
  }
);

/**
 * PUT /agreement/:id/edit
 * Edit agreement terms (client only, draft status only)
 */
router.put(
  "/:id/edit",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    try {
      const clientId = req.user.userId;
      const { id } = req.params;
      const { deliverables, deadline, agreedAmount, projectDescription } = req.body;

      if (!isValidObjectId(id)) {
        return res.status(400).json({ message: "Invalid agreement ID" });
      }

      const agreement = await Agreement.findById(id);

      if (!agreement) {
        return res.status(404).json({ message: "Agreement not found" });
      }

      // Verify ownership
      if (agreement.clientId.toString() !== clientId) {
        return res.status(403).json({ message: "Unauthorized - not the project client" });
      }

      // Check if editable
      if (agreement.status !== "draft") {
        return res.status(400).json({
          message: "Agreement can only be edited while in draft status",
        });
      }

      // Update agreement
      const updates = {};
      if (deliverables !== undefined) updates.deliverables = deliverables;
      if (deadline !== undefined) updates.deadline = new Date(deadline);
      if (agreedAmount !== undefined) updates.agreedAmount = agreedAmount;
      if (projectDescription !== undefined) updates.projectDescription = projectDescription;

      await agreement.updateTerms(updates);

      await logActivity(
        clientId,
        `Edited agreement ${agreement.agreementNumber}`
      );

      res.json({
        message: "Agreement updated successfully",
        agreement: {
          _id: agreement._id,
          agreementNumber: agreement.agreementNumber,
          deliverables: agreement.deliverables,
          deadline: agreement.deadline,
          agreedAmount: agreement.agreedAmount,
          totalAmount: agreement.totalAmount,
          status: agreement.status,
        },
      });
    } catch (err) {
      console.error("Edit Agreement Error:", err);
      res.status(500).json({ message: err.message || "Error editing agreement" });
    }
  }
);

/**
 * POST /agreement/:id/send-for-signing
 * Send agreement to freelancer for signing (client only, draft status only)
 */
router.post(
  "/:id/send-for-signing",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    try {
      const clientId = req.user.userId;
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return res.status(400).json({ message: "Invalid agreement ID" });
      }

      const agreement = await Agreement.findById(id)
        .populate("freelancerId", "username email");

      if (!agreement) {
        return res.status(404).json({ message: "Agreement not found" });
      }

      // Verify ownership
      if (agreement.clientId.toString() !== clientId) {
        return res.status(403).json({ message: "Unauthorized - not the project client" });
      }

      // Send for signing
      await agreement.sendForSigning();

      // Send email to freelancer
      try {
        await sendFreelancerSignatureRequest(
          agreement.freelancerId.email,
          agreement.freelancerId.username,
          agreement.projectTitle,
          agreement.agreementNumber,
          agreement.agreedAmount
        );
      } catch (emailError) {
        console.error("Failed to send freelancer notification:", emailError);
      }

      await logActivity(
        clientId,
        `Sent agreement ${agreement.agreementNumber} to freelancer for signing`
      );

      res.json({
        message: "Agreement sent to freelancer for signing",
        agreement: {
          _id: agreement._id,
          agreementNumber: agreement.agreementNumber,
          status: agreement.status,
        },
      });
    } catch (err) {
      console.error("Send For Signing Error:", err);
      res.status(500).json({ message: err.message || "Error sending agreement for signing" });
    }
  }
);

/**
 * POST /agreement/:id/sign/client
 * Client signs the agreement (after freelancer has signed)
 */
router.post(
  "/:id/sign/client",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    const session = await mongoose.startSession();
    
    try {
      const clientId = req.user.userId;
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return res.status(400).json({ message: "Invalid agreement ID" });
      }

      session.startTransaction();

      const agreement = await Agreement.findById(id)
        .populate("clientId", "username email")
        .populate("freelancerId", "username email")
        .session(session);

      if (!agreement) {
        await session.abortTransaction();
        return res.status(404).json({ message: "Agreement not found" });
      }

      // Verify ownership
      if (agreement.clientId._id.toString() !== clientId) {
        await session.abortTransaction();
        return res.status(403).json({ message: "Unauthorized - not the project client" });
      }

      // Sign the agreement
      const ipAddress = getClientIp(req);
      const userAgent = req.headers["user-agent"];

      await agreement.signAsClient(ipAddress, userAgent);

      // ====================================================================
      // ESCROW SYNCHRONIZATION - Agreement is ultimate source of truth
      // ====================================================================
      const escrow = await Escrow.findOne({ projectId: agreement.projectId }).session(session);
      
      if (escrow) {
        const agreementAmount = agreement.agreedAmount;
        const escrowAmount = escrow.amount;
        
        // Check if escrow needs adjustment
        if (escrowAmount !== agreementAmount) {
          const previousAmount = escrowAmount;
          const refundAmount = escrowAmount - agreementAmount;
          
          // Track the adjustment in history
          escrow.adjustmentHistory.push({
            previousAmount: previousAmount,
            newAmount: agreementAmount,
            refundAmount: refundAmount > 0 ? refundAmount : 0,
            reason: `Agreement sync - both parties signed agreement ${agreement.agreementNumber}`,
            agreementId: agreement._id,
            adjustedAt: new Date(),
          });
          
          // Update escrow amounts
          escrow.amount = agreementAmount;
          escrow.adjustedAmount = agreementAmount;
          escrow.agreementId = agreement._id;
          escrow.freelancerId = agreement.freelancerId._id;
          
          if (refundAmount > 0) {
            // Excess funds - process partial refund to client
            escrow.refundedAmount = (escrow.refundedAmount || 0) + refundAmount;
            escrow.status = "partial_refund";
            
            // Log the refund for audit
            console.log(`[ESCROW SYNC] Partial refund of ${refundAmount} to client for project ${agreement.projectId}`);
            
            // TODO: Integrate with payment gateway for actual refund
            // For now, we track it in the escrow record
            await logActivity(
              clientId,
              `Escrow adjusted: ₹${refundAmount} refunded due to agreement amount change`
            );
          } else if (refundAmount < 0) {
            // Agreement amount is higher than escrow - this shouldn't happen in normal flow
            // Log as warning
            console.warn(`[ESCROW WARNING] Agreement amount (${agreementAmount}) exceeds escrow (${escrowAmount}) for project ${agreement.projectId}`);
            escrow.status = "adjusted";
          } else {
            escrow.status = "funded"; // Amount matches exactly
          }
          
          await escrow.save({ session });
        } else {
          // Link agreement even if amounts match
          if (!escrow.agreementId) {
            escrow.agreementId = agreement._id;
            await escrow.save({ session });
          }
        }
      }
      // ====================================================================
      // END ESCROW SYNCHRONIZATION
      // ====================================================================

      // ====================================================================
      // BID STATUS UPDATE - Mark bid as truly accepted now that both signed
      // ====================================================================
      const bid = await Bid.findById(agreement.bidId).session(session);
      if (bid && bid.status === "sign_pending") {
        bid.status = "accepted";
        await bid.save({ session });
        console.log(`[BID ACCEPTED] Bid ${bid._id} marked as accepted after agreement ${agreement.agreementNumber} fully signed`);
      }
      // ====================================================================
      // END BID STATUS UPDATE
      // ====================================================================


      // Update project status to in_progress
      await Project.findByIdAndUpdate(
        agreement.projectId,
        { status: "in_progress" },
        { session }
      );

      // Create or update OngoingProject record
      const existingOngoing = await Ongoing.findOne({ projectId: agreement.projectId }).session(session);
      
      if (!existingOngoing) {
        const project = await Project.findById(agreement.projectId).session(session);
        
        await Ongoing.create([{
          projectId: agreement.projectId,
          title: agreement.projectTitle,
          clientId: agreement.clientId._id.toString(),
          freelancer: agreement.freelancerId.username,
          freelancerId: agreement.freelancerId._id.toString(),
          status: "in-progress",
          progress: 0,
          dueDate: agreement.deadline.toISOString().split("T")[0],
          budget: project.budget,
          description: agreement.projectDescription,
          freelancerBidPrice: agreement.agreedAmount,
        }], { session });
      }

      await session.commitTransaction();

      // Send completion emails to both parties
      try {
        await sendAgreementCompletionNotification(
          agreement.clientId.email,
          agreement.freelancerId.email,
          agreement.projectTitle,
          agreement.agreementNumber
        );
      } catch (emailError) {
        console.error("Failed to send completion notification:", emailError);
      }

      await logActivity(
        clientId,
        `Signed agreement ${agreement.agreementNumber} as client - project is now active`
      );

      res.json({
        message: "Agreement fully executed. Project is now active!",
        agreement: {
          _id: agreement._id,
          agreementNumber: agreement.agreementNumber,
          status: agreement.status,
          clientSignature: {
            signed: true,
            signedAt: agreement.clientSignature.signedAt,
          },
        },
      });
    } catch (err) {
      await session.abortTransaction();
      console.error("Client Sign Error:", err);
      res.status(500).json({ message: err.message || "Error signing agreement" });
    } finally {
      session.endSession();
    }
  }
);

/**
 * POST /agreement/:id/sign/freelancer
 * Freelancer signs the agreement (first to sign)
 */
router.post(
  "/:id/sign/freelancer",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const freelancerId = req.user.userId;
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return res.status(400).json({ message: "Invalid agreement ID" });
      }

      const agreement = await Agreement.findById(id)
        .populate("clientId", "username email")
        .populate("freelancerId", "username email");

      if (!agreement) {
        return res.status(404).json({ message: "Agreement not found" });
      }

      // Verify ownership
      if (agreement.freelancerId._id.toString() !== freelancerId) {
        return res.status(403).json({ message: "Unauthorized - not the assigned freelancer" });
      }

      // Sign the agreement
      const ipAddress = getClientIp(req);
      const userAgent = req.headers["user-agent"];

      await agreement.signAsFreelancer(ipAddress, userAgent);

      // Send email to client to complete their signature
      try {
        await sendClientSignatureRequest(
          agreement.clientId.email,
          agreement.clientId.username,
          agreement.projectTitle,
          agreement.agreementNumber,
          agreement.freelancerId.username
        );
      } catch (emailError) {
        console.error("Failed to send client notification:", emailError);
      }

      await logActivity(
        freelancerId,
        `Signed agreement ${agreement.agreementNumber} as freelancer - awaiting client signature`
      );

      res.json({
        message: "Agreement signed successfully. Awaiting client signature to start the project.",
        agreement: {
          _id: agreement._id,
          agreementNumber: agreement.agreementNumber,
          status: agreement.status,
          freelancerSignature: {
            signed: true,
            signedAt: agreement.freelancerSignature.signedAt,
          },
        },
      });
    } catch (err) {
      console.error("Freelancer Sign Error:", err);
      res.status(500).json({ message: err.message || "Error signing agreement" });
    }
  }
);

/**
 * POST /agreement/:id/cancel
 * Cancel an agreement (only before both signatures)
 */
router.post(
  "/:id/cancel",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    try {
      const clientId = req.user.userId;
      const { id } = req.params;
      const { reason } = req.body;

      if (!isValidObjectId(id)) {
        return res.status(400).json({ message: "Invalid agreement ID" });
      }

      const agreement = await Agreement.findById(id);

      if (!agreement) {
        return res.status(404).json({ message: "Agreement not found" });
      }

      // Verify ownership
      if (agreement.clientId.toString() !== clientId) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      // Check if cancellable
      if (agreement.status === "active" || agreement.status === "completed") {
        return res.status(400).json({
          message: "Cannot cancel an active or completed agreement",
        });
      }

      if (agreement.status === "sign_pending") {
        return res.status(400).json({
          message: "Cannot cancel an agreement that is waiting for freelancer signature",
        });
      }

      if (agreement.status === "cancelled") {
        return res.status(400).json({
          message: "Cannot cancel an agreement that is already cancelled",
        });
      }


      await agreement.cancelWithRollback(reason, clientId);

      // Update bid status to indicate agreement was cancelled
      // This allows the freelancer to know what happened and potentially bid again
      const bid = await Bid.findById(agreement.bidId);
      if (bid && bid.status === "sign_pending") {
        bid.status = "agreement_cancelled";
        bid.cancellationReason = reason || "Agreement cancelled by client before signing completion";
        await bid.save();
        console.log(`[BID CANCELLED] Bid ${bid._id} marked as agreement_cancelled for agreement ${agreement.agreementNumber}`);
      }

      await logActivity(
        clientId,
        `Cancelled agreement ${agreement.agreementNumber}`
      );

      res.json({
        message: "Agreement cancelled successfully. The freelancer's bid has been marked as cancelled.",
        agreementNumber: agreement.agreementNumber,
      });
    } catch (err) {
      console.error("Cancel Agreement Error:", err);
      res.status(500).json({ message: err.message || "Error cancelling agreement" });
    }
  }
);

/**
 * POST /agreement/:id/amend
 * Create an amended version of the agreement (requires new signatures)
 */
router.post(
  "/:id/amend",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    try {
      const clientId = req.user.userId;
      const { id } = req.params;
      const { newAmount, reason } = req.body;

      if (!isValidObjectId(id)) {
        return res.status(400).json({ message: "Invalid agreement ID" });
      }

      if (!newAmount || typeof newAmount !== "number" || newAmount <= 0) {
        return res.status(400).json({ message: "Valid new amount is required" });
      }

      if (!reason || typeof reason !== "string" || reason.trim().length < 10) {
        return res.status(400).json({ message: "Reason for amendment is required (min 10 characters)" });
      }

      const agreement = await Agreement.findById(id);

      if (!agreement) {
        return res.status(404).json({ message: "Agreement not found" });
      }

      // Verify ownership
      if (agreement.clientId.toString() !== clientId) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      // Only active or pending agreements can be amended
      if (!["pending_client", "pending_freelancer", "active"].includes(agreement.status)) {
        return res.status(400).json({
          message: "Only pending or active agreements can be amended",
        });
      }

      const newAgreement = await agreement.createAmendment(newAmount, reason.trim(), clientId);

      await logActivity(
        clientId,
        `Created amendment v${newAgreement.version} for agreement ${agreement.agreementNumber}`
      );

      res.status(201).json({
        message: "Amendment created. Both parties must re-sign.",
        previousAgreement: agreement.agreementNumber,
        newAgreement: {
          _id: newAgreement._id,
          agreementNumber: newAgreement.agreementNumber,
          version: newAgreement.version,
          agreedAmount: newAgreement.agreedAmount,
          status: newAgreement.status,
        },
      });
    } catch (err) {
      console.error("Amend Agreement Error:", err);
      res.status(500).json({ message: err.message || "Error amending agreement" });
    }
  }
);

/**
 * GET /agreement/:id/verify
 * Verify agreement integrity using content hash
 */
router.get(
  "/:id/verify",
  verifyToken,
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return res.status(400).json({ message: "Invalid agreement ID" });
      }

      const agreement = await Agreement.findById(id);

      if (!agreement) {
        return res.status(404).json({ message: "Agreement not found" });
      }

      res.json({
        agreementNumber: agreement.agreementNumber,
        contentHash: agreement.contentHash,
        isFullySigned: agreement.isFullySigned(),
        clientSignature: agreement.clientSignature.signed
          ? { signed: true, signedAt: agreement.clientSignature.signedAt }
          : { signed: false },
        freelancerSignature: agreement.freelancerSignature.signed
          ? { signed: true, signedAt: agreement.freelancerSignature.signedAt }
          : { signed: false },
        status: agreement.status,
        version: agreement.version,
      });
    } catch (err) {
      console.error("Verify Agreement Error:", err);
      res.status(500).json({ message: "Error verifying agreement" });
    }
  }
);

module.exports = router;
