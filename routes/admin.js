const express = require("express");
const { verifyToken, authorize } = require("../middleware/Auth");
const router = express.Router();
const mongoose = require("mongoose");

// Models
const User = require("../models/User");
const Project = require("../models/Project");
const Escrow = require("../models/Escrow");
const Transaction = require("../models/Transaction");
const Review = require("../models/Review");
const DisputeSchema = require("../models/Dispute");
const PaymentSchema = require("../models/Payment");
const AdminWithdrawSchema = require("../models/WithdrawReportsAdmin");
const SiteSettings = require("../models/SiteSettings");
const Content = require("../models/Content");
const Category = require("../models/Category");
const AdminActivityLog = require("../models/AdminActivityLog");
const Action = require("../models/ActionSchema");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const walletHelper = require("../utils/walletHelper");

// Utils
const { uploadFile } = require("../utils/S3");
const fileType = require("file-type");
const multer = require("multer");
const ExcelJS = require("exceljs");
const upload = multer();

// ============================================================================
// HELPERS
// ============================================================================

const getClientIp = (req) =>
  req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
  req.connection?.remoteAddress ||
  req.ip ||
  "unknown";

const logAdminActivity = async (adminId, action, opts = {}) => {
  try {
    await AdminActivityLog.create({
      adminId,
      action,
      targetType: opts.targetType || null,
      targetId: opts.targetId || null,
      reason: opts.reason || "",
      metadata: opts.metadata || {},
      ipAddress: opts.ipAddress || "",
    });
  } catch (err) {
    console.error("Error logging admin activity:", err);
  }
};

const scanFile = async (file, allowedTypes, maxSize) => {
  if (!file) throw new Error("File is missing");
  const { buffer, size, originalname } = file;
  if (size > maxSize)
    throw new Error(`File size exceeds the maximum limit of ${maxSize} bytes`);
  const type = await fileType.fromBuffer(buffer);
  if (!type || !allowedTypes.includes(type.mime))
    throw new Error(`Invalid file type for ${originalname}`);
  return type;
};

// ============================================================================
// 1. DASHBOARD
// ============================================================================

router.get(
  "/dashboard-overview",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const [
        totalUsers,
        totalFreelancers,
        totalClients,
        totalProjects,
        escrowAgg,
        revenueAgg,
        activeFreelancers,
        suspendedAccounts,
        completedProjects,
        pendingProjects,
        openProjects,
      ] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ role: "freelancer" }),
        User.countDocuments({ role: "client" }),
        Project.countDocuments(),
        Escrow.aggregate([
          { $match: { status: "funded" } },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]),
        Transaction.aggregate([
          { $match: { type: "commission", status: "completed" } },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]),
        User.countDocuments({ role: "freelancer", status: "active" }),
        User.countDocuments({ isBanned: true }),
        Project.countDocuments({ status: "completed" }),
        Project.countDocuments({ status: "in_progress" }),
        Project.countDocuments({ status: "open" }),
      ]);

      res.json({
        totalUsers,
        totalFreelancers,
        totalClients,
        totalProjects,
        totalEscrowHeld: escrowAgg.length > 0 ? escrowAgg[0].total : 0,
        totalRevenue: revenueAgg.length > 0 ? revenueAgg[0].total : 0,
        quickStats: {
          activeFreelancers,
          suspendedAccounts,
          completedProjects,
          pendingProjects,
          openProjects,
        },
      });
    } catch (error) {
      console.error("Dashboard error:", error);
      res.status(500).json({ message: "Error fetching dashboard data" });
    }
  }
);

// ============================================================================
// 2. USER MANAGEMENT
// ============================================================================

// Get all users (with pagination & search)
router.get(
  "/users",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const { page = 1, limit = 20, search, role, status } = req.query;
      const filter = {};

      if (search) {
        filter.$or = [
          { username: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ];
      }
      if (role) filter.role = role;
      if (status === "banned") filter.isBanned = true;
      if (status === "active") filter.isBanned = false;

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const [users, total] = await Promise.all([
        User.find(filter)
          .select("-password -__v")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        User.countDocuments(filter),
      ]);

      // Fetch wallet info for the returned users to get exactly `withdrawalsBlocked`
      const userIds = users.map((u) => u._id);
      const wallets = await Wallet.find({ userId: { $in: userIds } })
        .select("userId withdrawalsBlocked withdrawalBlockedReason")
        .lean();

      const walletMap = {};
      wallets.forEach((w) => {
        walletMap[w.userId.toString()] = w;
      });

      const usersWithWallet = users.map((u) => ({
        ...u,
        wallet: walletMap[u._id.toString()] || {
          withdrawalsBlocked: false,
          withdrawalBlockedReason: null,
        },
      }));

      res.json({
        users: usersWithWallet,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (err) {
      console.error("Get users error:", err);
      res.status(500).json({ message: "Error fetching users" });
    }
  }
);

// Get single user profile
router.get(
  "/users/:userId",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const user = await User.findById(req.params.userId).select(
        "-password -__v"
      );
      if (!user) return res.status(404).json({ message: "User not found" });
      res.json({ user });
    } catch (err) {
      console.error("Get user error:", err);
      res.status(500).json({ message: "Error fetching user" });
    }
  }
);

// Block user
router.put(
  "/users/:userId/block",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const { reason, duration } = req.body; // duration in days, null = permanent
      const user = await User.findById(req.params.userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      user.isBanned = true;
      user.isbanDate = new Date();
      if (duration) {
        user.banExpiresAt = new Date(
          Date.now() + duration * 24 * 60 * 60 * 1000
        );
      } else {
        user.banExpiresAt = null; // permanent
      }
      await user.save();

      await logAdminActivity(req.user.userId, "USER_BLOCK", {
        targetType: "user",
        targetId: user._id,
        reason: reason || "No reason provided",
        metadata: { duration: duration || "permanent", username: user.username },
        ipAddress: getClientIp(req),
      });

      res.json({
        message: duration
          ? `User blocked for ${duration} days`
          : "User blocked permanently",
      });
    } catch (err) {
      console.error("Block user error:", err);
      res.status(500).json({ message: "Error blocking user" });
    }
  }
);

// Unblock user
router.put(
  "/users/:userId/unblock",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const user = await User.findById(req.params.userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      user.isBanned = false;
      user.isbanDate = null;
      user.banExpiresAt = null;
      await user.save();

      await logAdminActivity(req.user.userId, "USER_UNBLOCK", {
        targetType: "user",
        targetId: user._id,
        metadata: { username: user.username },
        ipAddress: getClientIp(req),
      });

      res.json({ message: "User unblocked successfully" });
    } catch (err) {
      console.error("Unblock user error:", err);
      res.status(500).json({ message: "Error unblocking user" });
    }
  }
);

// ============================================================================
// 3. PROJECT MANAGEMENT
// ============================================================================

// Get all projects (with pagination)
router.get(
  "/projects",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const { page = 1, limit = 20, status, search } = req.query;
      const filter = {};
      if (status) filter.status = status;
      if (search) {
        filter.title = { $regex: search, $options: "i" };
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const [projects, total] = await Promise.all([
        Project.find(filter)
          .populate("clientId", "username email")
          .populate("freelancerId", "username email")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        Project.countDocuments(filter),
      ]);

      res.json({
        projects,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (err) {
      console.error("Get projects error:", err);
      res.status(500).json({ message: "Error fetching projects" });
    }
  }
);

// Get project details
router.get(
  "/projects/:projectId",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const project = await Project.findById(req.params.projectId)
        .populate("clientId", "username email profilePictureUrl")
        .populate("freelancerId", "username email profilePictureUrl");
      if (!project)
        return res.status(404).json({ message: "Project not found" });

      // Also fetch related escrow
      const escrow = await Escrow.findOne({ projectId: project._id });

      res.json({ project, escrow });
    } catch (err) {
      console.error("Get project error:", err);
      res.status(500).json({ message: "Error fetching project" });
    }
  }
);

// Delete project (admin only)
router.delete(
  "/projects/:projectId",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const { reason } = req.body;
      const project = await Project.findById(req.params.projectId);
      if (!project)
        return res.status(404).json({ message: "Project not found" });

      await Project.findByIdAndDelete(req.params.projectId);

      await logAdminActivity(req.user.userId, "PROJECT_DELETE", {
        targetType: "project",
        targetId: project._id,
        reason: reason || "Admin deletion",
        metadata: { title: project.title, budget: project.budget },
        ipAddress: getClientIp(req),
      });

      res.json({ message: "Project deleted successfully" });
    } catch (err) {
      console.error("Delete project error:", err);
      res.status(500).json({ message: "Error deleting project" });
    }
  }
);

// --- Categories ---

router.get(
  "/categories",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const categories = await Category.find().sort({ name: 1 });
      res.json({ categories });
    } catch (err) {
      res.status(500).json({ message: "Error fetching categories" });
    }
  }
);

router.post(
  "/categories",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const { name, description } = req.body;
      if (!name)
        return res.status(400).json({ message: "Category name is required" });

      const exists = await Category.findOne({
        name: { $regex: `^${name}$`, $options: "i" },
      });
      if (exists)
        return res.status(409).json({ message: "Category already exists" });

      const category = await Category.create({
        name,
        description,
        createdBy: req.user.userId,
      });

      await logAdminActivity(req.user.userId, "CATEGORY_CREATE", {
        targetType: "category",
        targetId: category._id,
        ipAddress: getClientIp(req),
      });

      res.status(201).json({ category });
    } catch (err) {
      console.error("Create category error:", err);
      res.status(500).json({ message: "Error creating category" });
    }
  }
);

router.put(
  "/categories/:id",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const { name, description, isActive } = req.body;
      const category = await Category.findByIdAndUpdate(
        req.params.id,
        { name, description, isActive },
        { new: true, runValidators: true }
      );
      if (!category)
        return res.status(404).json({ message: "Category not found" });

      await logAdminActivity(req.user.userId, "CATEGORY_UPDATE", {
        targetType: "category",
        targetId: category._id,
        ipAddress: getClientIp(req),
      });

      res.json({ category });
    } catch (err) {
      console.error("Update category error:", err);
      res.status(500).json({ message: "Error updating category" });
    }
  }
);

router.delete(
  "/categories/:id",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const category = await Category.findByIdAndDelete(req.params.id);
      if (!category)
        return res.status(404).json({ message: "Category not found" });

      await logAdminActivity(req.user.userId, "CATEGORY_DELETE", {
        targetType: "category",
        targetId: category._id,
        ipAddress: getClientIp(req),
      });

      res.json({ message: "Category deleted" });
    } catch (err) {
      console.error("Delete category error:", err);
      res.status(500).json({ message: "Error deleting category" });
    }
  }
);

// ============================================================================
// 4. ESCROW MANAGEMENT
// ============================================================================

// Get all escrows
router.get(
  "/escrow",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const { page = 1, limit = 20, status } = req.query;
      const filter = {};
      if (status) filter.status = status;

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const [escrows, total] = await Promise.all([
        Escrow.find(filter)
          .populate("projectId", "title budget status")
          .populate("clientId", "username email")
          .populate("freelancerId", "username email")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        Escrow.countDocuments(filter),
      ]);

      res.json({
        escrows,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (err) {
      console.error("Get escrows error:", err);
      res.status(500).json({ message: "Error fetching escrows" });
    }
  }
);

// Get escrow by project
router.get(
  "/escrow/project/:projectId",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const escrow = await Escrow.findOne({ projectId: req.params.projectId })
        .populate("projectId", "title budget status")
        .populate("clientId", "username email")
        .populate("freelancerId", "username email");
      if (!escrow)
        return res.status(404).json({ message: "Escrow not found" });
      res.json({ escrow });
    } catch (err) {
      res.status(500).json({ message: "Error fetching escrow" });
    }
  }
);

// Edit escrow amount (only when funded/hold)
router.put(
  "/escrow/:escrowId/edit",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const { newAmount, reason } = req.body;
      if (!newAmount || newAmount <= 0)
        return res.status(400).json({ message: "Valid amount is required" });
      if (!reason)
        return res.status(400).json({ message: "Reason is required" });

      const escrow = await Escrow.findById(req.params.escrowId);
      if (!escrow)
        return res.status(404).json({ message: "Escrow not found" });
      if (escrow.status !== "funded")
        return res
          .status(400)
          .json({ message: "Can only edit amount for funded/held escrows" });

      const previousAmount = escrow.amount;
      escrow.adjustmentHistory.push({
        previousAmount,
        newAmount,
        refundAmount: 0,
        reason: `[ADMIN] ${reason}`,
        adjustedAt: new Date(),
      });
      escrow.amount = newAmount;
      escrow.adjustedAmount = newAmount;
      await escrow.save();

      await logAdminActivity(req.user.userId, "ESCROW_EDIT", {
        targetType: "escrow",
        targetId: escrow._id,
        reason,
        metadata: { previousAmount, newAmount },
        ipAddress: getClientIp(req),
      });

      res.json({ message: "Escrow amount updated", escrow });
    } catch (err) {
      console.error("Edit escrow error:", err);
      res.status(500).json({ message: "Error updating escrow" });
    }
  }
);

// Release escrow to freelancer
router.put(
  "/escrow/:escrowId/release",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const { reason } = req.body;
      const escrow = await Escrow.findById(req.params.escrowId);
      if (!escrow)
        return res.status(404).json({ message: "Escrow not found" });
      if (escrow.status !== "funded")
        return res
          .status(400)
          .json({ message: "Escrow is not in a releasable state" });

      escrow.status = "released";
      await escrow.save();

      // Create release transaction
      await Transaction.create({
        escrowId: escrow._id,
        type: "release",
        amount: escrow.amount,
        description: `[ADMIN RELEASE] ${reason || "Admin released escrow"}`,
        status: "completed",
      });

      await logAdminActivity(req.user.userId, "ESCROW_RELEASE", {
        targetType: "escrow",
        targetId: escrow._id,
        reason: reason || "Admin release",
        metadata: { amount: escrow.amount },
        ipAddress: getClientIp(req),
      });

      res.json({ message: "Escrow released to freelancer", escrow });
    } catch (err) {
      console.error("Release escrow error:", err);
      res.status(500).json({ message: "Error releasing escrow" });
    }
  }
);

// Refund escrow to client
router.put(
  "/escrow/:escrowId/refund",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const { reason } = req.body;
      const escrow = await Escrow.findById(req.params.escrowId);
      if (!escrow)
        return res.status(404).json({ message: "Escrow not found" });
      if (escrow.status !== "funded")
        return res
          .status(400)
          .json({ message: "Escrow is not in a refundable state" });

      escrow.status = "refunded";
      escrow.refundedAmount = escrow.amount;
      await escrow.save();

      // Create refund transaction
      await Transaction.create({
        escrowId: escrow._id,
        type: "refund",
        amount: escrow.amount,
        description: `[ADMIN REFUND] ${reason || "Admin refunded escrow"}`,
        status: "completed",
      });

      await logAdminActivity(req.user.userId, "ESCROW_REFUND", {
        targetType: "escrow",
        targetId: escrow._id,
        reason: reason || "Admin refund",
        metadata: { amount: escrow.amount },
        ipAddress: getClientIp(req),
      });

      res.json({ message: "Escrow refunded to client", escrow });
    } catch (err) {
      console.error("Refund escrow error:", err);
      res.status(500).json({ message: "Error refunding escrow" });
    }
  }
);

// Block escrow (dispute)
router.put(
  "/escrow/:escrowId/block",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const { reason } = req.body;
      if (!reason)
        return res.status(400).json({ message: "Reason is required to block" });

      const escrow = await Escrow.findById(req.params.escrowId);
      if (!escrow)
        return res.status(404).json({ message: "Escrow not found" });

      escrow.status = "adjusted"; // Using "adjusted" as blocked state
      escrow.adjustmentHistory.push({
        previousAmount: escrow.amount,
        newAmount: escrow.amount,
        refundAmount: 0,
        reason: `[BLOCKED BY ADMIN] ${reason}`,
        adjustedAt: new Date(),
      });
      await escrow.save();

      await logAdminActivity(req.user.userId, "ESCROW_BLOCK", {
        targetType: "escrow",
        targetId: escrow._id,
        reason,
        metadata: { amount: escrow.amount },
        ipAddress: getClientIp(req),
      });

      res.json({ message: "Escrow blocked due to dispute", escrow });
    } catch (err) {
      console.error("Block escrow error:", err);
      res.status(500).json({ message: "Error blocking escrow" });
    }
  }
);

// ============================================================================
// 4b. WALLET MANAGEMENT (ADMIN)
// ============================================================================

/**
 * GET /admin/users/:userId/wallet
 * View any user's global wallet + last 50 transactions (admin only)
 */
router.get(
  "/users/:userId/wallet",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const wallet = await Wallet.findOne({ userId }).populate("userId", "username email role");
      const transactions = await WalletTransaction.find({ userId })
        .sort({ createdAt: -1 })
        .limit(50)
        .select("type amount balanceAfter escrowBalanceAfter description status createdAt performedBy")
        .populate("performedBy", "username");

      res.json({
        wallet: wallet || { balance: 0, escrowBalance: 0 },
        transactions,
      });
    } catch (err) {
      console.error("Get user wallet error:", err);
      res.status(500).json({ message: "Error fetching wallet" });
    }
  }
);

/**
 * POST /admin/users/:userId/wallet/adjust
 * Admin manually credit (+) or debit (-) a user's wallet balance.
 * Body: { delta: Number (positive = credit, negative = debit), reason: String }
 */
router.post(
  "/users/:userId/wallet/adjust",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    const mongoose = require("mongoose");
    const session = await mongoose.startSession();
    try {
      const adminId = req.user.userId;
      const { userId } = req.params;
      const { delta, reason } = req.body;

      if (typeof delta !== "number" || delta === 0) {
        return res.status(400).json({ message: "delta must be a non-zero number" });
      }
      if (!reason || reason.trim().length < 5) {
        return res.status(400).json({ message: "reason is required (min 5 characters)" });
      }

      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      // Safety: block negative debit that would push balance below 0
      if (delta < 0) {
        const wallet = await Wallet.findOne({ userId });
        const available = wallet ? wallet.balance : 0;
        if (available + delta < 0) {
          return res.status(400).json({
            message: `Debit of ${Math.abs(delta)} would exceed available balance of ${available}`,
          });
        }
      }

      session.startTransaction();

      const updatedWallet = await walletHelper.adminAdjustWallet(
        userId,
        delta,
        adminId,
        `[ADMIN] ${reason.trim()}`,
        session
      );

      await session.commitTransaction();

      await logAdminActivity(adminId, "WALLET_ADJUST", {
        targetType: "user",
        targetId: userId,
        reason: reason.trim(),
        metadata: { delta, newBalance: updatedWallet.balance },
        ipAddress: getClientIp(req),
      });

      res.json({
        message: `Wallet ${delta > 0 ? "credited" : "debited"} by ₹${Math.abs(delta)}`,
        wallet: {
          balance: updatedWallet.balance,
          escrowBalance: updatedWallet.escrowBalance,
        },
      });
    } catch (err) {
      await session.abortTransaction();
      console.error("Wallet adjust error:", err);
      res.status(500).json({ message: "Error adjusting wallet", error: err.message });
    } finally {
      session.endSession();
    }
  }
);

// ============================================================================
// 5. COMMISSION & PLATFORM SETTINGS
// ============================================================================

router.get(
  "/settings/platform",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const settings = await SiteSettings.getSettings();
      res.json({
        platformCommissionPercent: settings.platformCommissionPercent,
        minimumProjectBudget: settings.minimumProjectBudget,
        maximumProjectBudget: settings.maximumProjectBudget,
      });
    } catch (err) {
      res.status(500).json({ message: "Error fetching platform settings" });
    }
  }
);

router.put(
  "/settings/platform",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const {
        platformCommissionPercent,
        minimumProjectBudget,
        maximumProjectBudget,
      } = req.body;
      const settings = await SiteSettings.getSettings();

      if (platformCommissionPercent !== undefined)
        settings.platformCommissionPercent = platformCommissionPercent;
      if (minimumProjectBudget !== undefined)
        settings.minimumProjectBudget = minimumProjectBudget;
      if (maximumProjectBudget !== undefined)
        settings.maximumProjectBudget = maximumProjectBudget;

      await settings.save();

      await logAdminActivity(req.user.userId, "SETTINGS_UPDATE", {
        targetType: "settings",
        metadata: { platformCommissionPercent, minimumProjectBudget, maximumProjectBudget },
        ipAddress: getClientIp(req),
      });

      res.json({ message: "Platform settings updated", settings });
    } catch (err) {
      console.error("Update platform settings error:", err);
      res.status(500).json({ message: "Error updating settings" });
    }
  }
);

// ============================================================================
// 6. SITE SETTINGS
// ============================================================================

router.get(
  "/settings/site",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const settings = await SiteSettings.getSettings();
      res.json({
        siteName: settings.siteName,
        logoUrl: settings.logoUrl,
        supportEmail: settings.supportEmail,
        maintenanceMode: settings.maintenanceMode,
        maintenanceMessage: settings.maintenanceMessage,
      });
    } catch (err) {
      res.status(500).json({ message: "Error fetching site settings" });
    }
  }
);

router.put(
  "/settings/site",
  verifyToken,
  authorize(["admin", "super_admin"]),
  upload.single("logo"),
  async (req, res) => {
    try {
      const { siteName, supportEmail, maintenanceMode, maintenanceMessage } =
        req.body;
      const settings = await SiteSettings.getSettings();

      if (siteName) settings.siteName = siteName;
      if (supportEmail) settings.supportEmail = supportEmail;
      if (maintenanceMode !== undefined)
        settings.maintenanceMode = maintenanceMode === "true" || maintenanceMode === true;
      if (maintenanceMessage) settings.maintenanceMessage = maintenanceMessage;

      // Handle logo upload
      if (req.file) {
        const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];
        await scanFile(req.file, allowedTypes, 2 * 1024 * 1024);
        const filename = `site-assets/logo-${Date.now()}.${req.file.mimetype.split("/")[1]}`;
        const url = await uploadFile(
          req.file,
          process.env.AWS_BUCKET_NAME,
          filename
        );
        settings.logoUrl = url;
      }

      await settings.save();

      await logAdminActivity(req.user.userId, "SETTINGS_UPDATE", {
        targetType: "settings",
        metadata: { siteName, supportEmail, maintenanceMode },
        ipAddress: getClientIp(req),
      });

      res.json({ message: "Site settings updated", settings });
    } catch (err) {
      console.error("Update site settings error:", err);
      res.status(500).json({ message: "Error updating site settings" });
    }
  }
);

// ============================================================================
// 7. CONTENT MANAGEMENT
// ============================================================================

router.get(
  "/content/:type",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const validTypes = ["about_us", "terms_and_conditions", "privacy_policy"];
      if (!validTypes.includes(req.params.type))
        return res.status(400).json({ message: "Invalid content type" });

      let content = await Content.findOne({ type: req.params.type });
      if (!content) {
        // Create default content
        content = await Content.create({
          type: req.params.type,
          title: req.params.type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
          body: "",
        });
      }
      res.json({ content });
    } catch (err) {
      res.status(500).json({ message: "Error fetching content" });
    }
  }
);

router.put(
  "/content/:type",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const validTypes = ["about_us", "terms_and_conditions", "privacy_policy"];
      if (!validTypes.includes(req.params.type))
        return res.status(400).json({ message: "Invalid content type" });

      const { title, body } = req.body;
      const content = await Content.findOneAndUpdate(
        { type: req.params.type },
        { title, body, lastUpdatedBy: req.user.userId },
        { new: true, upsert: true, runValidators: true }
      );

      await logAdminActivity(req.user.userId, "CONTENT_UPDATE", {
        targetType: "content",
        targetId: req.params.type,
        ipAddress: getClientIp(req),
      });

      res.json({ message: "Content updated", content });
    } catch (err) {
      console.error("Update content error:", err);
      res.status(500).json({ message: "Error updating content" });
    }
  }
);

// ============================================================================
// 8. REVIEW & RATING MODERATION
// ============================================================================

router.get(
  "/reviews",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const { page = 1, limit = 20 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const [reviews, total] = await Promise.all([
        Review.find()
          .populate("reviewerId", "username email")
          .populate("reviewedId", "username email")
          .populate("projectId", "title")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        Review.countDocuments(),
      ]);

      res.json({
        reviews,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (err) {
      console.error("Get reviews error:", err);
      res.status(500).json({ message: "Error fetching reviews" });
    }
  }
);

router.delete(
  "/reviews/:reviewId",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const { reason } = req.body;
      const review = await Review.findById(req.params.reviewId);
      if (!review)
        return res.status(404).json({ message: "Review not found" });

      await Review.findByIdAndDelete(req.params.reviewId);

      await logAdminActivity(req.user.userId, "REVIEW_DELETE", {
        targetType: "review",
        targetId: review._id,
        reason: reason || "Abusive content",
        metadata: { rating: review.rating, comments: review.comments },
        ipAddress: getClientIp(req),
      });

      res.json({ message: "Review deleted" });
    } catch (err) {
      console.error("Delete review error:", err);
      res.status(500).json({ message: "Error deleting review" });
    }
  }
);

// ============================================================================
// 9. REPORTS (Excel export endpoints)
// ============================================================================

// User list report
router.get(
  "/reports/users/excel",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const users = await User.find().select("-password -__v");
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Users");
      worksheet.columns = [
        { header: "Username", key: "username", width: 20 },
        { header: "Email", key: "email", width: 30 },
        { header: "Role", key: "role", width: 15 },
        { header: "Status", key: "status", width: 15 },
        { header: "Banned", key: "isBanned", width: 10 },
        { header: "Joined", key: "createdAt", width: 25 },
      ];
      users.forEach((u) => {
        worksheet.addRow({
          username: u.username,
          email: u.email,
          role: u.role,
          status: u.status,
          isBanned: u.isBanned ? "Yes" : "No",
          createdAt: new Date(u.createdAt).toLocaleString(),
        });
      });

      res.setHeader("Content-Disposition", "attachment; filename=users.xlsx");
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      await workbook.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error("User report error:", err);
      res.status(500).json({ message: "Error generating report" });
    }
  }
);

// Project list report
router.get(
  "/reports/projects/excel",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const projects = await Project.find()
        .populate("clientId", "username")
        .populate("freelancerId", "username");
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Projects");
      worksheet.columns = [
        { header: "Title", key: "title", width: 30 },
        { header: "Budget", key: "budget", width: 15 },
        { header: "Status", key: "status", width: 15 },
        { header: "Client", key: "client", width: 20 },
        { header: "Freelancer", key: "freelancer", width: 20 },
        { header: "Created", key: "createdAt", width: 25 },
      ];
      projects.forEach((p) => {
        worksheet.addRow({
          title: p.title,
          budget: p.budget,
          status: p.status,
          client: p.clientId?.username || "N/A",
          freelancer: p.freelancerId?.username || "N/A",
          createdAt: new Date(p.createdAt).toLocaleString(),
        });
      });

      res.setHeader("Content-Disposition", "attachment; filename=projects.xlsx");
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      await workbook.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error("Project report error:", err);
      res.status(500).json({ message: "Error generating report" });
    }
  }
);

// Transaction/escrow history report
router.get(
  "/reports/transactions/excel",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const transactions = await PaymentSchema.find().populate(
        "userId projectId",
        "username title budget"
      );
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Transactions");
      worksheet.columns = [
        { header: "Username", key: "username", width: 20 },
        { header: "Transaction ID", key: "transactionId", width: 25 },
        { header: "Project", key: "title", width: 25 },
        { header: "Budget", key: "budget", width: 15 },
        { header: "Amount", key: "amount", width: 15 },
        { header: "Method", key: "paymentMethod", width: 20 },
        { header: "Status", key: "status", width: 15 },
        { header: "Date", key: "createdAt", width: 25 },
      ];
      transactions.forEach((t) => {
        worksheet.addRow({
          username: t.userId?.username || "Unknown",
          transactionId: t.transactionId,
          title: t.projectId?.title || "N/A",
          budget: t.projectId?.budget || 0,
          amount: t.amount,
          paymentMethod: t.paymentMethod,
          status: t.status,
          createdAt: new Date(t.createdAt).toLocaleString(),
        });
      });

      res.setHeader(
        "Content-Disposition",
        "attachment; filename=transactions.xlsx"
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      await workbook.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error("Transaction report error:", err);
      res.status(500).json({ message: "Error generating report" });
    }
  }
);

// Payout report
router.get(
  "/reports/payouts/excel",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const transactions = await AdminWithdrawSchema.find().populate(
        "freelancerId",
        "username"
      );
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Payouts");
      worksheet.columns = [
        { header: "Freelancer ID", key: "freelancerId", width: 25 },
        { header: "Username", key: "username", width: 25 },
        { header: "Type", key: "type", width: 15 },
        { header: "Amount", key: "amount", width: 20 },
        { header: "Status", key: "status", width: 20 },
        { header: "Description", key: "description", width: 50 },
        { header: "Date", key: "createdAt", width: 25 },
        { header: "Account No.", key: "accountNumber", width: 20 },
        { header: "IFSC", key: "ifscCode", width: 25 },
      ];
      transactions.forEach((t) => {
        worksheet.addRow({
          freelancerId: t.freelancerId?._id,
          username: t.freelancerId?.username,
          type: t.type,
          amount: t.amount,
          status: t.status,
          description: t.description,
          createdAt: new Date(t.createdAt).toLocaleString(),
          accountNumber: t.bankDetails?.accountNumber,
          ifscCode: t.bankDetails?.ifscCode,
        });
      });

      res.setHeader(
        "Content-Disposition",
        "attachment; filename=payouts.xlsx"
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      await workbook.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error("Payout report error:", err);
      res.status(500).json({ message: "Error generating report" });
    }
  }
);

// ============================================================================
// 10. ADMIN ACTIVITY LOGS
// ============================================================================

router.get(
  "/activity-logs",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const { page = 1, limit = 50, action, adminId } = req.query;
      const filter = {};
      if (action) filter.action = action;
      if (adminId) filter.adminId = adminId;

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const [logs, total] = await Promise.all([
        AdminActivityLog.find(filter)
          .populate("adminId", "username email")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        AdminActivityLog.countDocuments(filter),
      ]);

      res.json({
        logs,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (err) {
      console.error("Activity logs error:", err);
      res.status(500).json({ message: "Error fetching activity logs" });
    }
  }
);

// ============================================================================
// 11. EXISTING FINANCE ROUTES (kept & cleaned)
// ============================================================================

// All transactions
router.get(
  "/all/transaction",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const all = await PaymentSchema.find().populate("userId", "username");
      res.status(200).json(all);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error fetching transactions" });
    }
  }
);

// Transaction by project
router.get(
  "/transaction/:projectId",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const all = await PaymentSchema.findOne({
        projectId: req.params.projectId,
      }).populate("userId projectId", "username title budget");
      res.status(200).json(all);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error fetching transaction" });
    }
  }
);

// All payout requests
router.get(
  "/pay-out/freelancers",
  verifyToken,
  authorize(["admin", "super_admin"]),
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

// Process payout
router.post(
  "/pay-out/freelancers/:freelancerId",
  verifyToken,
  authorize(["admin", "super_admin"]),
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

      payment.status = "approved";
      await payment.save();

      if (transaction) {
        transaction.status = "completed";
        await transaction.save();
      }

      res.json({ message: "Payout processed manually" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Payout processing failed" });
    }
  }
);

// Disputes
router.get(
  "/disputes",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const disputes = await DisputeSchema.find()
        .sort({ createdAt: -1 });
      res.status(200).json({ disputes });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error fetching disputes" });
    }
  }
);

// ============================================================================
// 10. WITHDRAWAL PAYOUT MANAGEMENT (ADMIN)
// ============================================================================

/**
 * GET /admin/withdrawals
 * List all pending withdrawal requests
 */
router.get(
  "/withdrawals",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const { status = "pending", page = 1, limit = 30 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const [requests, total] = await Promise.all([
        AdminWithdrawSchema.find({ status })
          .populate("freelancerId", "username email")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        AdminWithdrawSchema.countDocuments({ status }),
      ]);

      res.json({
        requests,
        pagination: {
          total,
          page: parseInt(page),
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (err) {
      console.error("Get withdrawals error:", err);
      res.status(500).json({ message: "Error fetching withdrawal requests" });
    }
  }
);

/**
 * POST /admin/withdrawals/:id/approve
 * Mark a pending withdrawal as approved (payment processed outside the system)
 */
router.post(
  "/withdrawals/:id/approve",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { note } = req.body;

      const withdrawal = await AdminWithdrawSchema.findById(id);
      if (!withdrawal) return res.status(404).json({ message: "Withdrawal not found" });
      if (withdrawal.status !== "pending")
        return res.status(409).json({ message: `Withdrawal is already ${withdrawal.status}` });

      withdrawal.status = "approved";
      if (note) withdrawal.description = `${withdrawal.description || ""} | Admin note: ${note}`;
      await withdrawal.save();

      // Mark the corresponding WalletTransaction as completed
      await WalletTransaction.findOneAndUpdate(
        {
          userId: withdrawal.freelancerId,
          type: "withdrawal",
          status: "pending",
          referenceId: withdrawal._id,
        },
        { status: "completed" }
      );

      await logAdminActivity(req.user.userId, "WITHDRAWAL_APPROVE", {
        targetType: "withdrawal",
        targetId: withdrawal._id,
        reason: note || "Admin approved",
        metadata: { amount: withdrawal.amount, freelancerId: withdrawal.freelancerId },
        ipAddress: getClientIp(req),
      });

      res.json({ message: "Withdrawal approved", withdrawal });
    } catch (err) {
      console.error("Approve withdrawal error:", err);
      res.status(500).json({ message: "Error approving withdrawal" });
    }
  }
);

/**
 * POST /admin/withdrawals/:id/reject
 * Reject a pending withdrawal AND atomically reverse the wallet debit.
 * The freelancer's balance is credited back; a withdrawal_reversal WalletTransaction is created.
 */
router.post(
  "/withdrawals/:id/reject",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    const mongoose = require("mongoose");
    const session = await mongoose.startSession();
    try {
      const { id } = req.params;
      const { reason } = req.body;

      if (!reason || reason.trim().length < 5) {
        return res.status(400).json({ message: "Rejection reason is required (min 5 characters)" });
      }

      const withdrawal = await AdminWithdrawSchema.findById(id);
      if (!withdrawal) return res.status(404).json({ message: "Withdrawal not found" });
      if (withdrawal.status !== "pending") {
        return res.status(409).json({ message: `Cannot reject: withdrawal is already ${withdrawal.status}` });
      }

      session.startTransaction();

      // Mark withdrawal as rejected
      withdrawal.status = "rejected";
      withdrawal.description = `${withdrawal.description || ""} | Rejected: ${reason.trim()}`;
      await withdrawal.save({ session });

      // ── REVERSE the wallet debit atomically ──
      await walletHelper.reverseWithdrawal(
        withdrawal.freelancerId,
        withdrawal.amount,
        withdrawal._id,
        session
      );

      await session.commitTransaction();

      await logAdminActivity(req.user.userId, "WITHDRAWAL_REJECT", {
        targetType: "withdrawal",
        targetId: withdrawal._id,
        reason: reason.trim(),
        metadata: { amount: withdrawal.amount, freelancerId: withdrawal.freelancerId },
        ipAddress: getClientIp(req),
      });

      res.json({
        message: `Withdrawal of ₹${withdrawal.amount} rejected. Funds returned to freelancer's wallet.`,
        withdrawal,
      });
    } catch (err) {
      await session.abortTransaction();
      console.error("Reject withdrawal error:", err);
      res.status(500).json({ message: "Error rejecting withdrawal", error: err.message });
    } finally {
      session.endSession();
    }
  }
);

// ============================================================================
// 11. WALLET FREEZE CONTROLS (ADMIN)
// ============================================================================

/**
 * POST /admin/users/:userId/wallet/freeze
 * Block a user from making any withdraw debits.
 * Body: { reason: String }
 */
router.post(
  "/users/:userId/wallet/freeze",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { reason } = req.body;
      const adminId = req.user.userId;

      if (!reason || reason.trim().length < 5) {
        return res.status(400).json({ message: "Freeze reason is required (min 5 characters)" });
      }

      const wallet = await Wallet.findOneAndUpdate(
        { userId },
        {
          withdrawalsBlocked: true,
          withdrawalBlockedReason: reason.trim(),
          withdrawalBlockedAt: new Date(),
          withdrawalBlockedBy: adminId,
        },
        { new: true, upsert: true }
      );

      await logAdminActivity(adminId, "WALLET_FREEZE", {
        targetType: "user",
        targetId: userId,
        reason: reason.trim(),
        ipAddress: getClientIp(req),
      });

      res.json({
        message: "Withdrawals have been frozen for this user.",
        wallet: {
          userId: wallet.userId,
          withdrawalsBlocked: wallet.withdrawalsBlocked,
          withdrawalBlockedReason: wallet.withdrawalBlockedReason,
          withdrawalBlockedAt: wallet.withdrawalBlockedAt,
        },
      });
    } catch (err) {
      console.error("Freeze wallet error:", err);
      res.status(500).json({ message: "Error freezing wallet" });
    }
  }
);

/**
 * POST /admin/users/:userId/wallet/unfreeze
 * Unblock a previously frozen user's withdrawals.
 */
router.post(
  "/users/:userId/wallet/unfreeze",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const adminId = req.user.userId;

      const wallet = await Wallet.findOneAndUpdate(
        { userId },
        {
          withdrawalsBlocked: false,
          withdrawalBlockedReason: null,
          withdrawalBlockedAt: null,
          withdrawalBlockedBy: null,
        },
        { new: true }
      );

      if (!wallet) return res.status(404).json({ message: "Wallet not found for this user" });

      await logAdminActivity(adminId, "WALLET_UNFREEZE", {
        targetType: "user",
        targetId: userId,
        ipAddress: getClientIp(req),
      });

      res.json({ message: "Withdrawals have been unfrozen for this user." });
    } catch (err) {
      console.error("Unfreeze wallet error:", err);
      res.status(500).json({ message: "Error unfreezing wallet" });
    }
  }
);
// ============================================================================
// 12. PAYMENT CLAWBACK (ADMIN ONLY)
// ============================================================================

/**
 * POST /admin/projects/:projectId/clawback
 * Reverse a released payment: debit the freelancer and credit the client.
 * Use when a frozen freelancer received payment that must be recovered.
 *
 * Body:
 *   amount  (Number, required) – amount to claw back in ₹
 *   reason  (String, required) – audit reason, min 10 chars
 */
router.post(
  "/projects/:projectId/clawback",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    const session = await mongoose.startSession();
    try {
      const adminId = req.user.userId;
      const { projectId } = req.params;
      const { amount, reason } = req.body;

      if (!amount || typeof amount !== "number" || amount <= 0) {
        return res.status(400).json({ message: "A positive numeric amount is required" });
      }
      if (!reason || reason.trim().length < 10) {
        return res.status(400).json({ message: "Reason is required (min 10 characters)" });
      }
      if (!mongoose.Types.ObjectId.isValid(projectId)) {
        return res.status(400).json({ message: "Invalid project ID" });
      }

      const project = await Project.findById(projectId)
        .populate("clientId", "username")
        .populate("freelancerId", "username");

      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      if (!project.freelancerId) {
        return res.status(400).json({ message: "No freelancer assigned to this project" });
      }

      session.startTransaction();

      const { freelancerWallet, clientWallet } = await walletHelper.adminClawback(
        project.freelancerId._id,
        project.clientId._id,
        amount,
        project._id,
        adminId,
        `Admin clawback – ${reason.trim()}`,
        session
      );

      await logAdminActivity(adminId, "PAYMENT_CLAWBACK", {
        targetType: "project",
        targetId: projectId,
        amount,
        reason: reason.trim(),
        freelancerId: project.freelancerId._id,
        clientId: project.clientId._id,
        ipAddress: getClientIp(req),
      });

      await session.commitTransaction();

      res.json({
        message: `₹${amount} clawed back from ${project.freelancerId.username} and returned to ${project.clientId.username}.`,
        freelancerNewBalance: freelancerWallet.balance,
        clientNewBalance: clientWallet.balance,
      });
    } catch (err) {
      await session.abortTransaction();
      console.error("Clawback error:", err);
      res.status(400).json({ message: err.message || "Error processing clawback" });
    } finally {
      session.endSession();
    }
  }
);

module.exports = router;
