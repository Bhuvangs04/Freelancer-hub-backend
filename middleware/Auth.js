const JWT = require("jsonwebtoken");
const Secret = "SecureOnlyPassword";
const Action = require("../models/ActionSchema");

const logActivity = async (userId, action) => {
  try {
    await Action.create({ userId, action });
  } catch (error) {
    console.error("Error logging activity:", error);
  }
};

async function createTokenForUser(user) {
  const payload = {
    userId: user.userId,
    username: user.username,
    role: user.role,
  };
  const token = JWT.sign(payload, Secret, { expiresIn: "1d" });
  return token;
}

async function verifyToken(req, res, next) {
  const token = req.cookies.token;
  if (!token) {
    return res.status(403).send({
      errorType: "No Direct Access Allowed",
      message: "Please login to access this resource.",
      errorCode: 403,
      errorStatus: "Forbidden",
      errorDescription: "You are not authorized to access this resource.",
      errorMonitor: "PublicVisibleBanned",
      errorSolution: "Please login to access this resource/Page/Request.",
      errorReference: "https://freelancerhub-five.vercel.app/sign-in",
      errorDate: new Date().toISOString(),
      errorIp: req.ip,
      errorMethod: req.method,
    });
  }
  try {
    const decoded = JWT.verify(token, Secret);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res
        .status(401)
        .send({ error: "Token expired. Please login again." });
    }
    return res.status(403).send({ error: "UnAuthorized" });
  }
}

const authorize = (roles) => async (req, res, next) => {
  try {
    if (!roles.includes(req.user.role)) {
      await logActivity(
        req.user.userId,
        `Attempted to access forbidden routes or pages.This route allowed to only ${roles}.`
      );
      return res.status(403).json({
        message: "Forbidden",
        error: "You do not have the necessary permissions.",
      });
    }
    next();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

module.exports = { createTokenForUser, verifyToken, authorize };
