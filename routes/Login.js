const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const { verifyToken, authorize } = require("../middleware/Auth");
const { createTokenForUser } = require("../middleware/Auth");
const User = require("../models/User"); // Assuming you have a User model
const Admin = require("../models/Admin"); // Assuming you have an Admin model

const xorKey = "SecureOnlyThingsAreDone"; // Keep this secure

// XOR Decryption function
function xorDecrypt(obfuscatedString, key) {
  let decoded = atob(obfuscatedString)
    .split("")
    .map((c, i) => c.charCodeAt(0) ^ key.charCodeAt(i % key.length));
  return String.fromCharCode(...decoded); // Ensure proper string conversion
}
router.post("/:userDetails/login", async (req, res) => {
  const { userDetails } = req.params;
  let { email, password, secretCode } = req.body;
  try {
    if (typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ message: "Invalid request format" });
    }
    email = xorDecrypt(email, xorKey);
    password = xorDecrypt(password, xorKey);
    let user;
    if (userDetails === "Manager") {
      user = await Admin.findOne({ email, secret_code: secretCode });
      if (!user)
        return res.status(401).json({ message: "Invalid email or password" });
    } else if (userDetails === "Client") {
      user = await User.findOne({ email });
      if (!user) return res.status(401).json({ message: "Invalid email" });
      if (user.isBanned) {
        return res.status(403).json({
          message: "Account is banned due to unusual activity",
          user: {
            username: user.username,
            banDate: user.isbanDate,
            reviewDate: new Date(
              user.isbanDate.getTime() + 6 * 24 * 60 * 60 * 1000
            ),
          },
          reason:
            "We've detected unusual activity on your account that violates our terms of service. This includes multiple violations of our community guidelines regarding project submissions and client communications.",
        });
      }
    } else {
      return res.status(404).json({ message: "User not found" });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid)
      return res.status(401).json({ message: "Invalid  password" });

    const tokenDetails = {
      userId: user._id, // Using UUID for user ID
      username: user.username,
      role: userDetails === "Manager" ? "admin" : user.role,
    };

    const token = await createTokenForUser(tokenDetails);
    res.cookie("token", token, {
      sameSite: "None",
      httpOnly: true,
      secure: true, // Must be true when using SameSite=None
      path: "/",
    });

    res.json({
      message: "Login successful",
      username: user.username,
      email: user.email,
      role: tokenDetails.role,
      chat_id: user._id,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

const cosineSimilarity = (vecA, vecB) => {
  if (
    !Array.isArray(vecA) ||
    !Array.isArray(vecB) ||
    vecA.length === 0 ||
    vecB.length === 0
  ) {
    throw new Error(
      "Invalid input: One or both vectors are undefined, empty, or not arrays"
    );
  }
  if (vecA.length !== vecB.length) {
    throw new Error("Vector lengths do not match");
  }

  const dotProduct = vecA.reduce((sum, val, i) => sum + val * vecB[i], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));

  return magnitudeA && magnitudeB ? dotProduct / (magnitudeA * magnitudeB) : 0;
};

router.post("/verify", verifyToken, authorize(["admin"]), async (req, res) => {
  const { faceEmbeddings } = req.body;
  const admin = await Admin.findOne({ _id: req.user.userId });

  if (!admin) return res.status(404).json({ error: "Admin not found" });

  // Compare embeddings (Euclidean distance or cosine similarity)
  const similarity = cosineSimilarity(faceEmbeddings, admin.faceEmbedding);

  console.log(similarity);

  if (similarity > 0.85) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: "Face does not match" });
  }
});

router.post(
  "/store-face",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    const { faceEmbeddings } = req.body;

    const existingAdmin = await Admin.findOne({ _id: req.user.userId });
    if (!existingAdmin)
      return res.status(400).json({ error: "User admin found" });

    const similarity = cosineSimilarity(
      faceEmbeddings,
      existingAdmin.faceEmbedding
    );

    console.log(similarity);

    existingAdmin.faceEmbedding = faceEmbeddings;
    await existingAdmin.save();

    res.json({ success: true, message: "Face stored successfully" });
  }
);

router.put(
  "/update-face",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    const { faceEmbeddings } = req.body;

    const admin = await Admin.findOne({ _id: req.user.userId });
    if (!admin) return res.status(404).json({ error: "Admin not found" });

    admin.faceEmbedding = faceEmbeddings;
    await admin.save();

    res.json({ success: true, message: "Face updated successfully" });
  }
);

router.get("/logout", verifyToken, async (req, res) => {
  res.clearCookie("token", {
    sameSite: "None",
    secure: true,
    path: "/",
  });
  res.json({ message: "Logout successful" });
});

    
router.post("/verify-chatting-id", verifyToken, async (req, res) => {
try {
  res.json({ chat_id: req.user.userId });
} catch (error) {
  console.error(error);
  res.status(500).json({ message: "Internal server error" });
}
});
    

module.exports = router;
