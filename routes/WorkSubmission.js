const express = require("express");
const router = express.Router();
const upload = multer();
const {verifyToken,authorize} = require("../middleware/Auth")
const WorkSubmission = require("../models/WorkSubmission")
const { uploadFile } = require("../utils/S3"); 

router.post(
  "/upload-work",
  verifyToken,
  authorize(["freelancer"]),
  upload.array("files", 10),
  async (req, res) => {
    try {
      const { clientId, projectId } = req.body; // Who is the client & job ID?
      const freelancerId = req.user.userId; // Get freelancer ID
      const files = req.files; // Get uploaded files

      if (!files || files.length === 0) {
        return res.status(400).json({ message: "No files uploaded" });
      }

      let fileUrls = [];

      // Upload each file to S3
      for (const file of files) {
        const filename = `work-submissions/${freelancerId}/${projectId}-${file.originalname}`;
        const fileUrl = await uploadFile(
          file,
          process.env.AWS_BUCKET_NAME,
          filename
        );
        fileUrls.push(fileUrl);
      }

      // Save file URLs to MongoDB
      const workSubmission = new WorkSubmission({
        freelancerId,
        clientId,
        projectId,
        fileUrls,
        status: "pending",
      });

      await workSubmission.save();

      res.json({
        message: "Work files uploaded successfully",
        files: fileUrls,
      });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.get(
  "/review-work/:projectId",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const clientId = req.user.userId;

      const submission = await WorkSubmission.findOne({ projectId, clientId });

      if (!submission || submission.status !== "pending") {
        return res.status(404).json({ message: "No work submission found" });
      }

      res.json({ files: submission.fileUrls });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.post(
  "/approve-work/:projectId",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const clientId = req.user.userId;

      const submission = await WorkSubmission.findOne({ projectId, clientId });

      if (!submission) {
        return res.status(404).json({ message: "Work submission not found" });
      }

      // Update status to approved
      submission.status = "approved";
      await submission.save();

      res.json({ message: "Work approved. Payment will be processed." });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.post(
  "/reject-work/:projectId",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const { reason } = req.body;
      const clientId = req.user.userId;

      const submission = await WorkSubmission.findOne({ projectId, clientId });

      if (!submission) {
        return res.status(404).json({ message: "Work submission not found" });
      }

      submission.status = "rejected";
      submission.rejectionReason = reason;
      await submission.save();
      res.json({ message: "Work rejected. Freelancer must revise." });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);


module.exports = router;
