const Action = require("../models/ActionSchema");
const jwt = require("jsonwebtoken");

const logAction = async (req, res, next) => {
  try {
    const excludedRoutes = [
      "/api/vi/Client/login",
      "/api/vi/Manager/login",
      "/api/vi/signup",
      "/health",
      "/api/vi/send-otp",
      "/api/vi/verify-otp",
    ];
    if (excludedRoutes.includes(req.path)) {
      return next();
    }
    const token = req.cookies.token;
    if (!token) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const decoded = jwt.verify(token, "SecureOnlyPassword"); 
    const userId = decoded.userId;
    const role = decoded.role; 

    await Action.create({
      userId,
      role,
      actionName: req.method,
      route: req.originalUrl,
      method: req.method,
      description: `User accessed ${req.originalUrl}`, 
    });

    next(); // Proceed to the next middleware or route handler
  } catch (error) {
    console.error("Error logging action:", error);
    next(); // Ensure the request continues even if logging fails
  }
};

module.exports = logAction;
