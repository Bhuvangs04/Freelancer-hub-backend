// ============================================================================
// DATABASE CONFIGURATION
// MongoDB connection setup with proper error handling
// ============================================================================

const mongoose = require("mongoose");
require("dotenv").config();

// ============================================================================
// CONNECTION OPTIONS
// ============================================================================

const connectionOptions = {
  // Connection pool settings
  maxPoolSize: 10,
  minPoolSize: 5,

  // Timeouts
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,

  // Retry settings
  retryWrites: true,
  retryReads: true,
};

// ============================================================================
// CONNECTION SETUP
// ============================================================================

const connectDB = async () => {
  const mongoURI = process.env.MongoDBURL;

  if (!mongoURI) {
    console.error("CRITICAL: MongoDBURL not set in environment variables!");
    process.exit(1);
  }

  try {
    await mongoose.connect(mongoURI, connectionOptions);
    console.log("✅ Connected to MongoDB");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  }
};

// Connect immediately
connectDB();

// ============================================================================
// CONNECTION EVENT HANDLERS
// ============================================================================

mongoose.connection.on("connected", () => {
  console.log("Mongoose connected to database");
});

mongoose.connection.on("error", (err) => {
  console.error("Mongoose connection error:", err);
});

mongoose.connection.on("disconnected", () => {
  console.log("Mongoose disconnected");
});

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

process.on("SIGINT", async () => {
  try {
    await mongoose.connection.close();
    console.log("MongoDB connection closed through app termination");
    process.exit(0);
  } catch (err) {
    console.error("Error closing MongoDB connection:", err);
    process.exit(1);
  }
});

module.exports = { mongoose, connectDB };
