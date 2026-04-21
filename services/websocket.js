const WebSocket = require("ws");
const crypto = require("crypto");
const Chat = require("../models/chat_sys");
const User = require("../models/User");
const Project = require("../models/Project");
const Wallet = require("../models/Wallet");
const AdminAlert = require("../models/AdminAlert");
const { scanMessage } = require("../utils/violationDetector");

// ============================================================================
// WEBSOCKET SERVICE
// ============================================================================

class WebSocketService {
  constructor(server) {
    this.wss = new WebSocket.Server({ server });
    this.activeUsers = new Map();
    this.secretKey = this.getSecretKey();

    this.init();
  }

  /**
   * Get encryption key from environment
   */
  getSecretKey() {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) {
      console.error("CRITICAL: ENCRYPTION_KEY not set!");
      if (process.env.NODE_ENV === "production") {
        throw new Error("ENCRYPTION_KEY must be set in production");
      }
    }
    // Derive a valid 32-byte AES-256 key via SHA-256
    return crypto
      .createHash("sha256")
      .update(String(key || "default-dev-key"))
      .digest();
  }

  /**
   * Encrypt message using AES-256-GCM
   */
  encryptMessage(message) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.secretKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(message, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${encrypted.toString("hex")}:${authTag.toString("hex")}`;
  }

  /**
   * Decrypt message using AES-256-GCM
   */
  decryptMessage(encryptedMessage) {
    try {
      const [ivHex, encryptedText, authTagHex] = encryptedMessage.split(":");
      if (!ivHex || !encryptedText || !authTagHex) {
        throw new Error("Invalid encrypted message format");
      }
      const iv = Buffer.from(ivHex, "hex");
      const encrypted = Buffer.from(encryptedText, "hex");
      const authTag = Buffer.from(authTagHex, "hex");
      const decipher = crypto.createDecipheriv("aes-256-gcm", this.secretKey, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]).toString("utf8");
    } catch (error) {
      console.error("Decryption failed:", error.message);
      return null;
    }
  }

  /**
   * Initialize WebSocket handlers
   */
  init() {
    this.wss.on("connection", (ws, req) => {
      const userId = this.extractUserId(req);
      if (!userId) {
        ws.close(1008, "User ID required");
        return;
      }

      this.activeUsers.set(userId, ws);
      console.log(`[WEBSOCKET] Client connected: ${userId}`);

      ws.on("message", (data) => this.handleMessage(data, userId));

      ws.on("close", () => {
        this.activeUsers.delete(userId);
        console.log(`[WEBSOCKET] Client disconnected: ${userId}`);
      });

      ws.on("error", (error) => {
        console.error(`[WEBSOCKET] Error for ${userId}:`, error);
        this.activeUsers.delete(userId);
      });
    });
  }

  /**
   * Extract user ID from WebSocket request URL
   */
  extractUserId(req) {
    return req.url?.split("/").pop() || null;
  }

  /**
   * Verify project access for a user
   */
  async verifyProjectAccess(userId, projectId) {
    try {
      const project = await Project.findById(projectId);
      if (!project || project.status !== "in_progress") return false;

      const isClient = project.clientId.toString() === userId;
      const isFreelancer =
        project.freelancerId && project.freelancerId.toString() === userId;

      return isClient || isFreelancer;
    } catch {
      return false;
    }
  }

  /**
   * Check if user is allowed to chat (not banned/frozen)
   */
  async checkUserPermission(userId) {
    try {
      const user = await User.findById(userId);
      if (!user || user.isBanned) return false;
      if (user.status === "UNDER_REVIEW" || user.status === "BANNED") return false;

      const wallet = await Wallet.findOne({ userId });
      if (wallet && (wallet.status === "FROZEN" || wallet.status === "LOCKED")) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Process a violation: increment score, create alerts, freeze wallet
   */
  async processViolation(userId, projectId, messageId, scanResult) {
    try {
      const user = await User.findByIdAndUpdate(
        userId,
        { $inc: { violationScore: scanResult.score, Strikes: 1 } },
        { new: true }
      );

      if (user.violationScore >= 5) {
        await Wallet.findOneAndUpdate(
          { userId },
          {
            status: "FROZEN",
            freezeReason: `Auto-frozen: violation score ${user.violationScore}`,
            frozenAt: new Date(),
            withdrawalsBlocked: true,
            withdrawalBlockedReason: "Wallet frozen due to policy violations",
            withdrawalBlockedAt: new Date(),
          }
        );
        await User.findByIdAndUpdate(userId, { status: "UNDER_REVIEW" });
        await AdminAlert.create({
          userId,
          projectId,
          reason: scanResult.reasons.join("; "),
          violationScore: user.violationScore,
          evidenceMessages: [messageId],
          status: "pending",
        });

        // Notify the sender their account is restricted
        this.sendToUser(userId, {
          type: "account_restricted",
          message: "Your account has been restricted due to policy violations.",
        });
      } else if (user.violationScore >= 3) {
        await AdminAlert.create({
          userId,
          projectId,
          reason: `Warning: ${scanResult.reasons.join("; ")}`,
          violationScore: user.violationScore,
          evidenceMessages: [messageId],
          status: "pending",
        });
      }
    } catch (error) {
      console.error("[WEBSOCKET] Error processing violation:", error);
    }
  }

  /**
   * Handle incoming WebSocket message
   */
  async handleMessage(data, senderId) {
    try {
      const messageString = data.toString();
      const parsedData = JSON.parse(messageString);
      const { sender, receiver, message, projectId, alreadyStored, type } = parsedData;

      // Handle typing indicator
      if (type === "typing") {
        this.sendToUser(receiver, { sender, type: "typing", projectId });
        return;
      }

      // Validate projectId for chat messages
      if (!projectId) {
        this.sendToUser(senderId, {
          type: "error",
          message: "projectId is required for chat messages",
        });
        return;
      }

      // Check user permission
      const hasPermission = await this.checkUserPermission(senderId);
      if (!hasPermission) {
        this.sendToUser(senderId, {
          type: "error",
          message: "Your account is restricted. Chat access is disabled.",
        });
        return;
      }

      // Check project access
      const hasAccess = await this.verifyProjectAccess(senderId, projectId);
      if (!hasAccess) {
        this.sendToUser(senderId, {
          type: "error",
          message: "You do not have access to this project chat.",
        });
        return;
      }

      // Run violation detection on plaintext
      const scanResult = scanMessage(message);

      // Encrypt and store
      const encryptedMessage = this.encryptMessage(message);
      let chat;

      if (!alreadyStored) {
        chat = new Chat({
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
      }

      // Process violation if flagged
      if (scanResult.flagged && chat) {
        await this.processViolation(senderId, projectId, chat._id, scanResult);

        // Warn the sender
        this.sendToUser(senderId, {
          type: "violation_warning",
          message: "Your message has been flagged for potential policy violation.",
        });
      }

      // Send to recipient if online
      const delivered = this.sendToUser(receiver, {
        sender,
        receiver,
        projectId,
        message: encryptedMessage,
        status: "delivered",
        flagged: scanResult.flagged,
      });

      if (delivered && chat) {
        chat.status = "delivered";
        await chat.save();
      }
    } catch (error) {
      console.error("[WEBSOCKET] Error processing message:", error);
    }
  }

  /**
   * Send message to specific user
   */
  sendToUser(userId, data) {
    const socket = this.activeUsers.get(userId);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  /**
   * Broadcast message to all connected users
   */
  broadcast(data, excludeUserId = null) {
    for (const [userId, socket] of this.activeUsers) {
      if (userId !== excludeUserId && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(data));
      }
    }
  }

  /**
   * Get count of active users
   */
  getActiveUserCount() {
    return this.activeUsers.size;
  }

  /**
   * Check if user is online
   */
  isUserOnline(userId) {
    return this.activeUsers.has(userId);
  }
}

module.exports = WebSocketService;
