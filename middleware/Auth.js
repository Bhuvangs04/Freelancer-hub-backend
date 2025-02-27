const { errorMonitor } = require("http-proxy");
const JWT = require("jsonwebtoken");
const Secret = "SecureOnlyPassword";

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
      errorSolution: "Please login to access this resource.",
      errorReference: "http://localhost:8080/sign-in",
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

const authorize = (roles) => (req, res, next) => {
  if (!roles.includes(req.user.role))
    return res.status(403).send({ message: "Forbidden" });
  next();
};
module.exports = { createTokenForUser, verifyToken, authorize };
