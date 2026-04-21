const express = require("express");
const crypto = require("crypto");
const Chat = require("../models/chat_sys");
const User = require("../models/User");
const Project = require("../models/Project");
const Wallet = require("../models/Wallet");
const AdminAlert = require("../models/AdminAlert");
const { verifyToken } = require("../middleware/Auth");
const { scanMessage } = require("../utils/violationDetector");

const router = express.Router();

// Derive a valid 32-byte AES-256 key from the env var (handles any length)
const secretKey = crypto
  .createHash("sha256")
  .update(String(process.env.ENCRYPTION_KEY || ""))
  .digest();

// ============================================================================
// ENCRYPTION UTILITIES
// ============================================================================

const encryptMessage = (message, key) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(message, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${encrypted.toString("hex")}:${authTag.toString("hex")}`;
};

const decryptMessage = (encryptedMessage, key) => {
  try {
    const [ivHex, encryptedText, authTagHex] = encryptedMessage.split(":");
    if (!ivHex || !encryptedText || !authTagHex) {
      throw new Error("Invalid encrypted message format");
    }
    const iv = Buffer.from(ivHex, "hex");
    const encrypted = Buffer.from(encryptedText, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    console.error("Decryption failed:", error.message);
    return "Decryption error";
  }
};

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Verify user has access to chat in a given project.
 * Project must be in_progress and user must be client or assigned freelancer.
 */
const checkProjectAccess = async (req, res, next) => {
  try {
    const projectId = req.body.projectId || req.query.projectId;
    const userId = req.user.userId;

    if (!projectId) {
      return res.status(400).json({ message: "projectId is required" });
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    if (project.status !== "in_progress") {
      return res.status(403).json({
        message: "Chat is only available for assigned (in-progress) projects",
      });
    }

    const isClient = project.clientId.toString() === userId;
    const isFreelancer =
      project.freelancerId && project.freelancerId.toString() === userId;

    if (!isClient && !isFreelancer) {
      return res.status(403).json({
        message: "You are not a participant of this project",
      });
    }

    req.project = project;
    next();
  } catch (error) {
    console.error("Project access check error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Chat permission check: user must not be banned and wallet must not be frozen.
 */
const checkChatPermission = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.isBanned) {
      return res.status(403).json({ message: "Your account is banned. Chat access is disabled." });
    }

    if (user.status === "UNDER_REVIEW" || user.status === "BANNED") {
      return res.status(403).json({
        message: "Your account is under review. Chat access is temporarily disabled.",
      });
    }

    const wallet = await Wallet.findOne({ userId });
    if (wallet && wallet.status === "FROZEN") {
      return res.status(403).json({
        message: "Your wallet is frozen due to policy violations. Chat access is disabled.",
      });
    }

    if (wallet && wallet.status === "LOCKED") {
      return res.status(403).json({
        message: "Your account has been permanently restricted.",
      });
    }

    req.chatUser = user;
    next();
  } catch (error) {
    console.error("Chat permission check error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// ============================================================================
// VIOLATION PROCESSING
// ============================================================================

/**
 * Process violation detection result:
 * - Increment user's violation score
 * - Create AdminAlert if score >= 5
 * - Freeze wallet if score >= 5
 */
const processViolation = async (userId, projectId, messageId, scanResult) => {
  try {
    const user = await User.findByIdAndUpdate(
      userId,
      {
        $inc: { violationScore: scanResult.score, Strikes: 1 },
      },
      { new: true }
    );

    // Check if threshold reached
    if (user.violationScore >= 5) {
      // Freeze wallet
      await Wallet.findOneAndUpdate(
        { userId },
        {
          status: "FROZEN",
          freezeReason: `Auto-frozen: violation score ${user.violationScore} (threshold: 5)`,
          frozenAt: new Date(),
          withdrawalsBlocked: true,
          withdrawalBlockedReason: "Wallet frozen due to policy violations",
          withdrawalBlockedAt: new Date(),
        }
      );

      // Update user status
      await User.findByIdAndUpdate(userId, { status: "UNDER_REVIEW" });

      // Create admin alert
      await AdminAlert.create({
        userId,
        projectId,
        reason: scanResult.reasons.join("; "),
        violationScore: user.violationScore,
        evidenceMessages: [messageId],
        status: "pending",
      });

      console.log(
        `[VIOLATION] User ${userId} frozen. Score: ${user.violationScore}`
      );
    } else if (user.violationScore >= 3) {
      // Create warning alert (but don't freeze yet)
      await AdminAlert.create({
        userId,
        projectId,
        reason: `Warning: ${scanResult.reasons.join("; ")}`,
        violationScore: user.violationScore,
        evidenceMessages: [messageId],
        status: "pending",
      });
    }

    return user;
  } catch (error) {
    console.error("Error processing violation:", error);
  }
};

// ============================================================================
// ROUTES
// ============================================================================

/**
 * GET /chat/projects
 * List projects the user can chat in (status = in_progress, user is participant)
 */
router.get("/projects", verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const projects = await Project.find({
      status: "in_progress",
      $or: [{ clientId: userId }, { freelancerId: userId }],
    })
      .populate("clientId", "_id username profilePictureUrl")
      .populate("freelancerId", "_id username profilePictureUrl")
      .select("title status clientId freelancerId")
      .lean();

    // For each project, get last message and unread count
    const projectChats = await Promise.all(
      projects.map(async (project) => {
        const chatPartner =
          project.clientId._id.toString() === userId
            ? project.freelancerId
            : project.clientId;

        const [lastMessage, unreadCount] = await Promise.all([
          Chat.findOne({ projectId: project._id })
            .sort({ timestamp: -1 })
            .lean(),
          Chat.countDocuments({
            projectId: project._id,
            receiver: userId,
            status: { $in: ["sent", "delivered"] },
          }),
        ]);

        return {
          projectId: project._id,
          projectTitle: project.title,
          chatPartner: {
            _id: chatPartner._id,
            username: chatPartner.username,
            profilePictureUrl: chatPartner.profilePictureUrl,
          },
          lastMessage: lastMessage
            ? decryptMessage(lastMessage.message, secretKey)
            : "",
          lastMessageAt: lastMessage ? lastMessage.timestamp : null,
          unreadCount,
        };
      })
    );

    // Sort by most recent message
    projectChats.sort((a, b) => {
      if (!a.lastMessageAt && !b.lastMessageAt) return 0;
      if (!a.lastMessageAt) return 1;
      if (!b.lastMessageAt) return -1;
      return new Date(b.lastMessageAt) - new Date(a.lastMessageAt);
    });

    res.status(200).json({ projects: projectChats });
  } catch (error) {
    console.error("Error fetching chat projects:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /chat/send
 * Send a message within a project conversation.
 * Runs violation detection before storing.
 */
router.post(
  "/send",
  verifyToken,
  checkChatPermission,
  checkProjectAccess,
  async (req, res) => {
    try {
      const { receiver, message, projectId } = req.body;
      const sender = req.user.userId;

      if (!receiver || !message || !message.trim()) {
        return res
          .status(400)
          .json({ message: "receiver and message are required" });
      }

      // Verify receiver is the other project participant
      const project = req.project;
      const isValidReceiver =
        (project.clientId.toString() === receiver &&
          project.freelancerId.toString() === sender) ||
        (project.freelancerId.toString() === receiver &&
          project.clientId.toString() === sender);

      if (!isValidReceiver) {
        return res.status(403).json({
          message: "You can only message the other project participant",
        });
      }

      // Run violation detection on plaintext
      const scanResult = scanMessage(message.trim());

      // Encrypt and store
      const encryptedMessage = encryptMessage(message.trim(), secretKey);

      const chat = new Chat({
        sender,
        receiver,
        projectId,
        message: encryptedMessage,
        encrypted: true,
        status: "sent",
        flagged: scanResult.flagged,
        flagReason: scanResult.flagged ? scanResult.reasons.join("; ") : null,
      });
      await chat.save();

      // Process violation if flagged
      let violationWarning = null;
      if (scanResult.flagged) {
        await processViolation(sender, projectId, chat._id, scanResult);
        violationWarning =
          "Your message has been flagged for potential policy violation. Repeated violations may result in account restrictions.";
      }

      // Deliver to recipient via WebSocket (real-time)
      const wsService = req.app.locals.wsService;
      if (wsService) {
        const delivered = wsService.sendToUser(receiver, {
          sender,
          receiver,
          projectId,
          message: encryptedMessage,
          status: "delivered",
          flagged: scanResult.flagged,
          timestamp: chat.timestamp,
        });

        if (delivered) {
          chat.status = "delivered";
          await chat.save();
        }
      }

      res.status(200).json({
        message: "Message sent successfully",
        flagged: scanResult.flagged,
        violationWarning,
      });
    } catch (error) {
      console.error("Error sending message:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * GET /chat/messages
 * Get messages for a project conversation.
 */
router.get(
  "/messages",
  verifyToken,
  checkChatPermission,
  checkProjectAccess,
  async (req, res) => {
    try {
      const { projectId } = req.query;
      const userId = req.user.userId;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 50;
      const skip = (page - 1) * limit;

      const chats = await Chat.find({ projectId })
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      const decryptedChats = chats.map((chat) => ({
        _id: chat._id,
        sender: chat.sender,
        receiver: chat.receiver,
        projectId: chat.projectId,
        message: decryptMessage(chat.message, secretKey),
        status: chat.status,
        flagged: chat.flagged,
        timestamp: chat.timestamp,
      }));

      // Mark messages as read
      await Chat.updateMany(
        {
          projectId,
          receiver: userId,
          status: { $in: ["sent", "delivered"] },
        },
        { status: "read" }
      );

      res.status(200).json(decryptedChats);
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

module.exports = router;
