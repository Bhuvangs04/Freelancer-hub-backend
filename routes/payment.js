const express = require("express");
const { verifyToken, authorize } = require("../middleware/Auth");
const Razorpay = require("razorpay");
const { v4: uuidv4 } = require("uuid");
const router = express.Router();
const Payment = require("../models/Payment");
const Escrow = require("../models/Escrow");
const Transaction = require("../models/Transaction");
const Project = require("../models/Project");
const axios = require("axios");
const crypto = require("crypto");
const Activity = require("../models/ActionSchema");


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





// Create payment order
router.post("/create-order", verifyToken,authorize(['client']) ,async (req, res) => {
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
      amount: amount/100,
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
});

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
            amount: escrow.amount * 100, // Convert to paisa
          }
        );

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
      res
        .status(500)
        .json({
          message: "Error processing project cancellation",
          error: err.message,
        });
    }
  }
);


// Assign freelancer to project
router.post("/assign-freelancer", verifyToken,authorize(['client']), async (req, res) => {
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
});

// Client releases funds to freelancer
router.post("/release-payment", verifyToken,authorize(['client']) ,async (req, res) => {
  const { project_id, client_id } = req.body;
  try {
    const escrow = await Escrow.findOne({
      projectId: project_id,
      clientId: client_id,
      status: "funded",
    });
    if (!escrow) return res.status(404).send({message:"Escrow record not found"});
    const findProject = await Project.findOne ({  _id: project_id, clientId: client_id, status: "completed" });
    if (!findProject) return res.status(404).send({message:"Project not found or unauthorized"});
    if(findProject.budget > escrow.amount){
      return res.status(400).send({message:"Insufficient funds to release"});
    };

    escrow.amount -=findProject.budget;
    escrow.status = "released";

    await escrow.save();

    await Transaction.create({
      _id: uuidv4(),
      escrowId: escrow._id,
      type: "release",
      amount: escrow.amount,
      status: "completed",
    });

    res.status(200).send({message:"Funds released to freelancer"});
  } catch (err) {
    res.status(500).send("Error releasing payment");
  }
});

module.exports = router;
