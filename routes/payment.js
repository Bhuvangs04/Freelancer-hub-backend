const express = require("express");
const { verifyToken, authorize } = require("../middleware/Auth");
const Razorpay = require("razorpay");
const mongoose = require("mongoose");
const FreelancerEscrowSchema = require("../models/FreelancerEscrow");
const AdminWithdrawSchema = require("../models/WithdrawReportsAdmin");
const router = express.Router();
const Payment = require("../models/Payment");
const Escrow = require("../models/Escrow");
const Transaction = require("../models/Transaction");
const Project = require("../models/Project");
const IdempotencyKey = require("../models/IdempotencyKey");
const axios = require("axios");
const sendEmail = require("../utils/sendEmail");
const crypto = require("crypto");
const Activity = require("../models/ActionSchema");
const fs = require("fs");
const path = require("path");
const Ongoing = require("../models/OnGoingProject.Schema");

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Log user activity for audit trail
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
  return mongoose.Types.ObjectId.isValid(id) && 
         new mongoose.Types.ObjectId(id).toString() === id;
};

/**
 * Create hash of request body for idempotency comparison
 */
const createRequestHash = (body) => {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(body))
    .digest("hex");
};

/**
 * Timing-safe comparison for signature verification
 */
const timingSafeCompare = (a, b) => {
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

// ============================================================================
// RAZORPAY CONFIGURATION
// ============================================================================

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ============================================================================
// EMAIL TEMPLATES
// ============================================================================

const sendRejectionEmail = async (
  freelancerEmail,
  freelancerName,
  projectTitle,
  clientFeedback
) => {
  const subject = "Project Rejected";

  const templatePath = path.join(
    __dirname,
    "../templates/rejectEmailTemplate.html"
  );
  let emailTemplate = fs.readFileSync(templatePath, "utf8");

  emailTemplate = emailTemplate
    .replace("{{freelancerName}}", freelancerName)
    .replace("{{projectTitle}}", projectTitle)
    .replace("{{loginUrl}}", "https://freelancerhub-five.vercel.app/sign-in")
    .replace("{{clientFeedback}}", clientFeedback);

  await sendEmail(freelancerEmail, subject, emailTemplate, true);
};

// ============================================================================
// PAYMENT ROUTES
// ============================================================================

/**
 * POST /create-order
 * Create a new Razorpay payment order with idempotency support
 * 
 * Required Headers:
 *   X-Idempotency-Key: Unique key to prevent duplicate orders
 * 
 * Required Body:
 *   - amount: Payment amount in paise (min 100 = ₹1)
 *   - currency: Currency code (INR supported)
 *   - project_id: Valid MongoDB ObjectId of the project
 */
router.post(
  "/create-order",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    const session = await mongoose.startSession();
    
    try {
      const clientId = req.user.userId; // Use authenticated user, not body
      const { amount, currency, project_id } = req.body;
      const idempotencyKey = req.headers["x-idempotency-key"];

      // ================ INPUT VALIDATION ================
      
      // Validate idempotency key
      if (!idempotencyKey || typeof idempotencyKey !== "string" || idempotencyKey.length < 16) {
        return res.status(400).json({
          message: "X-Idempotency-Key header is required (min 16 characters)",
        });
      }

      // Validate amount (must be positive integer in paise, min ₹1)
      if (!amount || !Number.isInteger(amount) || amount < 100) {
        return res.status(400).json({
          message: "Amount must be a positive integer in paise (minimum 100 = ₹1)",
        });
      }

      // Validate currency
      const supportedCurrencies = ["INR"];
      if (!currency || !supportedCurrencies.includes(currency.toUpperCase())) {
        return res.status(400).json({
          message: `Currency must be one of: ${supportedCurrencies.join(", ")}`,
        });
      }

      // Validate project_id
      if (!project_id || !isValidObjectId(project_id)) {
        return res.status(400).json({
          message: "Valid project_id is required",
        });
      }

      // ================ IDEMPOTENCY CHECK ================
      
      const requestHash = createRequestHash({ amount, currency, project_id });
      
      // Check for existing idempotency key
      const existingKey = await IdempotencyKey.findOne({
        key: idempotencyKey,
        userId: clientId,
      });

      if (existingKey) {
        // Same key with same request - return cached response
        if (existingKey.requestHash === requestHash && existingKey.status === "completed") {
          return res.json(existingKey.response);
        }
        // Same key with different request - error
        if (existingKey.requestHash !== requestHash) {
          return res.status(409).json({
            message: "Idempotency key already used with different request parameters",
          });
        }
        // Still processing
        if (existingKey.status === "processing") {
          return res.status(409).json({
            message: "Request is still being processed",
          });
        }
      }

      // ================ VERIFY PROJECT OWNERSHIP ================
      
      const project = await Project.findOne({
        _id: project_id,
        clientId: clientId,
        status: "open", // Only allow payment for open projects
      });

      if (!project) {
        return res.status(404).json({
          message: "Project not found, unauthorized, or not in 'open' status",
        });
      }

      // Check if payment already exists for this project
      const existingPayment = await Payment.findOne({
        projectId: project_id,
        userId: clientId,
        status: { $in: ["pending", "completed"] },
      });

      if (existingPayment) {
        return res.status(409).json({
          message: "Payment already initiated for this project",
          transactionId: existingPayment.transactionId,
        });
      }

      // ================ CREATE IDEMPOTENCY RECORD ================
      
      session.startTransaction();

      const idempotencyRecord = await IdempotencyKey.create(
        [
          {
            key: idempotencyKey,
            userId: clientId,
            endpoint: "/create-order",
            requestHash,
            status: "processing",
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
          },
        ],
        { session }
      );

      // ================ CREATE RAZORPAY ORDER ================
      
      const order = await razorpay.orders.create({
        amount: amount,
        currency: currency.toUpperCase(),
        notes: {
          project_id: project_id,
          client_id: clientId,
        },
      });

      // ================ SAVE PAYMENT RECORD ================
      
      const payment = new Payment({
        userId: clientId,
        projectId: project_id,
        transactionId: order.id,
        amount: amount / 100,
        paymentMethod: "bank_transfer",
        status: "pending",
      });
      await payment.save({ session });

      // Update idempotency record with response
      await IdempotencyKey.findByIdAndUpdate(
        idempotencyRecord[0]._id,
        {
          status: "completed",
          response: order,
        },
        { session }
      );

      await session.commitTransaction();

      await logActivity(clientId, `Created payment order for project ${project_id}`);

      res.json(order);
    } catch (err) {
      await session.abortTransaction();
      
      // Handle duplicate key error (idempotency race condition)
      if (err.code === 11000) {
        return res.status(409).json({
          message: "Duplicate request detected, please retry",
        });
      }

      console.error("Error creating order:", err);
      res.status(500).json({
        message: "Error creating order",
        error: err.message,
      });
    } finally {
      session.endSession();
    }
  }
);

/**
 * POST /verify-payment
 * Verify Razorpay payment signature and capture payment
 * 
 * Required Body:
 *   - razorpay_order_id: Razorpay order ID
 *   - razorpay_payment_id: Razorpay payment ID
 *   - razorpay_signature: Razorpay signature for verification
 *   - project_id: MongoDB ObjectId of the project
 */
router.post(
  "/verify-payment",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    const session = await mongoose.startSession();
    
    try {
      const clientId = req.user.userId; // Use authenticated user
      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        project_id,
      } = req.body;

      // ================ INPUT VALIDATION ================
      
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({
          message: "Missing required Razorpay parameters",
        });
      }

      if (!project_id || !isValidObjectId(project_id)) {
        return res.status(400).json({
          message: "Valid project_id is required",
        });
      }

      // ================ SIGNATURE VERIFICATION ================
      
      const generatedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest("hex");

      // Use timing-safe comparison to prevent timing attacks
      if (!timingSafeCompare(generatedSignature, razorpay_signature)) {
        await logActivity(clientId, `Invalid payment signature attempt for order ${razorpay_order_id}`);
        return res.status(400).json({ message: "Invalid payment signature" });
      }

      // ================ FETCH AND VALIDATE RECORDS ================
      
      const payment = await Payment.findOne({
        transactionId: razorpay_order_id,
        userId: clientId,
      });

      if (!payment) {
        return res.status(404).json({ message: "Payment order not found" });
      }

      // Check if payment already processed
      if (payment.status === "completed") {
        return res.status(409).json({
          message: "Payment already processed",
        });
      }

      const project = await Project.findOne({
        _id: project_id,
        clientId: clientId,
      });

      if (!project) {
        return res.status(404).json({ message: "Project not found or unauthorized" });
      }

      // ================ VERIFY PAYMENT STATUS WITH RAZORPAY ================
      
      const paymentStatus = await axios.get(
        `https://api.razorpay.com/v1/payments/${razorpay_payment_id}`,
        {
          auth: {
            username: process.env.RAZORPAY_KEY_ID,
            password: process.env.RAZORPAY_KEY_SECRET,
          },
        }
      );

      // Verify payment belongs to this order
      if (paymentStatus.data.order_id !== razorpay_order_id) {
        return res.status(400).json({ message: "Payment order mismatch" });
      }

      let isCaptured = paymentStatus.data.status === "captured";

      if (!isCaptured && paymentStatus.data.status === "authorized") {
        // Capture the payment
        const captureResponse = await axios.post(
          `https://api.razorpay.com/v1/payments/${razorpay_payment_id}/capture`,
          { amount: payment.amount * 100, currency: "INR" },
          {
            auth: {
              username: process.env.RAZORPAY_KEY_ID,
              password: process.env.RAZORPAY_KEY_SECRET,
            },
          }
        );

        if (captureResponse.data.status !== "captured") {
          return res.status(400).json({ message: "Payment capture failed" });
        }

        isCaptured = true;
      } else if (!isCaptured) {
        return res.status(400).json({
          message: `Payment cannot be processed. Status: ${paymentStatus.data.status}`,
        });
      }

      // ================ UPDATE RECORDS WITH TRANSACTION ================
      
      session.startTransaction();

      // Calculate commission and freelancer amount
      const commission = payment.amount - project.budget;
      const freelancerAmount = payment.amount - commission;

      // Update payment status atomically
      const updatedPayment = await Payment.findOneAndUpdate(
        {
          _id: payment._id,
          status: "pending", // Only update if still pending
        },
        {
          status: "completed",
          transactionId: razorpay_payment_id,
        },
        { session, new: true }
      );

      if (!updatedPayment) {
        await session.abortTransaction();
        return res.status(409).json({
          message: "Payment already processed by another request",
        });
      }

      // Check for existing escrow (prevent duplicates)
      const existingEscrow = await Escrow.findOne({
        projectId: project_id,
        clientId: clientId,
      }).session(session);

      if (existingEscrow) {
        await session.abortTransaction();
        return res.status(409).json({
          message: "Escrow already exists for this project",
        });
      }

      // Create escrow record
      const escrow = new Escrow({
        projectId: project_id,
        clientId: clientId,
        freelancerId: null,
        amount: freelancerAmount,
        status: "funded",
      });
      await escrow.save({ session });

      // Record transaction
      await Transaction.create(
        [
          {
            escrowId: escrow._id,
            type: "deposit",
            amount: freelancerAmount,
            status: "on_hold",
            description: `Payment for project: ${project.title}`,
          },
        ],
        { session }
      );

      await session.commitTransaction();

      await logActivity(
        clientId,
        `Payment verified and captured for project ${project_id}. Amount: ₹${payment.amount}`
      );

      return res.json({
        message: "Payment captured and funds held in escrow",
        escrowId: escrow._id,
      });
    } catch (err) {
      await session.abortTransaction();
      console.error("Error verifying payment:", err);
      return res.status(500).json({
        message: "Error verifying payment",
        error: err.message,
      });
    } finally {
      session.endSession();
    }
  }
);

/**
 * DELETE /delete-project/:projectId
 * Cancel a project and refund funds to client
 */
router.delete(
  "/delete-project/:projectId",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    const session = await mongoose.startSession();
    const { projectId } = req.params;
    const clientId = req.user.userId;

    try {
      // Validate projectId
      if (!isValidObjectId(projectId)) {
        return res.status(400).json({ message: "Invalid project ID format" });
      }

      session.startTransaction();

      // Find and validate project ownership
      const project = await Project.findOne({
        _id: projectId,
        clientId: clientId,
      }).session(session);

      if (!project) {
        await session.abortTransaction();
        return res.status(404).json({
          message: "Project not found or unauthorized",
        });
      }

      // Atomically update escrow - only if no freelancer assigned
      const escrow = await Escrow.findOneAndUpdate(
        {
          projectId: projectId,
          clientId: clientId,
          status: "funded",
          freelancerId: null, // Ensure no freelancer is assigned
        },
        {
          status: "refunded",
        },
        { session, new: true }
      );

      if (!escrow) {
        await session.abortTransaction();
        return res.status(404).json({
          message: "Escrow not found, already processed, or freelancer already assigned",
        });
      }

      // Find payment transaction
      const paymentRecord = await Payment.findOne({
        projectId: projectId,
        userId: clientId,
        status: "completed",
      }).session(session);

      if (!paymentRecord || !paymentRecord.transactionId) {
        await session.abortTransaction();
        return res.status(400).json({
          message: "No valid payment transaction found for refund",
        });
      }

      // Process refund with Razorpay
      const refundResponse = await razorpay.payments.refund(
        paymentRecord.transactionId,
        {
          amount: escrow.amount * 100,
        }
      );

      // Update payment status
      await Payment.findByIdAndUpdate(
        paymentRecord._id,
        { status: "refunded" },
        { session }
      );

      // Record refund transaction
      await Transaction.create(
        [
          {
            escrowId: escrow._id,
            type: "refund",
            amount: escrow.amount,
            status: "completed",
            RefundedId: refundResponse.id,
            description: `Refund for cancelled project: ${project.title}`,
          },
        ],
        { session }
      );

      // Mark project as cancelled
      project.status = "cancelled";
      await project.save({ session });

      await session.commitTransaction();

      await logActivity(
        clientId,
        `Project cancelled (ID: ${projectId}) and refund of ₹${escrow.amount} processed`
      );

      res.status(200).json({
        message: "Project cancelled and refund processed",
        refundId: refundResponse.id,
        refundAmount: escrow.amount,
      });
    } catch (err) {
      await session.abortTransaction();
      console.error("Error processing project cancellation:", err);
      res.status(500).json({
        message: "Error processing project cancellation",
        error: err.message,
      });
    } finally {
      session.endSession();
    }
  }
);

/**
 * POST /assign-freelancer
 * Assign a freelancer to a funded project
 */
router.post(
  "/assign-freelancer",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    const { project_id, freelancer_id } = req.body;
    const clientId = req.user.userId;

    try {
      // Validate inputs
      if (!project_id || !isValidObjectId(project_id)) {
        return res.status(400).json({ message: "Valid project_id is required" });
      }

      if (!freelancer_id || !isValidObjectId(freelancer_id)) {
        return res.status(400).json({ message: "Valid freelancer_id is required" });
      }

      // Verify project ownership
      const project = await Project.findOne({
        _id: project_id,
        clientId: clientId,
      });

      if (!project) {
        return res.status(404).json({
          message: "Project not found or you are not authorized",
        });
      }

      // Atomically update escrow - only if not already assigned
      const escrow = await Escrow.findOneAndUpdate(
        {
          projectId: project_id,
          clientId: clientId,
          status: "funded",
          freelancerId: null, // Only assign if no freelancer yet
        },
        {
          freelancerId: freelancer_id,
        },
        { new: true }
      );

      if (!escrow) {
        return res.status(404).json({
          message: "Escrow not found or freelancer already assigned",
        });
      }

      await logActivity(
        clientId,
        `Assigned freelancer ${freelancer_id} to project ${project_id}`
      );

      res.json({
        message: "Freelancer assigned successfully",
        escrowId: escrow._id,
      });
    } catch (err) {
      console.error("Error assigning freelancer:", err);
      res.status(500).json({
        message: "Error assigning freelancer",
        error: err.message,
      });
    }
  }
);

/**
 * POST /release-payment
 * Release payment to freelancer after project completion
 */
router.post(
  "/release-payment",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    const session = await mongoose.startSession();
    const { project_id, freelancer_id } = req.body;
    const clientId = req.user.userId; // Use authenticated user

    try {
      // Validate inputs
      if (!project_id || !isValidObjectId(project_id)) {
        return res.status(400).json({ message: "Valid project_id is required" });
      }

      if (!freelancer_id || !isValidObjectId(freelancer_id)) {
        return res.status(400).json({ message: "Valid freelancer_id is required" });
      }

      session.startTransaction();

      // Find and lock escrow atomically
      const escrow = await Escrow.findOneAndUpdate(
        {
          projectId: project_id,
          clientId: clientId,
          freelancerId: freelancer_id,
          status: "funded",
        },
        {
          status: "released", // Lock it immediately
        },
        { session, new: true }
      );

      if (!escrow) {
        await session.abortTransaction();
        return res.status(404).json({
          message: "Escrow not found, unauthorized, or already released",
        });
      }

      // Verify project completion
      const ongoingProject = await Ongoing.findOne({
        projectId: project_id,
        clientId: clientId,
        freelancerId: freelancer_id,
        status: "completed",
      }).session(session);

      if (!ongoingProject) {
        // Rollback escrow status
        await Escrow.findByIdAndUpdate(
          escrow._id,
          { status: "funded" },
          { session }
        );
        await session.abortTransaction();
        return res.status(404).json({
          message: "Project not found, not completed, or unauthorized",
        });
      }

      const project = await Project.findOne({
        _id: project_id,
        status: "in_progress",
      }).session(session);

      if (!project) {
        await Escrow.findByIdAndUpdate(
          escrow._id,
          { status: "funded" },
          { session }
        );
        await session.abortTransaction();
        return res.status(404).json({ message: "Project not found or not in progress" });
      }

      const freelancerAmount = ongoingProject.freelancerBidPrice;
      const remainingAmount = escrow.amount - freelancerAmount;

      // Validate sufficient funds
      if (freelancerAmount > escrow.amount) {
        await Escrow.findByIdAndUpdate(
          escrow._id,
          { status: "funded" },
          { session }
        );
        await session.abortTransaction();
        return res.status(400).json({
          message: "Insufficient funds in escrow",
        });
      }

      // Handle partial refund if remaining amount
      if (remainingAmount > 0) {
        const paymentRecord = await Payment.findOne({
          projectId: project_id,
          userId: clientId,
          status: "completed",
        }).session(session);

        if (paymentRecord) {
          const refundResponse = await razorpay.payments.refund(
            paymentRecord.transactionId,
            { amount: remainingAmount * 100 }
          );

          await Transaction.create(
            [
              {
                escrowId: escrow._id,
                type: "refund",
                amount: remainingAmount,
                status: "completed",
                RefundedId: refundResponse.id,
                description: `Partial refund for project: ${project.title}`,
              },
            ],
            { session }
          );
        }
      }

      // Update escrow final amount
      escrow.amount = 0;
      await escrow.save({ session });

      // Update project status
      project.status = "completed";
      await project.save({ session });

      // Create freelancer escrow record
      const freelancerEscrow = new FreelancerEscrowSchema({
        projectId: project_id,
        freelancerId: freelancer_id,
        amount: freelancerAmount,
      });
      await freelancerEscrow.save({ session });

      // Record transactions
      await Transaction.create(
        [
          {
            escrowId: freelancerEscrow._id,
            type: "received",
            amount: freelancerAmount,
            status: "completed",
            description: `Payment received for project: ${ongoingProject.title || "Unnamed Project"}`,
          },
          {
            escrowId: escrow._id,
            type: "release",
            amount: freelancerAmount,
            status: "settled",
            description: `Payment released to freelancer: ${ongoingProject.freelancer || "Unknown"}`,
          },
        ],
        { session }
      );

      await session.commitTransaction();

      await logActivity(
        clientId,
        `Released payment of ₹${freelancerAmount} to freelancer for project ${project_id}`
      );

      res.status(200).json({
        message: "Funds released to freelancer",
        releasedAmount: freelancerAmount,
      });
    } catch (err) {
      await session.abortTransaction();
      console.error("Error releasing payment:", err);
      res.status(500).json({
        message: "Error releasing payment",
        error: err.message,
      });
    } finally {
      session.endSession();
    }
  }
);

/**
 * POST /reject-project/:project_id
 * Reject a completed project and notify freelancer
 */
router.post(
  "/reject-project/:project_id",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    const { project_id } = req.params;
    const { clientFeedback } = req.body;
    const clientId = req.user.userId;

    try {
      // Validate project_id
      if (!isValidObjectId(project_id)) {
        return res.status(400).json({ message: "Invalid project ID format" });
      }

      // Validate feedback
      if (!clientFeedback || typeof clientFeedback !== "string" || clientFeedback.trim().length < 10) {
        return res.status(400).json({
          message: "Client feedback is required (minimum 10 characters)",
        });
      }

      // Find and validate project ownership
      const project = await Project.findById(project_id).populate(
        "freelancerId",
        "email username"
      );

      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      if (project.clientId.toString() !== clientId) {
        await logActivity(clientId, `Unauthorized project rejection attempt for ${project_id}`);
        return res.status(403).json({ message: "Unauthorized action" });
      }

      // Update ongoing project status
      await Ongoing.findOneAndUpdate(
        { projectId: project_id },
        { $set: { status: "on-hold" } }
      );

      // Update project status
      project.status = "rejected";
      await project.save();

      // Notify freelancer
      if (project.freelancerId && project.freelancerId.email) {
        await sendRejectionEmail(
          project.freelancerId.email,
          project.freelancerId.username,
          project.title,
          clientFeedback.trim()
        );
      }

      await logActivity(
        clientId,
        `Project rejected (Title: ${project.title}) and freelancer notified`
      );

      res.status(200).json({
        message: "Project rejected and freelancer notified",
      });
    } catch (error) {
      console.error("Error rejecting project:", error);
      res.status(500).json({
        message: "Server error",
        error: error.message,
      });
    }
  }
);

/**
 * POST /freelancer/withdraw/balance
 * Request withdrawal of freelancer earnings
 */
router.post(
  "/freelancer/withdraw/balance",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    const session = await mongoose.startSession();

    try {
      const freelancerId = req.user.userId;
      const { accountNumber, accountName, ifscCode, amount } = req.body;

      // ================ INPUT VALIDATION ================
      
      if (!accountNumber || !accountName || !ifscCode || !amount) {
        return res.status(400).json({ message: "All fields are required." });
      }

      // Validate amount
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 500) {
        return res.status(400).json({ message: "Minimum withdrawal is ₹500." });
      }

      // Validate account number (basic check)
      if (!/^\d{9,18}$/.test(accountNumber)) {
        return res.status(400).json({ message: "Invalid account number format." });
      }

      // Validate IFSC code
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode.toUpperCase())) {
        return res.status(400).json({ message: "Invalid IFSC code format." });
      }

      // Sanitize account name
      const sanitizedAccountName = accountName.trim().substring(0, 100);

      session.startTransaction();

      // ================ ATOMIC BALANCE CHECK AND DEDUCTION ================
      
      // Get all escrows with locking
      const escrows = await FreelancerEscrowSchema.find({
        freelancerId: freelancerId,
        status: "paid",
      }).session(session);

      const totalBalance = escrows.reduce((sum, e) => sum + e.amount, 0);

      if (totalBalance < amount) {
        await session.abortTransaction();
        return res.status(400).json({
          message: "Insufficient balance.",
          available: totalBalance,
          requested: amount,
        });
      }

      // Deduct from escrows atomically
      let remainingAmount = amount;
      for (const escrow of escrows) {
        if (remainingAmount <= 0) break;

        if (escrow.amount <= remainingAmount) {
          remainingAmount -= escrow.amount;
          escrow.amount = 0;
          escrow.status = "withdraw";
        } else {
          escrow.amount -= remainingAmount;
          remainingAmount = 0;
        }
        await escrow.save({ session });
      }

      // Create admin withdrawal request
      const adminWithdraw = await AdminWithdrawSchema.create(
        [
          {
            freelancerId,
            type: "withdraw",
            amount: amount,
            status: "pending",
            description: `Withdrawal request for ₹${amount}`,
            bankDetails: {
              accountNumber,
              accountName: sanitizedAccountName,
              ifscCode: ifscCode.toUpperCase(),
            },
          },
        ],
        { session }
      );

      // Record transaction
      await Transaction.create(
        [
          {
            escrowId: adminWithdraw[0]._id,
            freelancerId,
            type: "withdrawal",
            amount,
            status: "pending",
            description: `Withdrawal request of ₹${amount}`,
          },
        ],
        { session }
      );

      await session.commitTransaction();

      await logActivity(
        freelancerId,
        `Withdrawal request submitted for ₹${amount}`
      );

      return res.status(200).json({
        message: `Withdrawal of ₹${amount} initiated successfully.`,
        withdrawalId: adminWithdraw[0]._id,
      });
    } catch (error) {
      await session.abortTransaction();
      console.error("Withdraw Error:", error);
      return res.status(500).json({ message: "Internal server error." });
    } finally {
      session.endSession();
    }
  }
);

module.exports = router;
