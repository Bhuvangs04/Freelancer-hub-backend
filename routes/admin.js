const express = require("express");
const { verifyToken, authorize } = require("../middleware/Auth");
const Transaction = require("../models/Transaction");
const AccountDetails = require("../models/AccountDetail");
const Escrow = require("../models/Escrow");
const Razorpay = require("razorpay");
const router = express.Router();
const User = require("../models/User");
const Project = require("../models/Project");
const DisputeSchema = require("../models/Dispute");
const { uploadFile } = require("../utils/S3");
const FundAccount = require("../models/FundAccount");
const fileType = require("file-type");
const Action = require("../models/ActionSchema");
const multer = require("multer");
const upload = multer();
const axios = require("axios"); // Model for storing Fund Account details

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const logActivity = async (userId, action) => {
  try {
    await Action.create({ userId, action });
  } catch (error) {
    console.error("Error logging activity:", error);
  }
};

const scanFile = async (file, allowedTypes, maxSize) => {
  if (!file) throw new Error("File is missing");

  const { buffer, size, originalname } = file;

  // Check file size
  if (size > maxSize) {
    throw new Error(`File size exceeds the maximum limit of ${maxSize} bytes`);
  }

  // Detect file type
  const type = await fileType.fromBuffer(buffer);

  if (!type || !allowedTypes.includes(type.mime)) {
    throw new Error(`Invalid file type for ${originalname}`);
  }

  return type;
};

// Example: Get all users
router.get("/users", verifyToken, authorize(["admin"]), async (req, res) => {
  try {
    const users = await User.find().select(
      "-password -__v -isBanned -banExpiresAt -bio -resumeUrl"
    );
    res.json({ users });
  } catch (err) {
    res.status(500).send("Error fetching users");
  }
});

// Example: Ban user temporarily
router.post(
  "/ban-user/:userId/ban-temporary",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    const { userId } = req.params;
    try {
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      user.isBanned = true;
      user.banExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await user.save();
      res.json({ message: "User banned successfully for 7 days" });
    } catch (err) {
      res.status(500).send("Error banning user");
    }
  }
);

router.post(
  "/ban-user/:userId/ban-permanent",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    const { userId } = req.params;
    try {
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      user.isBanned = true;
      await user.save();
      res.json({ message: "User banned successfully" });
    } catch (err) {
      res.status(500).send("Error banning user");
    }
  }
);

router.post(
  "/relase-ban-user/:userId/realsed",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    const { userId } = req.params;
    try {
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      user.isBanned = false;
      user.banExpiresAt = null;
      await user.save();
      res.json({ message: "User ban released successfully" });
    } catch (error) {
      res.status(500).send({ message: "Error while activating account" });
    }
  }
);

router.get(
  "/pay-out/freelancers",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    try {
      const releasedPayments = await Escrow.find({
        status: "released",
      }).populate("freelancerId");

      if (!releasedPayments.length) {
        return res.status(404).json({ message: "No released payments found" });
      }

      res.json({ releasedPayments });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.post("/create-fund-account/:userId", verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;

    // Get user details from DB
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Step 1: Create a Razorpay Contact (Required before creating a Fund Account)
    const contactResponse = await axios.post(
      "https://api.razorpay.com/v1/contacts",
      {
        name: user.username || "Test Freelancer",
        email: user.email || "test@freelancer.com",
        contact: user.phone || "9999999999",
        type: "employee",
        reference_id: `${userId}`,
      },
      {
        auth: {
          username: process.env.RAZORPAY_KEY_ID,
          password: process.env.RAZORPAY_KEY_SECRET,
        },
      }
    );

    const contactId = contactResponse.data.id;

    const accountDetails = await AccountDetails.findOne({ userId });
    if (!accountDetails) {
      return res.status(404).json({ message: "Account details not found" });
    }

    const fundAccountResponse = await axios.post(
      "https://api.razorpay.com/v1/fund_accounts",
      {
        contact_id: contactId,
        account_type: accountDetails.accountType,
        bank_account: {
          name: user.username || "Test Account",
          ifsc: accountDetails.ifscCode,
          account_number: accountDetails.accountNumber,
        },
      },
      {
        auth: {
          username: process.env.RAZORPAY_KEY_ID,
          password: process.env.RAZORPAY_KEY_SECRET,
        },
      }
    );

    const fundAccountId = fundAccountResponse.data.id;

    // Step 3: Store Fund Account Details in MongoDB
    const fundAccount = new FundAccount({
      userId,
      fundAccountId,
      contactId,
      bankDetails: {
        accountNumber: accountDetails.accountNumber,
        ifsc: accountDetails.ifscCode || "KARB0007104",
        name: user.username || "Test Account",
      },
    });

    await fundAccount.save();

    res.json({
      message: "Fund account created successfully",
      fundAccountId,
      contactId,
    });
  } catch (error) {
    console.error(error);
    console.error(
      "Error creating fund account:",
      error.response?.data || error
    );
    res.status(500).json({ message: "Failed to create fund account" });
  }
});

router.post(
  "/pay-out/freelancers/bulk",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    try {
      const releasedPayments = await Escrow.find({ status: "released" });

      if (!releasedPayments.length) {
        return res.status(404).json({ message: "No released payments found" });
      }

      let payouts = [];
      for (const payment of releasedPayments) {
        const freelancer = await FundAccount.findOne({
          userId: payment.freelancerId,
        });

        if (!freelancer || !freelancer.fundAccountId) {
          console.warn(
            `No Razorpay fund account found for freelancer ${payment.freelancerId}`
          );
          continue;
        }

        const amountAfterCommission = Math.floor(payment.amount * 0.9 * 100); // Deduct 10% commission

        const payout = await razorpay.payouts.create({
          fund_account_id: freelancer.fundAccountId,
          amount: amountAfterCommission,
          currency: "INR",
          mode: "IMPS",
          purpose: "payout",
          queue_if_low_balance: true,
          reference_id: `payout_${payment._id}`,
          narration: "Freelancer Payout",
        });

        payouts.push(payout);

        // Update Escrow status to "paid"
        payment.status = "paid";
        await payment.save();

        // Save transaction record
        await new Transaction({
          userId: payment.freelancerId,
          escrowId: payment._id,
          type: "withdrawal",
          amount: amountAfterCommission / 100,
          status: "completed",
        }).save();
      }

      res.json({ message: "Payouts processed successfully", payouts });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Payout processing failed" });
    }
  }
);

// Process individual payout
router.post(
  "/pay-out/freelancers/:freelancerId",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    try {
      const { freelancerId } = req.params;
      const payment = await Escrow.findOne({
        freelancerId,
        status: "released",
      });

      if (!payment) {
        return res
          .status(404)
          .json({ message: "No released funds for this freelancer" });
      }

      const freelancer = await FundAccount.findOne({ userId: freelancerId });

      if (!freelancer || !freelancer.fundAccountId) {
        return res
          .status(400)
          .json({ message: "Freelancer fund account not found" });
      }

      const amountAfterCommission = Math.floor(payment.amount * 0.9 * 100); // Deduct 10% commission

      const payout = await razorpay.payouts.create({
        fund_account_id: freelancer.fundAccountId,
        amount: amountAfterCommission,
        currency: "INR",
        mode: "IMPS",
        purpose: "payout",
        queue_if_low_balance: true,
        reference_id: `payout_${payment._id}`,
        narration: "Freelancer Payout",
      });

      // Update Escrow status to "paid"
      payment.status = "paid";
      await payment.save();

      // Save transaction record
      await new Transaction({
        userId: freelancerId,
        escrowId: payment._id,
        type: "withdrawal",
        amount: amountAfterCommission / 100,
        status: "completed",
      }).save();

      res.json({ message: "Payout successful", payout });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Payout processing failed" });
    }
  }
);

router.get(
  "/get/reports/client/:id",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const role = "client";

      const user = await User.findOne({ _id: userId, role: role });

      if (!user) {
        return res.status(403).json({
          message:
            "Please choose correct role or please login to raise dispute.",
        });
      }

      const project = await Project.find({ clientId: userId })
        .select("title timestamps status")
        .populate("freelancerId", "username");

      if (!project.length) {
        return res.status(404).json({ message: "No projects" });
      }

      res.status(200).json(project);
    } catch (error) {
      console.log(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.get(
  "/get/reports/freelancer/:id",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const role = "freelancer";

      const user = await User.findOne({ _id: userId, role: role });

      if (!user) {
        return res.status(403).json({
          message:
            "Please choose correct role or please login to raise dispute.",
        });
      }

      const project = await Project.find({ freelancerId: userId })
        .select("title timestamps status")
        .populate("clientId", "username");
      if (!project.length) {
        return res.status(404).json({ message: "No projects" });
      }

      res.status(200).json(project);
    } catch (error) {
      console.log(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.post(
  "/disputes/raised",
  verifyToken,
  upload.single("evidence"),
  async (req, res) => {
    try {
      const { disputeType, projectId, description, userType } = req.body;
      const evidence = req.file;
      if (!evidence || !userType || !disputeType || !description) {
        return res.status(403).json({
          message: "Please add required docs.",
        });
      }
      const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/jpg",
        "image/webp",
      ];
      await scanFile(evidence, allowedTypes, 5 * 1024 * 1024);
       let project_output = null;
      if (projectId) {
        project_output = await Project.findOne({
          _id: projectId,
          $or: [
            { clientId: req.user.userId },
            { freelancerId: req.user.userId },
          ],
        });
      }

      const folderName = "User-Resume";
      const filename = `${folderName}/${
        req.user.userId
      }-${userType}-${disputeType}-evidence.${evidence.mimetype.split("/")[1]}`;
      const url = await uploadFile(
        evidence,
        process.env.AWS_BUCKET_NAME,
        filename
      );

      const disputeData = {
        raisedBy: userType,
        reason: description,
        file_url: url,
      };
      if (projectId && project_output) {
        disputeData.projectId = projectId;
        disputeData.clientId = project_output.clientId;
        disputeData.freelancerId = project_output.freelancerId;
      } else {
        disputeData.userID = req.user.userId;
      }
      await DisputeSchema.create(disputeData);

      await logActivity(req.user.userId, "Dispute raised ");
      res.status(200).json({ message: "Dispute submitted.Replies take 24hrs" });
    } catch (error) {
      console.log(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

module.exports = router;
