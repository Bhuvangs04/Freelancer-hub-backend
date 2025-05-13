const express = require("express");
const { verifyToken, authorize } = require("../middleware/Auth");

const security = express.Router();

security.post(
  "/checkAuth/permission/client",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    try {
      res.status(200).send({ message: true });
    } catch (error) {
      console.error(error);
      return res.status(403).send({ message: "Server is unavailable" });
    }
  }
);


security.post(
  "/checkAuth/permission/freelancer",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      res.status(200).send({ message: true });
    } catch (error) {
      console.error(error);
      return res.status(403).send({ message: "Server is unavailable" });
    }
  }
);


module.exports = security;


