const express = require("express");
const { verifyToken, authorize } = require("../middleware/Auth");
const Transaction = require("../models/Transaction");
const DisputeSchema = require("../models/Dispute");
const Razorpay = require("razorpay");
const router = express.Router();
const User = require("../models/User");
const Project = require("../models/Project");
const { uploadFile } = require("../utils/S3");
const fileType = require("file-type");
const Action = require("../models/ActionSchema");
const PaymentSchema = require("../models/Payment");
const multer = require("multer");
const ExcelJS = require("exceljs");
const upload = multer();
const axios = require("axios"); // Model for storing Fund Account details
const AdminWithdrawSchema = require("../models/WithdrawReportsAdmin");

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  throw new Error("Razorpay credentials are not configured");
}

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

router.get(
  "/dashboard-overview",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    try {
      // Fetch total users
      const totalUsers = await User.countDocuments();

      // Fetch total revenue (sum of all completed transactions)
      const totalRevenue = await Transaction.aggregate([
        { $match: { status: "completed" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]);
      const revenue = totalRevenue.length > 0 ? totalRevenue[0].total : 0;

      // Fetch quick stats
      const activeFreelancers = await User.countDocuments({
        role: "freelancer",
        status: "active",
      });
      const suspendedAccounts = await User.countDocuments({
        status: "suspended",
      });
      const completedProjects = await Project.countDocuments({
        status: "completed",
      });
      const pendingReviews = await Project.countDocuments({
        status: "in_progress",
      });

      res.json({
        totalUsers,
        revenue,
        quickStats: {
          activeFreelancers,
          suspendedAccounts,
          completedProjects,
          pendingReviews,
        },
      });
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
      res.status(500).json({ message: "Error fetching dashboard data" });
    }
  }
);

router.get(
  "/get/users",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    try {
      const users = await User.find().select(
        "-password -__v  -banExpiresAt -bio -resumeUrl"
      );
      res.json({ users });
    } catch (err) {
      res.status(500).send("Error fetching users");
    }
  }
);

// Example: Ban user temporarily
router.post(
  "/ban-user/:status/:userId",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    const { userId } = req.params;
    try {
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      user.isBanned = true;
      user.isbanDate = Date.now();
      user.banExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await user.save();
      res.json({ message: "User banned successfully for 7 days" });
    } catch (err) {
      res.status(500).send("Error banning user");
    }
  }
);

router.post(
  "/ban_user/:userId/ban_permanent",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    const { userId } = req.params;
    try {
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      user.isBanned = true;
      user.isbanDate = Date.now();
      await user.save();
      res.json({ message: "User banned successfully" });
    } catch (err) {
      res.status(500).send("Error banning user");
    }
  }
);

router.post(
  "/relase_ban_user/:userId/realsed/false",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    const { userId } = req.params;
    try {
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      user.isBanned = false;
      user.isbanDate = null;
      user.banExpiresAt = null;
      await user.save();
      res.json({ message: "User ban released successfully" });
    } catch (error) {
      res.status(500).send({ message: "Error while activating account" });
    }
  }
);

router.get(
  "/all/transaction",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    try {
      const all = await PaymentSchema.find().populate("userId", "username");
      res.status(200).json(all);
    } catch (error) {
      console.log(error);
      res.status(500).send({ message: "Error while activating account" });
    }
  }
);

router.get(
  "/transaction/:projectId",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const all = await PaymentSchema.findOne({ projectId }).populate(
        "userId projectId",
        "username title budget "
      );
      res.status(200).json(all);
    } catch (error) {
      console.log(error);
      res.status(500).send({ message: "Error while activating account" });
    }
  }
);

router.get(
  "/get/trasacntion/excel",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    try {
      const transactions = await PaymentSchema.find().populate(
        "userId projectId",
        "username title budget "
      );

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Transactions");

      // Define columns
      worksheet.columns = [
        { header: "Username", key: "username", width: 20 },
        { header: "Transaction ID", key: "transactionId", width: 25 },
        { header: "Project ID", key: "projectId", width: 25 },
        { header: "Project Name", key: "title", width: 25 },
        { header: "Project Budget", key: "budget", width: 15 },
        { header: "Amount", key: "amount", width: 15 },
        { header: "Payment Method", key: "paymentMethod", width: 20 },
        { header: "Status", key: "status", width: 15 },
        { header: "Created At", key: "createdAt", width: 25 },
      ];

      // Add rows
      transactions.forEach((transaction) => {
        worksheet.addRow({
          username: transaction.userId?.username || "Unknown",
          transactionId: transaction.transactionId,
          projectId: transaction.projectId._id? || "N/A",
          title: transaction.projectId.title? || "N/A",
          budget: transaction.projectId.budget,
          amount: transaction.amount,
          paymentMethod: transaction.paymentMethod,
          status: transaction.status,
          createdAt: new Date(transaction.createdAt).toLocaleString(),
        });
      });

      // Set response headers
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=transactions.xlsx"
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );

      // Send the workbook as a response
      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      console.error("Error generating Excel file:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

router.get(
  "/payout/excel",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    try {
      const transactions = await AdminWithdrawSchema.find().populate(
        "freelancerId",
        "username"
      );

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Transactions");

      // Define columns
      worksheet.columns = [
        { header: "Freelancer Id", key: "freelancerId", width: 25 },
        { header: "Username", key: "username", width: 25 },
        { header: "Type", key: "type", width: 15 },
        { header: "Amount", key: "amount", width: 20 },
        { header: "Status", key: "status", width: 20 },
        { header: "Description", key: "description", width: 50 },
        { header: "CreatedAt", key: "createdAt", width: 25 },
        { header: "Account Number", key: "accountNumber", width: 20 },
        { header: "IFSC code", key: "ifscCode", width: 25 },
      ];

      // Add rows
      transactions.forEach((transaction) => {
        worksheet.addRow({
          freelancerId: transaction.freelancerId._id,
          username: transaction.freelancerId.username,
          type: transaction.type,
          amount: transaction.amount,
          status: transaction.status,
          description: transaction.description,
          createdAt: new Date(transaction.createdAt).toLocaleString(),
          accountNumber: transaction.bankDetails.accountNumber,
          ifscCode: transaction.bankDetails.ifscCode,
        });
      });

      // Set response headers
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=transactions.xlsx"
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );

      // Send the workbook as a response
      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Payout processing failed" });
    }
  }
);

router.get(
  "/pay-out/freelancers",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    try {
      const payouts = await AdminWithdrawSchema.find().populate(
        "freelancerId",
        "username"
      );

      res.json({ payouts });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
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

      const payment = await AdminWithdrawSchema.findOne({ freelancerId }).sort({
        createdAt: -1,
      });
      if (!payment || payment.status !== "pending") {
        return res
          .status(404)
          .json({ message: "No pending payout request found" });
      }

      const transaction = await Transaction.findOne({
        escrowId: payment._id,
        type: "withdrawal",
      }).sort({ createdAt: -1 });
      // Deduct 10% commission

      // Update payment status manually
      payment.status = "approved";
      await payment.save();

      transaction.status = "completed";
      await transaction.save();

      res.json({
        message: "Payout processed manually",
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Payout processing failed" });
    }
  }
);

router.get(
  "/get/disputes",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    try {
      const AllReports = await DisputeSchema.find();

      res.status(200).json(AllReports);
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

      const folderName = "Disputes-doc";
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
