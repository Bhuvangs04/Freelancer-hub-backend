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
    return res.status(403).send({ error: "Unauthorized." });
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
  if (!roles.includes(req.user.role)) return res.status(403).send({message:"Forbidden"});
  next();
};
module.exports = { createTokenForUser, verifyToken, authorize };
