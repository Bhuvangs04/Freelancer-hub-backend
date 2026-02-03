const WebSocket = require("ws");
const crypto = require("crypto");
const Chat = require("../models/chat_sys");

// ============================================================================
// WEBSOCKET SERVICE
// Extracted from index.js for better modularity
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
      // Development fallback (32 bytes for AES-256)
      return Buffer.from("0123456789abcdef0123456789abcdef", "hex");
    }
    return Buffer.from(key, "hex");
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
   * Handle incoming WebSocket message
   */
  async handleMessage(data, senderId) {
    try {
      const messageString = data.toString();
      const parsedData = JSON.parse(messageString);
      const { sender, receiver, message, alreadyStored, type } = parsedData;

      // Handle typing indicator
      if (type === "typing") {
        this.sendToUser(receiver, { sender, type: "typing" });
        return;
      }

      // Handle WebRTC signaling
      const webRTCTypes = [
        "connection-request",
        "connection-accepted",
        "connection-rejected",
        "candidate",
        "answer",
        "offer",
      ];
      
      if (webRTCTypes.includes(type)) {
        console.log(`[WEBSOCKET] Received ${type} message`);
        this.sendToUser(receiver, parsedData);
        return;
      }

      // Handle chat message
      const encryptedMessage = this.encryptMessage(message);
      let chat;

      if (!alreadyStored) {
        chat = new Chat({
          sender,
          receiver,
          message: encryptedMessage,
          encrypted: true,
          status: "sent",
        });
        await chat.save();
      }

      // Send to recipient if online
      const delivered = this.sendToUser(receiver, {
        sender,
        receiver,
        message: encryptedMessage,
        status: "delivered",
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
