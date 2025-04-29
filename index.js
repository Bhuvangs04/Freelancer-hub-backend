const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app); 
const cookieParser = require("cookie-parser");
const cors = require("cors");
const { mongoose } = require("./config/database");
const helmet = require("helmet");
const loginRoute = require("./routes/Login");
const signupRoute = require("./routes/Sign-up");
const uploadRoute = require("./routes/bucketSending");
const freelancer = require("./routes/freelancer");
const chats = require("./routes/chat");
const workSubmission = require("./routes/WorkSubmission");
// const auditLogs = require("./middleware/AuditLogs");  no need for this
const client = require("./routes/client");
const payment = require("./routes/payment");
const admin = require("./routes/admin");
const security = require("./routes/Security");
 const User = require("./models/User");
 const crypto = require("crypto");
const PORT = process.env.PORT || 3000;
app.set("trust proxy", true);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(cookieParser());
const allowedOrigins = [
  "http://localhost:8080",
  "http://localhost:8081",
  "http://localhost:4000",
  "https://freelancerhub-five.vercel.app",
  "https://freelancerhub-loadbalancer.vercel.app",
  "https://freelancer-admin.vercel.app",
];

app.disable("x-powered-by"); // Removes "X-Powered-By" header

app.use((req, res, next) => {
  res.removeHeader("X-Powered-By");
  res.removeHeader("Server");
  next();
});

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g., mobile apps or Postman)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  credentials: true,
};
// Use CORS middleware
app.use(cors(corsOptions));

// Explicitly handle preflight requests
app.options("*", cors(corsOptions));
app.use(helmet());

app.use((req, res, next) => {
  console.log(`[REQUEST]: ${req.method} ${req.url}`);
  next();
});

mongoose.connection.on("error", (err) => {
  console.error("Error connecting to MongoDB:", err);
});

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});
const WebSocket = require("ws");


const wss = new WebSocket.Server({ server });
 

 const secretKey = Buffer.from(process.env.ENCRYPTION_KEY, "hex");
 const activeUsers = new Map();
 
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
 
 wss.on("connection", (ws, req) => {
   const userId = req.url?.split("/").pop();
   if (!userId) {
     ws.close();
     return;
   }
 
   activeUsers.set(userId, ws);
   console.log(`[WEBSOCKET] Client connected: ${userId}`);
 
   ws.on("message", async (data) => {
     try {
       const messageString = data.toString();
       const parsedData = JSON.parse(messageString);
       const { sender, receiver, message, alreadyStored, type } = parsedData;
 
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
         console.log(`[WEBSOCKET] Received ${type} message:`, parsedData);
         const recipientSocket = activeUsers.get(receiver);
         if (recipientSocket) {
           recipientSocket.send(JSON.stringify(parsedData));
           console.log(`[WEBSOCKET] ${type} message sent to ${receiver}`);
         } else {
           console.error(
             `[WEBSOCKET] No active WebSocket for receiver: ${receiver}`
           );
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
       console.error("[WEBSOCKET] Error processing message:", error);
     }
   });
 
   ws.on("close", () => {
     activeUsers.delete(userId);
     console.log(`[WEBSOCKET] Client disconnected: ${userId}`);
   });
 
   ws.on("error", (error) => {
     console.error(`[WEBSOCKET] Error for ${userId}:`, error);
     activeUsers.delete(userId);
   });
 });

app.use("/api/vi/client", client);
app.use("/api/vi", loginRoute);
app.use("/api/vi", signupRoute);
app.use("/api/vi", uploadRoute);
app.use("/admin", admin);
app.use("/api/vi/freelancer", freelancer);
app.use("/api/vi/chat", chats);
app.use("/api/vi/payments", payment);
app.use("/api/vi/worksubmission", workSubmission);
app.use("/api/vi/security", security);

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
