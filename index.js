const express = require("express");
const app = express();
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
const PORT = process.env.PORT || 3000;
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(cookieParser());
const allowedOrigins = [
  "http://localhost:8080",
  "http://localhost:8081",
  "http://localhost:4000",
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

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
