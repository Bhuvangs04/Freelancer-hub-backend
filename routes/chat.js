const express = require("express");
const crypto = require("crypto");
const WebSocket = require("ws");
const Chat = require("../models/chat_sys");
const User = require("../models/User");
const { verifyToken } = require("../middleware/Auth");

const router = express.Router();
const secretKey = Buffer.from(process.env.ENCRYPTION_KEY, "hex");
const activeUsers = new Map();

// Sensitive info middleware
const checkSensitiveInfo = async (req, res, next) => {
  const { message, sender } = req.body;
  const sensitivePattern = "{Message is against our policy}";

  if (message?.includes(sensitivePattern)) {
    const user = await User.findByIdAndUpdate(
      sender,
      { $inc: { Strikes: 1 } },
      { new: true }
    );

    if (user.Strikes >= 3) {
      await User.findByIdAndUpdate(sender, { isBanned: true });
      return res.status(403).json({ message: "User is banned" });
    }

    return res.status(400).json({
      message: "Sensitive information detected. Strike added",
    });
  }
  next();
};

// Ban check middleware
const checkBan = async (req, res, next) => {
  const { sender } = req.body;
  const user = await User.findById(sender);
  if (user?.isBanned) {
    return res.status(403).json({ message: "User is banned" });
  }
  next();
};

// Encryption utilities
const encryptMessage = (message, key) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(message, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${encrypted.toString("hex")}:${authTag.toString(
    "hex"
  )}`;
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

// Get users endpoint
router.get("/users", verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const users = await User.find({ _id: { $ne: userId } })
      .select("_id username profilePictureUrl")
      .lean();

    const chatUsers = await Promise.all(
      users.map(async (user) => {
        const [lastMessage, unreadCount] = await Promise.all([
          Chat.findOne({
            $or: [
              { sender: userId, receiver: user._id },
              { sender: user._id, receiver: userId },
            ],
          })
            .sort({ timestamp: -1 })
            .lean(),
          Chat.countDocuments({
            sender: user._id,
            receiver: userId,
            status: "delivered",
          }),
        ]);

        return {
          _id: user._id,
          username: user.username,
          profilePictureUrl: user.profilePictureUrl,
          status: activeUsers.has(user._id.toString()) ? "online" : "offline",
          lastMessage: lastMessage
            ? decryptMessage(lastMessage.message, secretKey)
            : "",
          unreadCount,
        };
      })
    );

    res.status(200).json({ users: chatUsers });
  } catch (error) {
    console.error("Error fetching chat users:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Send message endpoint
router.post(
  "/send",
  verifyToken,
  checkSensitiveInfo,
  checkBan,
  async (req, res) => {
    try {
      const { sender, receiver, message } = req.body;
      const encryptedMessage = encryptMessage(message, secretKey);

      const chat = new Chat({
        sender,
        receiver,
        message: encryptedMessage,
        encrypted: true,
        status: "sent",
      });
      await chat.save();

      const recipientSocket = activeUsers.get(receiver);
      if (recipientSocket) {
        recipientSocket.send(
          JSON.stringify({
            sender,
            receiver,
            message: encryptedMessage,
            status: "delivered",
          })
        );
        chat.status = "delivered";
        await chat.save();
      }

      res.status(200).json({ message: "Message sent successfully" });
    } catch (error) {
      console.error("Error sending message:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Get messages endpoint
router.get("/messages", verifyToken, async (req, res) => {
  try {
    const { sender, receiver } = req.query;
    const chats = await Chat.find({
      $or: [
        { sender, receiver },
        { sender: receiver, receiver: sender },
      ],
    })
      .sort({ timestamp: -1 })
      .limit(50)
      .lean();

    const decryptedChats = chats.map((chat) => ({
      _id: chat._id,
      sender: chat.sender,
      receiver: chat.receiver,
      message: decryptMessage(chat.message, secretKey),
      status: chat.status,
      timestamp: chat.timestamp,
    }));

    await Chat.updateMany(
      { receiver: sender, sender: receiver, status: "delivered" },
      { status: "read" }
    );

    res.status(200).json(decryptedChats);
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// WebSocket setup
const wss = new WebSocket.Server({ port: 9000 });

wss.on("connection", (ws, req) => {
  const userId = req.url?.split("/").pop();
  if (!userId) {
    ws.close();
    return;
  }

  activeUsers.set(userId, ws);

  ws.on("message", async (data) => {
    try {
      console.log("Raw WebSocket message:", data);
      const messageString = data.toString();

      const parsedData = JSON.parse(messageString);

      const { sender, receiver, message, alreadyStored, type } =
        JSON.parse(data);

      if (type === "typing") {
        const recipientSocket = activeUsers.get(receiver);
        if (recipientSocket) {
          recipientSocket.send(JSON.stringify({ sender, type: "typing" }));
        }
        return;
      }

      const webRTCTypes = [
        "connection-request",
        "connection-accepted",
        "connection-rejected",
        "candidate",
        "answer",
        "offer",
      ];

      if (webRTCTypes.includes(type)) {
        console.log(`Received ${type} message:`, parsedData);
        const recipientSocket = activeUsers.get(receiver);
        if (recipientSocket) {
          recipientSocket.send(JSON.stringify(parsedData));
          console.log(`${type} message sent to ${receiver}`);
        } else {
          console.error(`No active WebSocket found for receiver: ${receiver}`);
        }
        return;
      }

      const encryptedMessage = encryptMessage(message, secretKey);
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

      const recipientSocket = activeUsers.get(receiver);
      if (recipientSocket) {
        recipientSocket.send(
          JSON.stringify({
            sender,
            receiver,
            message: encryptedMessage,
            status: "delivered",
          })
        );
        if (chat) {
          chat.status = "delivered";
          await chat.save();
        }
      }
    } catch (error) {
      console.error("Error processing WebSocket message:", error);
    }
  });

  ws.on("close", () => {
    activeUsers.delete(userId);
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
    activeUsers.delete(userId);
  });
});

module.exports = router;
