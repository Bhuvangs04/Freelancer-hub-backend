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
const axios = require("axios");
const sendEmail = require("../utils/sendEmail");
const crypto = require("crypto");
const Activity = require("../models/ActionSchema");
const fs = require("fs");
const path = require("path");
const Ongoing = require("../models/OnGoingProject.Schema");

const logActivity = async (userId, action) => {
  try {
    await Activity.create({ userId, action });
  } catch (error) {
    console.error("Error logging activity:", error);
  }
};

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const sendRejectionEmail = async (
  freelancerEmail,
  freelancerName,
  projectTitle,
  clientFeedback
) => {
  const subject = "Project Rejected";

  // Read the HTML template
  const templatePath = path.join(
    __dirname,
    "../templates/rejectEmailTemplate.html"
  );
  let emailTemplate = fs.readFileSync(templatePath, "utf8");

  // Replace placeholders with actual values
  emailTemplate = emailTemplate
    .replace("{{freelancerName}}", freelancerName)
    .replace("{{projectTitle}}", projectTitle)
    .replace("{{loginUrl}}", "http://localhost:8080/sign-in")
    .replace("{{clientFeedback}}", clientFeedback);

  // Send email
  await sendEmail(freelancerEmail, subject, emailTemplate, true);
};

// Create payment order
router.post(
  "/create-order",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    const { amount, currency, project_id, client_id } = req.body;
    try {
      const order = await razorpay.orders.create({
        amount: amount,
        currency,
      });

      const payment = new Payment({
        userId: client_id,
        projectId: project_id,
        transactionId: order.id,
        amount: amount / 100,
        paymentMethod: "bank_transfer",
        status: "pending",
      });
      await payment.save();
      res.json(order);
    } catch (err) {
      res
        .status(500)
        .json({ message: "Error creating order", error: err.message });
    }
  }
);

// Verify payment
// Verify payment
router.post(
  "/verify-payment",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      project_id,
      client_id,
    } = req.body;

    try {
      console.log("✅ Step 1: Verifying Signature...");
      const generatedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest("hex");

      if (generatedSignature !== razorpay_signature) {
        return res.status(400).json({ message: "Invalid payment signature" });
      }

      console.log("✅ Step 2: Fetching Payment from Database...");
      const payment = await Payment.findOne({
        transactionId: razorpay_order_id,
        userId: client_id,
      });

      const project = await Project.findOne({
        _id: project_id,
        clientId: client_id,
      });

      if (!project)
        return res.status(400).json({ message: "Project details Not found" });

      if (!payment) return res.status(400).json({ message: "Order not found" });

      console.log("✅ Step 3: Checking Razorpay Payment Status...");
      const paymentStatus = await axios.get(
        `https://api.razorpay.com/v1/payments/${razorpay_payment_id}`,
        {
          auth: {
            username: process.env.RAZORPAY_KEY_ID,
            password: process.env.RAZORPAY_KEY_SECRET,
          },
        }
      );

      let isCaptured = paymentStatus.data.status === "captured";

      if (!isCaptured) {
        console.log("✅ Step 4: Capturing Payment...");
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
      }

      // ✅ Continue Execution: Store in Escrow Wallet
      console.log("✅ Step 5: Calculating Commission & Escrow...");
      const commission = payment.amount - project.budget;
      const freelancerAmount = payment.amount - commission;

      console.log("✅ Step 6: Updating Payment Status...");
      payment.status = "completed";
      payment.transactionId = razorpay_payment_id;
      await payment.save();

      console.log("✅ Step 7: Storing Freelancer Payment in Escrow...");
      const escrow = new Escrow({
        projectId: project_id,
        clientId: client_id,
        freelancerId: null,
        amount: freelancerAmount,
        status: "funded",
      });
      await escrow.save();

      console.log("✅ Step 8: Recording Transactions...");
      await Transaction.create({
        escrowId: escrow._id,
        type: "deposit",
        amount: freelancerAmount,
        status: "on_hold",
      });

      return res.json({
        message: isCaptured
          ? "Payment already captured, commission deducted, and funds held in escrow!"
          : "Payment captured, commission deducted, and funds held in escrow!",
      });
    } catch (err) {
      console.log("❌ Error:", err);
      return res
        .status(500)
        .json({ message: "Error verifying payment", error: err.message });
    }
  }
);

// Project deletion (Refund funds to client)
router.delete(
  "/delete-project/:projectId",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    const { projectId } = req.params;
    const clientId = req.user.userId;

    try {
      // Find the project
      const project = await Project.findOne({ _id: projectId, clientId });
      if (!project) {
        return res
          .status(404)
          .json({ message: "Project not found or unauthorized" });
      }

      // Find escrow record
      const escrow = await Escrow.findOne({
        projectId: projectId,
        clientId: clientId,
        status: "funded",
        freelancerId: null, // Ensure no freelancer is assigned
      });

      if (!escrow) {
        return res.status(404).json({ message: "Escrow record not found" });
      }

      // Find payment transaction
      const paymentRecord = await Payment.findOne({
        projectId: projectId,
        userId: clientId,
        status: "completed",
      });

      if (!paymentRecord || !paymentRecord.transactionId) {
        return res
          .status(400)
          .json({ message: "No valid payment transaction found for refund" });
      }

      // Fetch Razorpay balance
      // Process refund immediately
      refundResponse = await razorpay.payments.refund(
        paymentRecord.transactionId,
        {
          amount: escrow.amount * 100,
        }
      );

      console.log("Refund Response:", refundResponse);

      // Update escrow status
      escrow.status = "refunded";
      await escrow.save();

      // Record transaction
      await Transaction.create({
        escrowId: escrow._id,
        type: "refund",
        amount: escrow.amount,
        status: "completed",
        refundedId: refundResponse.id,
      });

      console.log(`Refund processed immediately for project ${projectId}`);

      // Mark project as canceled
      project.status = "cancelled";
      await project.save();

      // Log activity
      await logActivity(
        req.user.userId,
        `Project canceled (ID: ${projectId}) and refund processed`
      );

      res.status(200).json({
        message: "Project canceled and refund processed",
        refundResponse,
      });
    } catch (err) {
      console.error("Error processing project cancellation:", err);
      res.status(500).json({
        message: "Error processing project cancellation",
        error: err.message,
      });
    }
  }
);

// Assign freelancer to project
router.post(
  "/assign-freelancer",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    const { project_id, freelancer_id } = req.body;
    try {
      const escrow = await Escrow.findOne({
        projectId: project_id,
        status: "funded",
      });
      if (!escrow) return res.status(404).send("Escrow not found");

      escrow.freelancerId = freelancer_id;
      await escrow.save();
      res.send("Freelancer assigned successfully");
    } catch (err) {
      res.status(500).send("Error assigning freelancer");
    }
  }
);

router.post(
  "/release-payment",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    const { project_id, client_id, freelancer_id } = req.body;
    try {
      const escrow = await Escrow.findOne({
        projectId: project_id,
        clientId: client_id,
        freelancerId: freelancer_id,
        status: "funded",
      });

      if (!escrow) {
        return res.status(404).json({ message: "Escrow record not found" });
      }

      const findProject = await Ongoing.findOne({
        projectId: project_id,
        clientId: client_id,
        freelancerId: freelancer_id,
        status: "completed",
      });

      if (!findProject) {
        return res
          .status(404)
          .json({ message: "Project not found or unauthorized" });
      }

      // Ensure enough funds in escrow before releasing
      if (findProject.freelancerBidPrice > escrow.amount) {
        return res
          .status(400)
          .json({ message: "Insufficient funds to release" });
      }

      const project = await Project.findOne({
        _id: project_id,
        status: "in_progress",
      });
      if (!project) {
        return res.status(404).json({ message: "No projects Found" });
      }

      // Calculate freelancer's payment and update escrow
      const freelancerAmount = findProject.freelancerBidPrice;
      escrow.amount -= freelancerAmount;
      if (escrow.amount === 0) {
        escrow.status = "released";
      } else {
        const paymentRecord = await Payment.findOne({
          projectId: project_id,
          userId: client_id,
          status: "completed",
        });

        const refundResponse = await razorpay.payments.refund(
          paymentRecord.transactionId,
          {
            amount: escrow.amount * 100,
          }
        );
        escrow.status = "partial refund";
        await Transaction.create({
          escrowId: escrow._id,
          type: "refund",
          amount: escrow.amount,
          status: "completed",
          refundedId: refundResponse.id,
        });
      }

      project.status = "completed";
      escrow.amount = 0.0;
      await project.save();
      await escrow.save();
      // Create a new escrow record for the freelancer
      const createNewEscrow = new FreelancerEscrowSchema({
        projectId: project_id,
        freelancerId: freelancer_id,
        amount: freelancerAmount,
      });

      await createNewEscrow.save();

      // Record transactions
      await Transaction.create({
        escrowId: createNewEscrow._id,
        description: `Payment received for project: ${
          findProject.title || "Unnamed Project"
        }`,
        amount: freelancerAmount,
        status: "completed",
        type: "received",
      });

      await Transaction.create({
        escrowId: escrow._id,
        type: "release",
        description: `Payment sended for work, name: ${
          findProject.freelancer || "Unnamed Project"
        }`,
        amount: freelancerAmount,
        status: "settled",
      });

      res.status(200).json({ message: "Funds released to freelancer" });
    } catch (err) {
      console.error("Error releasing payment:", err);
      res.status(500).json({ message: "Error releasing payment" });
    }
  }
);

router.post(
  "/reject-project/:project_id",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    try {
      const { project_id } = req.params;
      const { clientFeedback } = req.body;
      // Find the project and populate freelancer details
      const project = await Project.findById(project_id).populate(
        "freelancerId",
        "email username"
      );
      await Ongoing.findOneAndUpdate(
        { projectId: project_id },
        {
          $set: { status: "on-hold" },
        }
      );
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Ensure the client is the owner of the project
      if (project.clientId.toString() !== req.user.userId) {
        return res.status(403).json({ message: "Unauthorized action" });
      }

      // Update project status
      project.status = "rejected";
      await project.save();

      // Notify the freelancer via email
      if (project.freelancerId && project.freelancerId.email) {
        await sendRejectionEmail(
          project.freelancerId.email,
          project.freelancerId.username,
          project.title,
          clientFeedback
        );
      }

      // Log activity
      await logActivity(
        req.user.userId,
        `Project rejected (Title: ${project.title}) and informed the freelancer`
      );

      res
        .status(200)
        .json({ message: "Project rejected and freelancer notified" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Freelancer withdraw route

router.post(
  "/freelancer/withdraw/balance",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const freelancerId = req.user.userId;
      const { accountNumber, accountName, ifscCode, amount } = req.body;

      if (!accountNumber || !accountName || !ifscCode || !amount) {
        return res.status(400).json({ message: "All fields are required." });
      }

      if (amount < 500) {
        return res.status(400).json({ message: "Minimum withdrawal is $500." });
      }

      // Get freelancer's escrow balance
      const escrows = await FreelancerEscrowSchema.find({
        freelancerId: freelancerId,
      });

      const totalBalance = escrows.reduce((sum, e) => sum + e.amount, 0);
      if (!escrows || totalBalance < amount) {
        return res.status(400).json({ message: "Insufficient balance." });
      }

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
        await escrow.save();
      }

      const adminWithdraw = await AdminWithdrawSchema.create({
        freelancerId,
        type: "withdraw",
        amount: amount,
        status: "pending",
        description: `New withdrawal request for ₹${amount}`,
        bankDetails: { accountNumber, accountName, ifscCode },
      });

      // Record withdrawal transaction
      const transaction = new Transaction({
        escrowId: adminWithdraw._id,
        freelancerId,
        type: "withdrawal",
        amount,
        status: "pending",
        description: `Withdrawal request of ₹${amount}`,
      });

      await transaction.save();

      return res.status(200).json({
        message: `Withdrawal of ₹${amount} initiated.`,
      });
    } catch (error) {
      console.error("Withdraw Error:", error);
      return res.status(500).json({ message: "Internal server error." });
    }
  }
);



module.exports = router;
