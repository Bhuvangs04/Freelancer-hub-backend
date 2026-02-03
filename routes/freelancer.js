// File: routes/freelancer.js
const express = require("express");
const { verifyToken, authorize } = require("../middleware/Auth");
const { uploadFile, deleteFile } = require("../utils/S3");
const multer = require("multer");
const User = require("../models/User");
const BidSchema = require("../models/Bid");
const Project = require("../models/Project");
const fileType = require("file-type");
const AdminWithdrawSchema = require("../models/WithdrawReportsAdmin");
const ReviewSchema = require("../models/Review");
const OldProjectsSchema = require("../models/OldProjects");
const Action = require("../models/ActionSchema");
const escrow = require("../models/Escrow");

const upload = multer();

const router = express.Router();

const logActivity = async (userId, action) => {
  try {
    await Action.create({ userId, action });
  } catch (error) {
    console.error("Error logging activity:", error);
  }
};

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

router.get(
  "/skills",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const userSkills = await UserSkill.findOne({ userId: req.user.userId });
      if (!userSkills)
        return res.status(404).json({ message: "Skills not found" });
      res.json({ skills: userSkills.skills });
    } catch (error) {
      console.log(error);
      res.status(500).send({ message: "Error fetching skills" });
    }
  }
);

router.get(
  "/wallet/details",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const freelancerId = req.user.userId;

      // Fetch freelancer's escrow records
      const escrows = await FreelancerEscrow.find({ freelancerId });

      const adminEscrows = await AdminWithdrawSchema.find({ freelancerId });

      // Fetch transactions for each escrow
      const escrowTransactions = await Promise.all(
        escrows.map(async (escrow) => {
          const transactions = await Transaction.find({ escrowId: escrow._id });
          return { transactions };
        })
      );

      const adminTransactions = await Promise.all(
        adminEscrows.map(async (adminEscrow) => {
          const transactions = await Transaction.find({
            escrowId: adminEscrow._id,
          });
          return { escrowId: adminEscrow._id, transactions };
        })
      );

      const mergedTransactions = [...escrowTransactions, ...adminTransactions];

      // Fetch freelancer's projects
      const projects = await Project.find({ freelancerId });

      // Fetch ongoing projects (tasks are embedded inside these documents)
      const ongoingProjects = await Ongoing.find({
        projectId: { $in: projects.map((p) => p._id) },
      });

      // Calculate progress for each project
      const projectsWithProgress = projects.map((project) => {
        const ongoingProject = ongoingProjects.find(
          (op) => op.projectId === project._id.toString()
        );

        if (ongoingProject) {
          const totalTasks = ongoingProject.tasks.length;
          const completedTasks = ongoingProject.tasks.filter(
            (task) => task.completed
          ).length;
          const progress =
            totalTasks > 0
              ? Math.round((completedTasks / totalTasks) * 100)
              : 0;

          return {
            ...project.toObject(),
            progress, // Add calculated progress
          };
        }

        return { ...project.toObject(), progress: 0 }; // Default progress if no tasks found
      });

      return res.status(200).json({
        transactions: mergedTransactions,
        projects: projectsWithProgress,
      });
    } catch (error) {
      console.error("Error fetching wallet details:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.get(
  "/oldProjects",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const projects = await OldProjectsSchema.find({
        freelancerId: req.user.userId,
      });
      res.json({ projects });
    } catch (error) {
      console.log(error);
      res.status(500).send({ message: "Error fetching old projects" });
    }
  }
);

// Update milestone status
router.patch(
  "/projects/:projectId/:status",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const { projectId, status } = req.params;

      const projectDetails = await Project.findOne({
        _id: projectId,
        status: "completed",
      });
      if (projectDetails) {
        return res.status(200).json({ messsage: "Project already completed" });
      }

      const milestone = await Ongoing.findById(projectId);
      if (!milestone)
        return res.status(404).json({ message: "Milestone not found" });

      milestone.status = status;
      await milestone.save();

      res.json({ message: "Milestone status updated" });
    } catch (error) {
      console.log(error);
      res.status(500).json({ message: "Error updating milestone status" });
    }
  }
);

router.post(
  "/projects/:projectId/bid",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    const { projectId } = req.params;
    const { amount, message, resumePermission } = req.body;
    try {
      const project = await Project.findById(projectId);
      if (project === null)
        return res
          .status(404)
          .json({ message: "Project not found or Deleted from the owner." });
      const bid = new BidSchema({
        projectId,
        freelancerId: req.user.userId,
        amount,
        message,
        resume_permission: resumePermission,
      });
      await bid.save();
      res.json({ message: "Bid submitted successfully" });
    } catch (err) {
      res.status(500).send({ message: "Error submitting bid" });
    }
  }
);

router.get(
  "/projects/bid/finalized",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const bids = await BidSchema.find({
        freelancerId: req.user.userId,
      })
        .populate({
          path: "projectId",
          select: "title description budget status deadline skillsRequired",
        })
        .select("-resume_permission -__v  -updatedAt");
      res.json({ bids });
    } catch (err) {
      res.status(500).send({ mesage: "Error fetching bids" });
    }
  }
);

router.get(
  "/projects/approved/work",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const bids = await BidSchema.find({
        status: "accepted",
        freelancerId: req.user.userId,
      });
      if (bids.length === 0) {
        return res.status(404).json({ message: "No approved work found" });
      }
      const projects = await Project.find({
        status: "in_progress",
        freelancerId: req.user.userId,
      }).select("-__v -createdAt -clientId -freelancerId");

      if (projects.length === 0) {
        return res.status(404).json({ message: "No approved work found" });
      }

      res.json({ projects });
    } catch (error) {
      console.log(error);
      res.status(500).send({ message: "Error fetching approved work" });
    }
  }
);

router.post(
  "/projects/:projectId/change-status/:status",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const { projectId, status } = req.params;
      const bid = await BidSchema.findOne({
        projectId,
        freelancerId: req.user.userId,
      });
      if (!bid) return res.status(404).json({ message: "Bid not found" });
      const project = await Project.findById(projectId);
      if (!project)
        return res.status(404).json({ message: "Project not found" });
      if (req.user.userId != project.freelancerId) {
        return res
          .status(401)
          .json({ message: "You are not the freelancer for this project" });
      }
      project.status = status;
      await project.save();
      res.json({ message: "Status changed successfully" });
    } catch (error) {
      console.log(error);
      res.status(500).send({ message: "Error changing status" });
    }
  }
);

router.post(
  "/client-rating/:projectId",
  verifyToken,
  authorize(["freelancer", "client"]),
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const { rating, comments } = req.body;
      const project = await Project.findById(projectId);
      if (!project)
        return res.status(404).json({ message: "Project not found" });
      // if (project.status != "completed")
      //   return res.status(400).json({ message: "Project is not yet started" });
      const review = new ReviewSchema({
        reviewedId: req.user.userId,
        reviewerId: project.clientId,
        projectId,
        rating,
        comments,
      });
      await review.save();
      res.json({ message: "Rating submitted successfully" });
    } catch (error) {
      console.log(error);
      res.status(500).send({ message: "Error submitting rating" });
    }
  }
);

router.get(
  "/freelancer/reviews",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const reviews = await ReviewSchema.find({ reviewedId: req.user.userId })
        .populate("reviewerId")
        .populate("projectId");
      if (reviews.length === 0) {
        return res.status(404).json({ message: "No reviews found" });
      }
      res.json({ reviews });
    } catch (error) {
      console.log(error);
      res.status(500).send({ message: "Error fetching reviews" });
    }
  }
);

router.get(
  "/freelancer/rating",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const reviews = await ReviewSchema.find({ reviewedId: req.user.userId });
      if (reviews.length === 0) {
        return res.status(404).json({ message: "No reviews found" });
      }
      let totalRating = 0;
      reviews.forEach((review) => {
        totalRating += review.rating;
      });
      const avgRating = totalRating / reviews.length;
      res.json({ rating: avgRating });
    } catch (error) {
      console.log(error);
      res.status(500).send({ message: "Error fetching rating" });
    }
  }
);

const UserSkill = require("../models/UserSkill");
const OldProject = require("../models/OldProjects");
const Ongoing = require("../models/OnGoingProject.Schema");
const Transaction = require("../models/Transaction");
const FreelancerEscrow = require("../models/FreelancerEscrow");
const PortfolioView = require("../models/PortfolioView");
const requestIp = require("request-ip");
const geoip = require("geoip-lite");
const sendEmail = require("../utils/sendEmail");

router.post("/contact/send-email", async (req, res) => {
  try {
    const { name, email, freelanceremail, subject, message } = req.body;

    if (!email || !subject || !message || !name) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2 style="color: #4f46e5;">New Message from ${name}</h2>
        <p><strong>Subject:</strong> ${subject}</p>
        <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
        <div style="margin-top: 15px; padding: 10px; background-color: #f9fafb; border-left: 4px solid #4f46e5;">
          <p style="margin: 0; white-space: pre-line;">${message}</p>
        </div>
        <p style="margin-top: 20px; font-size: 12px; color: #666;">
          This message was sent via your portfolio contact form.
        </p>
        <p style="font-size: 12px; color: #666;">
          <a href="https://freelancerhub-five.vercel.app" style="color: #4f46e5; text-decoration: none;">FreelancerHub</a>
        </p>
      </div>
    `;

    await sendEmail(freelanceremail, subject, html);
    res.status(200).json({ success: true, message: "Email sent successfully" });
  } catch (error) {
    console.error("Error sending contact form email:", error);
    res.status(500).json({ success: false, message: "Failed to send email" });
  }
});

router.get(
  "/freelancer/portfolio/:username/freelancer/view",
  async (req, res) => {
    try {
      const { username } = req.params;
      const ip = requestIp.getClientIp(req);
      const geo = geoip.lookup(ip) || {};

      const freelancer = await User.findOne({ username }).select(
        "experiences profilePictureUrl username email bio location title"
      );
      if (!freelancer)
        return res.status(404).json({ message: "Freelancer not found" });

      // Count this month's views
      const currentMonth = new Date();
      const startOfMonth = new Date(
        currentMonth.getFullYear(),
        currentMonth.getMonth(),
        1
      );
      const viewCount = await PortfolioView.countDocuments({
        freelancerId: freelancer._id,
        timestamp: { $gte: startOfMonth },
      });

      // Limit: 500 free-tier views per month
      if (viewCount >= 1500) {
        return res
          .status(429)
          .json({ message: "View limit exceeded for this month." });
      }

      // Log the view
      await PortfolioView.create({
        freelancerId: freelancer._id,
        ip,
        location: {
          country: geo.country,
          region: geo.region,
          city: geo.city,
        },
      });

      const skills = await UserSkill.findOne({ userId: freelancer._id }).select(
        "skills"
      );
      const oldProjects = await OldProject.find({
        freelancerId: freelancer._id,
      }).select("title description link framework");

      res.status(200).json({
        freelancer: {
          ...freelancer.toObject(),
          skills: skills ? skills.skills : [],
          oldProjects: oldProjects || [],
        },
      });
    } catch (error) {
      console.error(error);
      res.status(500).send({ message: "Error fetching freelancer portfolio" });
    }
  }
);

router.get(
  "/freelancer/portfolio/report",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const { freelancerId } = req.query;
      if (!freelancerId || freelancerId !== req.user.userId) {
        return res.status(403).json({ message: "Freelancer ID is required" });
      }
      const portfolioViews = await PortfolioView.find({
        freelancerId: req.user.userId,
      }).populate("freelancerId", "username email");
      if (!portfolioViews || portfolioViews.length === 0) {
        return res.status(404).json({ message: "No portfolio views found" });
      }
      const viewCount = portfolioViews.length;
      const viewDetails = portfolioViews.map((view) => ({
        ip: view.ip,
        location: view.location,
        timestamp: view.timestamp,
      }));
      res.status(200).json({
        viewCount,
        viewDetails,
      });
    } catch (error) {
      console.error(error);
      res.status(500).send({ message: "Error fetching portfolio report" });
    }
  }
);

router.post(
  "/freelancer/update",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    const userId = req.user.userId;

    try {
      const { bio, skills, projects, experiences, location, title } = req.body;

      if (!bio && !skills && !projects && !experiences && !location && !title) {
        return res.status(400).json({ message: "No updates provided" });
      }

      let profile = await User.findById(userId);
      if (!profile)
        return res.status(404).json({ message: "Profile not found" });

      if (bio) profile.bio = bio;

      // Update Skills (Merge with Existing)
      if (skills) {
        let userSkills = await UserSkill.findOne({ userId });

        if (userSkills) {
          const existingSkillMap = new Map(
            userSkills.skills.map((s) => [s.name.toLowerCase(), s.proficiency])
          );

          skills.forEach(({ name, proficiency }) => {
            const skillKey = name.toLowerCase();
            if (!existingSkillMap.has(skillKey)) {
              existingSkillMap.set(skillKey, proficiency || "beginner");
            }
          });

          userSkills.skills = Array.from(
            existingSkillMap,
            ([name, proficiency]) => ({
              name,
              proficiency,
            })
          );
        } else {
          userSkills = new UserSkill({
            userId,
            skills: skills.map((s) => ({
              name: s.name.toLowerCase(),
              proficiency: s.proficiency || "beginner",
            })),
          });
        }

        await userSkills.save();
      }

      if (experiences) {
        if (!profile.experiences) profile.experiences = [];

        const existingExperienceMap = new Map(
          profile.experiences.map((exp) => [
            `${exp.company.toLowerCase()}-${exp.role.toLowerCase()}`,
            exp,
          ])
        );

        experiences.forEach((exp) => {
          const key = `${exp.company.toLowerCase()}-${exp.role.toLowerCase()}`;
          if (!existingExperienceMap.has(key)) {
            existingExperienceMap.set(key, exp); // Add new experience
          }
        });

        profile.experiences = Array.from(existingExperienceMap.values());
      }

      if (location) {
        profile.location = location;
      }
      if (title) {
        profile.title = title;
      }
      // Save the updated profile

      // Update Projects (Only Insert New Ones)
      if (projects) {
        const existingProjects = await OldProject.find({
          freelancerId: userId,
        });
        const existingTitles = new Set(
          existingProjects.map((p) => p.title.toLowerCase())
        );

        const newProjects = projects.filter(
          (p) => !existingTitles.has(p.title.toLowerCase())
        );

        if (newProjects.length > 0) {
          await OldProject.insertMany(
            newProjects.map((p) => ({
              ...p,
              freelancerId: userId,
            }))
          );
        }
      }

      await profile.save(); // Save only if changes were made
      await logActivity(req.user.userId, `Profile updated successfully`);
      res
        .status(200)
        .json({ success: true, message: "Profile updated successfully" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

router.post(
  "/freelancer/upload-portfolio/photo",
  verifyToken,
  authorize(["freelancer"]),
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

      const freelancer = await User.findById(req.user.userId);

      if (freelancer.profilePictureUrl) {
        const oldFileKey = freelancer.profilePictureUrl.split(".com/")[1];
        await deleteFile(oldFileKey);
      }
      const folderName = "profile-pictures";
      const filename = `${folderName}/${userId}-profile.${file.originalname
        .split(".")
        .pop()}`;
      const url = await uploadFile(file, process.env.AWS_BUCKET_NAME, filename);
      freelancer.profilePictureUrl = url;
      await freelancer.save();
      await logActivity(
        req.user.userId,
        `Profile picture updated successfully`
      );
      res.json({ url });
    } catch (error) {
      console.log(error);
      res.status(500).send({ message: "Error uploading portfolio" });
    }
  }
);

router.post(
  "/upload-portfolio/resume",
  verifyToken,
  authorize(["freelancer"]),
  upload.single("file"),
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const file = req.file;
      await scanFile(file, ["application/pdf"], 10 * 1024 * 1024);

      const freelancer = await User.findById(userId);
      if (!freelancer)
        return res.status(404).json({ message: "Freelancer not found" });

      const folderName = "User-Resume";
      const filename = `${folderName}/${userId}-${freelancer.username}-resume.pdf`;

      // Delete old resume if it exists
      if (freelancer.resumeUrl) {
        await deleteFile(freelancer.resumeUrl, process.env.AWS_BUCKET_NAME);
      }

      // Upload new resume
      const url = await uploadFile(file, process.env.AWS_BUCKET_NAME, filename);
      freelancer.resumeUrl = url;
      await freelancer.save();
      await logActivity(req.user.userId, `Resume updated successfully`);
      res.json({ url });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error uploading resume" });
    }
  }
);

router.get(
  "/freelancer/stats",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const freelancerId = req.user.userId;

      // Get total earnings (sum of all completed project amounts)
      const completedProjects = await Project.find({
        freelancerId,
        status: "completed",
      });
      const totalEarnings = completedProjects.reduce(
        (sum, project) => sum + project.price,
        0
      );

      // Get number of completed projects
      const completedProjectsCount = completedProjects.length;

      // Get average rating
      const reviews = await ReviewSchema.find({ reviewedId: freelancerId });
      const totalRatings = reviews.reduce(
        (sum, review) => sum + review.rating,
        0
      );
      const averageRating =
        reviews.length > 0 ? totalRatings / reviews.length : 0;

      res.json({
        totalEarnings,
        completedProjectsCount,
        averageRating,
      });
    } catch (error) {
      console.log(error);
      res.status(500).json({ message: "Error fetching freelancer stats" });
    }
  }
);

router.post(
  "/freelancer/availability",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const { status } = req.body;
      if (!["Available", "Busy", "Away"].includes(status)) {
        return res.status(400).json({ message: "Invalid availability status" });
      }

      const freelancer = await User.findById(req.user.userId);
      if (!freelancer)
        return res.status(404).json({ message: "Freelancer not found" });

      freelancer.availability = status;
      await freelancer.save();

      res.json({ message: "Availability status updated successfully", status });
    } catch (error) {
      console.log(error);
      res.status(500).json({ message: "Error updating availability status" });
    }
  }
);

router.get(
  "/open/projects",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      // Fetch projects from escrow where no freelancer is assigned and status is funded
      const escrowProjects = await escrow
        .find({ freelancerId: null, status: "funded" })
        .populate({
          path: "projectId",
          match: { status: "open" },
          select: "-__v -createdAt -updatedAt -freelancerId",
        });

      // Fetch all bids made by the freelancer
      const bids = await BidSchema.find({
        freelancerId: req.user.userId,
      }).select("projectId");

      if (escrowProjects.length === 0) {
        return res.status(404).json({ message: "No open projects found" });
      }

      // Convert bid project IDs to an array for easy comparison
      const biddedProjectIds = bids.map((bid) => bid.projectId.toString());

      // Filter out projects that the freelancer has already bid on
      const openProjects = escrowProjects.filter(
        (ep) =>
          ep.projectId !== null &&
          !biddedProjectIds.includes(ep.projectId.toString())
      );

      res.json({ openProjects, bids });
    } catch (error) {
      console.log(error);
      res.status(500).json({ message: "Error fetching open projects" });
    }
  }
);

router.put(
  "/upload-portfolio",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const { bio, username } = req.body;
      const freelancer = await User.findById(req.user.userId).select(
        "-password -__v -createdAt -updatedAt -isBanned -otpVerified -banExpiresAt -Strikes"
      );
      if (!freelancer)
        return res.status(404).json({ message: "Freelancer not found" });

      freelancer.bio = bio;
      freelancer.username = username;
      await freelancer.save();
      await logActivity(req.user.userId, `Portfolio updated successfully`);
      res.json({ message: "Portfolio updated successfully", freelancer });
    } catch (error) {
      console.log(error);
      res.status(500).json({ message: "Error uploading portfolio" });
    }
  }
);

router.get("/details", verifyToken, async (req, res) => {
  try {
    const id = req.user.userId;
    const freelancer = await User.findById(id).select(
      "-password -__v -createdAt -updatedAt -isBanned -otpVerified -banExpiresAt -Strikes"
    );
    if (!freelancer)
      return res.status(404).json({ message: "Freelancer not found" });
    res.json({ freelancer });
  } catch (error) {
    console.log(error);
    res.status(500).send({ message: "Error fetching freelancer" });
  }
});

router.post(
  "/freelancer/oldworks/:id",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { title, description, link, framework } = req.body;
      if (!title || !description || !framework)
        return res
          .status(400)
          .json({ message: "Title, description and framework are required" });
      if (req.user.userId != id)
        return res
          .status(401)
          .json({
            message:
              "You are not authorized to add old works for this freelancer",
          });
      const oldProject = new OldProjectsSchema({
        freelancerId: req.user.userId,
        title,
        description,
        link,
        framework,
      });
      await oldProject.save();
    } catch (error) {
      console.log(error);
      res.status(500).send({ message: "Error fetching old works" });
    }
  }
);


module.exports = router;
