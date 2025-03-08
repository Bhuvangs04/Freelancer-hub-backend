const express = require("express");
const app = express();
const cookieParser = require("cookie-parser");
const cors = require("cors");
const { mongoose } = require("./config/database");
const helmet = require("helmet");
const loginRoute = require("./routes/Login");
const http = require("http");
const WebSocket = require("ws");
const signupRoute = require("./routes/Sign-up");
const uploadRoute = require("./routes/bucketSending");
const freelancer = require("./routes/freelancer");
const workSubmission = require("./routes/WorkSubmission");
const client = require("./routes/client");
const payment = require("./routes/payment");
const admin = require("./routes/admin");
const security = require("./routes/Security");

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.disable("x-powered-by"); // Remove "X-Powered-By" header

// Allowed origins for CORS
const allowedOrigins = [
  "https://freelancerhub-loadbalancer.vercel.app",
  "https://freelancerhub-five.vercel.app",
  "https://freelancer-admin.vercel.app",
  "http://localhost:3000", // For local dev, remove in production
];

// CORS configuration
const corsOptions = {
  origin: (origin, callback) => {
    console.log(`[CORS] Received Origin: ${origin}`); // Debug log
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log(`[CORS] Blocked Origin: ${origin}`);
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // Handle preflight requests
app.use(helmet());

// Remove unwanted headers
app.use((req, res, next) => {
  res.removeHeader("X-Powered-By");
  res.removeHeader("Server");
  console.log(`[REQUEST]: ${req.method} ${req.url}`);
  next();
});

// Create HTTP server and attach WebSocket
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// WebSocket setup (moved from initializeWebSocket for simplicity)
wss.on("connection", (ws, req) => {
  const chatId = req.url.split("/chat/")[1] || "unknown";
  console.log(`[WEBSOCKET] Client connected to chat: ${chatId}`);

  ws.on("message", (message) => {
    console.log(`[WEBSOCKET] Received from ${chatId}: ${message}`);
    ws.send(`Echo: ${message}`); // Echo for testing
  });

  ws.on("close", () => {
    console.log(`[WEBSOCKET] Client disconnected from chat: ${chatId}`);
  });

  ws.on("error", (error) => {
    console.error(`[WEBSOCKET] Error for ${chatId}: ${error}`);
  });
});

// Log upgrade requests for debugging
server.on("upgrade", (req, socket, head) => {
  console.log(`[WEBSOCKET] Upgrade request received for: ${req.url}`);
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

// MongoDB error handling
mongoose.connection.on("error", (err) => {
  console.error("Error connecting to MongoDB:", err);
});

// Routes
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

app.use("/api/vi/client", client);
app.use("/api/vi", loginRoute);
app.use("/api/vi", signupRoute);
app.use("/api/vi", uploadRoute);
app.use("/api/vi/admin", admin);
app.use("/api/vi/freelancer", freelancer);
app.use("/api/vi/payments", payment);
app.use("/api/vi/worksubmission", workSubmission);
app.use("/api/vi/security", security);

// Chat routes (assuming it’s HTTP-based, WebSocket is handled separately)
const { router: chatRoutes } = require("./routes/chat");
app.use("/api/vi/chat", chatRoutes);

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
