const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer();
const { verifyToken } = require("../middleware/Auth");
const OnGoing = require("../models/OnGoingProject.Schema");
const { uploadFile, deleteFile } = require("../utils/S3");
const Ongoing = require("../models/OnGoingProject.Schema");
const User = require("../models/User");
const chat_sys = require("../models/chat_sys");

router.post("/tasks", verifyToken, async (req, res) => {
  try {
    const { projectId, title } = req.body;

    if (!projectId || !title) {
      return res
        .status(400)
        .json({ message: "Project ID and title are required" });
    }

    const project = await OnGoing.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    const newTask = { title, completed: false };
    project.tasks.push(newTask);
    await project.save();

    res.status(200).json({ message: "Task added successfully", task: newTask });
  } catch (error) {
    console.error("Error adding task:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.patch("/tasks/:taskId", verifyToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { projectId, completed } = req.body;

    if (!projectId || !completed) {
      return res
        .status(400)
        .json({ message: "Project ID and completed are required" });
    }

    const project = await OnGoing.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    const task = project.tasks.id(taskId);
    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }
    if (completed !== undefined) task.completed = completed;

    await project.save();

    res.status(200).json({ message: "Task updated successfully", task });
  } catch (error) {
    console.error("Error adding task:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.delete("/tasks/:taskId/:projectId", verifyToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { projectId } = req.params;

    if (!projectId || !taskId) {
      return res
        .status(400)
        .json({ message: "Project ID and taskId are required" });
    }

    const project = await OnGoing.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    const taskIndex = project.tasks.findIndex(
      (task) => task._id.toString() === taskId
    );
    if (taskIndex === -1) {
      return res.status(404).json({ message: "Task not found" });
    }

    project.tasks.splice(taskIndex, 1);

    await project.save();

    res.status(200).json({ message: "Task deleted successfully" });
  } catch (error) {
    console.error("Error deleting task:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// =================== UPLOAD FILE TO AWS S3 ===================
router.post(
  "/upload-file",
  verifyToken,
  upload.single("file"),
  async (req, res) => {
    try {
      const { projectId, fileName } = req.body; // Accept file name from user
      const file = req.file;
      if (!req.file || !projectId || !fileName) {
        return res
          .status(400)
          .json({ message: "File, project ID, and file name are required" });
      }

      const project = await OnGoing.findById(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Define file key using user-defined file name
      const fileKey = `workSubmission/${projectId}/${Date.now()}-${fileName}`;

      const s3Upload = await uploadFile(
        file,
        process.env.AWS_BUCKET_NAME,
        fileKey
      );
      const fileUrl = s3Upload;

      // Store file details in DB
      const newFile = { name: fileName, size: req.file.size, url: fileUrl };
      project.files.push(newFile);
      await project.save();

      res.status(200).json({ message: "File uploaded successfully", fileUrl });
    } catch (error) {
      console.error("Error uploading file:", error);
      res.status(500).json({ message: "File upload failed" });
    }
  }
);

// =================== Delete file  ===================
router.delete("/projects/:projectId/files/:fileId", async (req, res) => {
  try {
    const { projectId, fileId } = req.params;
    const project = await OnGoing.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    const fileIndex = project.files.findIndex(
      (file) => file._id.toString() === fileId
    );
    if (fileIndex === -1) {
      return res.status(404).json({ message: "File not found" });
    }

    const fileKey = project.files[fileIndex].url.split(".com/")[1];
    await deleteFile(fileKey); // Delete from AWS S3

    project.files.splice(fileIndex, 1); // Remove file from MongoDB
    await project.save();

    res.status(200).json({ message: "File deleted successfully" });
  } catch (error) {
    console.error("Error deleting file:", error);
    res.status(500).json({ message: "File deletion failed" });
  }
});

// =================== GET ONGOING PROJECT DETAILS ===================
router.get("/ongoing/projects/V1", verifyToken, async (req, res) => {
  try {
    const projects = await OnGoing.find({ freelancerId: req.user.userId });

    // Map through projects to add clientName and messageCount
    const updatedProjects = await Promise.all(
      projects.map(async (project) => {
        const user = await User.findOne({ _id: project.clientId }).select(
          "username"
        );
        const messageCount = await chat_sys.countDocuments({
          clientId: project.clientId,
        });

        return {
          ...project.toObject(),
          clientName: user?.username || "Unknown",
          messageCount,
        };
      })
    );

    res.status(200).json(updatedProjects);
  } catch (error) {
    console.error("Error fetching projects:", error);
    res.status(500).json({ message: "Error fetching projects" });
  }
});


router.get("/projects/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const projects = await Ongoing.find({
      $or: [{ projectId: id }, { _id: id }],
    });
    res.status(200).json(projects);
  } catch (error) {
    console.log(error);
    return res.status(503).json({ message: "Unable to fetch" });
  }
});


module.exports = router;
