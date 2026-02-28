// ============================================================================
// FreelancerHub Backend - Main Entry Point
// Refactored for modularity and maintainability
// ============================================================================

const express = require("express");
const http = require("http");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const helmet = require("helmet");
const { mongoose } = require("./config/database");
const WebSocketService = require("./services/websocket");
const { notFoundHandler, errorHandler } = require("./middleware/ErrorHandler");
const { latencyMonitor } = require("./middleware/LatencyMonitor");

// ============================================================================
// APP INITIALIZATION
// ============================================================================

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

// ============================================================================
// ROUTE IMPORTS
// ============================================================================

const loginRoute = require("./routes/Login");
const signupRoute = require("./routes/Sign-up");
const uploadRoute = require("./routes/bucketSending");
const freelancer = require("./routes/freelancer");
const chats = require("./routes/chat");
const workSubmission = require("./routes/WorkSubmission");
const client = require("./routes/client");
const payment = require("./routes/payment");
const admin = require("./routes/admin");
const security = require("./routes/Security");
const agreement = require("./routes/agreement");
const milestone = require("./routes/milestone");
const review = require("./routes/review");
const dispute = require("./routes/dispute");
const skills = require("./routes/skills");
const finance = require("./routes/finance");
const metrics = require("./routes/metrics");

// ============================================================================
// SECURITY MIDDLEWARE
// ============================================================================

app.set("trust proxy", true);
app.disable("x-powered-by");

// Remove sensitive headers
app.use((req, res, next) => {
  res.removeHeader("X-Powered-By");
  res.removeHeader("Server");
  next();
});

app.use(helmet());

// ============================================================================
// CORS CONFIGURATION
// ============================================================================

const allowedOrigins = [
  "http://localhost:8080",
  "http://localhost:8081",
  "http://localhost:4000",
  "http://localhost:5173",
  "https://freelancerhub-five.vercel.app",
  "https://freelancerhub-loadbalancer.vercel.app",
  "https://freelancer-admin.vercel.app",
];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  credentials: true,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// ============================================================================
// BODY PARSING
// ============================================================================

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(cookieParser());

// ============================================================================
// LATENCY MONITORING
// ============================================================================

app.use(latencyMonitor);

// ============================================================================
// DATABASE CONNECTION EVENTS
// ============================================================================

mongoose.connection.on("error", (err) => {
  console.error("MongoDB connection error:", err);
});

mongoose.connection.on("disconnected", () => {
  console.warn("MongoDB disconnected. Attempting to reconnect...");
});

mongoose.connection.on("reconnected", () => {
  console.log("MongoDB reconnected");
});

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ============================================================================
// API ROUTES
// ============================================================================

// Authentication
app.use("/api/vi", loginRoute);
app.use("/api/vi", signupRoute);

// File Upload
app.use("/api/vi", uploadRoute);

// User Management
app.use("/api/vi/client", client);
app.use("/api/vi/freelancer", freelancer);

// Core Features
app.use("/api/vi/chat", chats);
app.use("/api/vi/payments", payment);
app.use("/api/vi/worksubmission", workSubmission);
app.use("/api/vi/security", security);

// Contract & Trust Features
app.use("/api/vi/agreement", agreement);
app.use("/api/vi/milestone", milestone);
app.use("/api/vi/review", review);
app.use("/api/vi/dispute", dispute);

// Skill & Finance Features
app.use("/api/vi/skills", skills);
app.use("/api/vi/finance", finance);

// Admin Panel
app.use("/admin", admin);
app.use("/admin", require("./routes/adminSettings"));
app.use("/admin/metrics", metrics);

// ============================================================================
// PUBLIC SETTINGS (no auth — used by frontend for commission, maintenance, etc.)
// ============================================================================
const SiteSettings = require("./models/SiteSettings");

app.get("/api/vi/settings/public", async (_req, res) => {
  try {
    const settings = await SiteSettings.getSettings();
    if (!settings) {
      return res.status(404).json({ message: "Settings not found" });
    }
    if (settings.maintenanceMode) {
      return res.json({
        message: "Maintenance mode is enabled",
        maintenanceMode: settings.maintenanceMode,
        maintenanceMessage: settings.maintenanceMessage,
      });
    }
    res.json({
      platformCommissionPercent: settings.platformCommissionPercent,
      siteName: settings.siteName,
      logoUrl: settings.logoUrl,
      supportEmail: settings.supportEmail,
      maintenanceMode: settings.maintenanceMode,
      maintenanceMessage: settings.maintenanceMessage,
      minimumProjectBudget: settings.minimumProjectBudget,
      maximumProjectBudget: settings.maximumProjectBudget,
    });
  } catch (err) {
    console.error("Public settings error:", err);
    res.status(500).json({ message: "Error fetching settings" });
  }
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

// 404 handler for undefined routes
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// ============================================================================
// WEBSOCKET INITIALIZATION
// ============================================================================

const wsService = new WebSocketService(server);

// ============================================================================
// SERVER START
// ============================================================================

server.listen(PORT, () => {
  console.log("=".repeat(60));
  console.log(`FreelancerHub Server started`);
  console.log(`Port: ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log("=".repeat(60));
});

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

process.on("SIGTERM", () => {
  console.log("SIGTERM received. Shutting down gracefully...");
  server.close(() => {
    mongoose.connection.close(false, () => {
      console.log("Server closed. Database connection closed.");
      process.exit(0);
    });
  });
});

module.exports = { app, server, wsService };
