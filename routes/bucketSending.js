const express = require("express");
const { verifyToken, authorize } = require("../middleware/Auth");
const { uploadFile } = require("../utils/S3");
const multer = require("multer");
const User  = require("../models/User"); // Import Mongoose User model
const fileType = require("file-type");
const upload = multer();
const router = express.Router();

/**
 * Utility function to scan and validate files
 * - Checks for file type and size.
 */
const scanFile = async (file, allowedTypes, maxSize) => {
  if (!file) throw new Error("File is missing");

  const { buffer, size, originalname } = file;

  // Check file size
  if (size > maxSize) {
    throw new Error(`File size exceeds the maximum limit of ${maxSize} bytes`);
  }

  // Detect file type
  const type = await fileType.fromBuffer(buffer);

  if (!type || !allowedTypes.includes(type.mime)) {
    throw new Error(`Invalid file type for ${originalname}`);
  }

  return type;
};

/**
 * Upload Profile Picture Route
 */
router.post(
  "/upload-profile",
  verifyToken,
  authorize(["client", "freelancer"]),
  upload.single("file"),
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const file = req.file;
      const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/jpg",
        "image/webp",
      ];

      await scanFile(file, allowedTypes, 5 * 1024 * 1024);

      const folderName = "profile-pictures";
      const filename = `${folderName}/${userId}-profile.${file.originalname
        .split(".")
        .pop()}`;
      const url = await uploadFile(file, process.env.AWS_BUCKET_NAME, filename);

      // Store in MongoDB
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).send({ message: "User not found" });
      }

      user.profilePictureUrl = url;
      await user.save();

      res.json({ profile_Picture_Update: "Successfully" });
    } catch (err) {
      console.error(err)
      res.status(400).send({ message: err.message });
    }
  }
);

/**
 * Upload Resume Route
 */
router.post(
  "/upload-resume",
  verifyToken,
  authorize(["freelancer"]),
  upload.single("file"),
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const file = req.file;

      if (!userId) {
        return res
          .status(404)
          .json({ message: "Please Login Again and continue Uploading work." });
      }

      // Scan and validate the file
      await scanFile(file, ["application/pdf"], 10 * 1024 * 1024);

      const folderName = "User-Resume";
      const filename = `${folderName}/${userId}-resume.pdf`;
      const url = await uploadFile(file, process.env.AWS_BUCKET_NAME, filename);

      // Store in MongoDB
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).send({ message: "User not found" });
      }

      user.resumeUrl = url;
      await user.save();

      res.json({ resume_Update: "Successfully" });
    } catch (err) {
      res.status(400).send({ message: err.message });
    }
  }
);

const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");

const s3 = new S3Client({ region: process.env.AWS_REGION });

router.get("/profile-picture", verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const user = await User.findById(userId);
    if (!user || !user.profilePictureUrl) {
      return res.status(404).json({ message: "Profile picture not found" });
    }

    const fileKey = user.profilePictureUrl.split(".com/")[1];
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: fileKey,
    });

    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

    res.json({ profilePictureUrl: signedUrl });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.get("/profile-picture/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user || !user.profilePictureUrl) {
      return res.status(404).send("No profile picture found");
    }

    const response = await fetch(user.profilePictureUrl);
    console.log(response)
    const buffer = await response.buffer();

    res.setHeader("Content-Type", "image/jpeg"); // Adjust based on file type
    res.send(buffer);
  } catch (err) {
    console.log(err)
    res.status(500).send({message: "Error loading image"});
  }
});

router.get("/resume/view/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user || !user.resumeUrl) {
      return res.status(404).json({ message: "Resume not found" });
    }

    const fileKey = user.resumeUrl.split(".com/")[1];
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: fileKey,
    });
    const { Body, ContentType } = await s3.send(command);
    res.setHeader("Content-Type", ContentType || "application/pdf");
    Body.pipe(res);
  } catch (err) {
    res.status(500).json({ message: "Error retrieving resume" });
  }
});

router.get("/resume/download/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user || !user.resumeUrl) {
      return res.status(404).json({ message: "Resume not found" });
    }

    const fileKey = user.resumeUrl.split(".com/")[1];
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: fileKey,
    });

    const { Body, ContentType } = await s3.send(command);
    res.setHeader("Content-Disposition", "attachment; filename=resume.pdf");
    res.setHeader("Content-Type", ContentType || "application/pdf");
    Body.pipe(res);
  } catch (err) {
    res.status(500).json({ message: "Error retrieving resume" });
  }
});



module.exports = router;
