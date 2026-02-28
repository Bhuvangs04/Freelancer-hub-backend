// File: routes/client.js
const express = require("express");
const { verifyToken, authorize } = require("../middleware/Auth");
const { uploadFile, deleteFile } = require("../utils/S3");
const multer = require("multer");
const User = require("../models/User");
const Project = require("../models/Project");
const Payment = require("../models/Payment");
const BidSchema = require("../models/Bid");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const UserSkillSchema = require("../models/UserSkill");
const OldProjectsSchema = require("../models/OldProjects");
const company = require("../models/Company-clients");
const Action = require("../models/ActionSchema");
const OnGoingSchema = require("../models/OnGoingProject.Schema");
const ChatSchema = require("../models/chat_sys");
const Escrow = require("../models/Escrow");
const ReviewSchema = require("../models/Review");

const fileType = require("file-type");
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

router.post(
  "/client/:freelancerId",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    // DEPRECATED: Direct hiring bypasses agreement flow
    // All hiring should now go through: Create Agreement -> Sign -> Complete
    return res.status(400).json({
      message: "Direct hiring is deprecated. Please use the agreement flow: Accept bid to create agreement, review terms, send for signing, and complete signatures.",
      action: "Use the 'Accept Bid' button which creates an agreement for review and signing.",
      redirectTo: "/agreements"
    });
  }
);

router.get("/ongoing/projects", verifyToken, async (req, res) => {
  try {
    const ongoingProjects = await OnGoingSchema.find({
      clientId: req.user.userId,
    });

    const filteredProjects = [];

    for (const ongoing of ongoingProjects) {
      const project = await Project.findById(ongoing.projectId);
      if (!project || project.status === "completed") continue;

      const messages = await ChatSchema.find({
        $or: [
          { sender: ongoing.freelancerId, receiver: req.user.userId },
          { sender: req.user.userId, receiver: ongoing.freelancerId },
        ],
      })
        .sort({ timestamp: -1 })
        .limit(5);

      const totalTasks = ongoing.tasks.length;
      const completedTasks = ongoing.tasks.filter(
        (task) => task.completed
      ).length;
      const progress =
        totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

      filteredProjects.push({ ...ongoing._doc, messages, progress });
    }

    res.status(200).json(filteredProjects);
  } catch (error) {
    console.log(error);
    res.status(500).send({ message: "Error fetching projects" });
  }
});

router.post(
  "/client/:freelancerId/reject",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    try {
      const { freelancerId } = req.params;
      const { projectId } = req.query;

      const bid = await BidSchema.findOne({
        projectId: projectId,
        freelancerId: freelancerId,
      });
      if (!bid) {
        return res.status(400).json({ message: "Bid not found" });
      }
      bid.status = "rejected";
      await bid.save();
      await logActivity(req.user.userId, "Hired a freelancer");
      res.json({ message: "Freelancer hired successfully" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error processing request" });
    }
  }
);

router.post(
  "/company",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    try {
      const { companyName, industry, position, type } = req.body;
      const userId = req.user.userId;

      // Check if the company already exists for the user
      const existingCompany = await company.findOne({ userId });

      if (existingCompany) {
        // Update existing company
        existingCompany.companyName = companyName;
        existingCompany.Industry = industry;
        existingCompany.Position = position;
        existingCompany.type = type;

        await existingCompany.save();
        return res.json({ message: "Company updated successfully" });
      } else {
        // Create a new company entry
        const newCompany = new company({
          userId,
          companyName,
          Industry: industry,
          Position: position,
          type,
        });

        await logActivity(req.user.userId, "Updated profile");

        await newCompany.save();
        return res.json({ message: "Company added successfully" });
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error processing request" });
    }
  }
);

// Release Payment
// router.post(
//   "/projects/:projectId/release-payment",
//   verifyToken,
//   authorize(["client"]),
//   async (req, res) => {
//     try {
//       const { projectId } = req.params;
//       const project = await Project.findById(projectId);
//       if (!project)
//         return res.status(404).json({ message: "Project not found" });
//       if (project.clientId.toString() !== req.user.userId) {
//         return res.status(403).json({ message: "Unauthorized action" });
//       }
//       const escrow = await Escrow.findOne({ projectId });
//       if (!escrow || escrow.amount <= 0) {
//         return res.status(400).json({ message: "No escrow balance available" });
//       }
//       await Payment.create({
//         projectId,
//         amount: escrow.amount,
//         freelancerId: project.freelancerId,
//       });
//       escrow.amount = 0;
//       await escrow.save();
//       res.json({ message: "Payment released successfully" });
//     } catch (error) {
//       console.log(error);
//       res.status(500).send({ message: "Error releasing payment" });
//     }
//   }
// );

// Check Escrow Balance
router.get(
  "/projects/:projectId/escrow-balance",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const escrow = await Escrow.findOne({ projectId });
      if (!escrow) return res.json({ balance: 0 });
      res.json({ balance: escrow.amount });
    } catch (error) {
      console.log(error);
      res.status(500).send({ message: "Error fetching escrow balance" });
    }
  }
);

router.get(
  "/client/profile",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    try {
      const userId = req.user.userId;

      console.log(userId)

      const user = await company
        .findOne({ userId })
        .select("companyName Industry Position type")
        .populate("userId", "username email profilePictureUrl ");

      console.log(user)

      const projects = await Project.find({ clientId: userId }).select(
        "_id title description budget deadline skillsRequired status freelancerId createdAt"
      );

      const updatedProjects = await Promise.all(
        projects.map(async (project) => {
          const escrowWallet = await Escrow.findOne({
            projectId: project._id,
          });
          return {
            ...project.toObject(),
            status: escrowWallet ? project.status : "cancelled",
          };
        })
      );

      // ── GLOBAL WALLET: client's locked (escrow) and available balance ──
      const wallet = await Wallet.findOne({ userId: req.user.userId });
      const total_balance = wallet ? wallet.escrowBalance : 0;
      const available_balance = wallet ? wallet.balance : 0;

      await logActivity(req.user.userId, "Viewed profile");
      const LogActivity = await Action.find({ userId: req.user.userId })
        .select("action timestamp")
        .sort({ timestamp: -1 })
        .limit(30);
      res
        .status(200)
        .json({ user, projects: updatedProjects, total_balance, available_balance, LogActivity });
    } catch (error) {
      console.error(error);
      res.status(500).send({ message: "Error fetching profile" });
    }
  }
);

// Edit Profile
router.post(
  "/client/update-profile",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    try {
      const { email, username } = req.body;
      const client = await User.findById(req.user.userId);
      if (!client) return res.status(404).json({ message: "Client not found" });
      client.email = email;
      client.username = username;
      await client.save();
      res.json({ message: "Profile updated successfully" });
    } catch (error) {
      console.log(error);
      res.status(500).send({ message: "Error updating profile" });
    }
  }
);

// Update Profile Picture
router.post(
  "/pictureUpdate",
  verifyToken,
  authorize(["client"]),
  upload.single("file"),
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const file = req.file;
      const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/jpg",
        "image/webp",
      ];
      await scanFile(file, allowedTypes, 5 * 1024 * 1024);

      const client = await User.findById(userId);
      if (client.profilePictureUrl) {
        const oldFileKey = client.profilePictureUrl.split(".com/")[1];
        await deleteFile(oldFileKey);
      }
      const folderName = "profile-pictures";
      const filename = `${folderName}/${userId}-profile.${file.originalname
        .split(".")
        .pop()}`;
      const url = await uploadFile(file, process.env.AWS_BUCKET_NAME, filename);
      client.profilePictureUrl = url;
      client.profileComplete = true;
      await client.save();
      await logActivity(req.user.userId, "Updated profile picture");
      res.status(200).json({ url });
    } catch (error) {
      console.log(error);
      res.status(500).send({ message: "Error updating profile picture" });
    }
  }
);

router.get(
  "/clients/projects",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    try {
      const projects = await Project.find({ clientId: req.user.userId }).select(
        "_id title description budget deadline skillsRequired status freelancerId createdAt"
      );

      const updatedProjects = await Promise.all(
        projects.map(async (project) => {
          const escrowWallet = await Escrow.findOne({
            projectId: project._id,
          });
          return {
            ...project.toObject(),
            status: escrowWallet ? project.status : "Payment Pending",
          };
        })
      );

      res.json({ projects: updatedProjects });
    } catch (error) {
      console.error(error);
      res.status(500).send({ message: "Error fetching projects" });
    }
  }
);

router.get(
  "/clients/projects/bids",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    try {
      const projects = await Project.find({
        clientId: req.user.userId,
        status: "open",
      }).select(
        "_id title description budget deadline skillsRequired status freelancerId createdAt"
      );

      const updatedProjects = await Promise.all(
        projects.map(async (project) => {
          const escrowWallet = await Escrow.findOne({
            projectId: project._id,
          });
          return {
            ...project.toObject(),
            status: escrowWallet ? "open" : "Payment Pending",
          };
        })
      );

      res.json({ projects: updatedProjects });
    } catch (error) {
      console.error(error);
      res.status(500).send({ message: "Error fetching projects" });
    }
  }
);

// Add Project
router.post(
  "/clients/add-project",
  verifyToken,
  authorize(["client"]),
  upload.none(), // No files, only text fields
  async (req, res) => {
    try {
      const { title, description, budget, deadline, skills, Form_id } =
        req.body;
      if (
        !title ||
        !description ||
        !budget ||
        !deadline ||
        !skills ||
        !Form_id
      ) {
        return res.status(400).json({ message: "All fields are required" });
      }

      const parsedSkills = JSON.parse(skills);

      const user1 = await User.findById(Form_id);
      if (!user1)
        return res
          .status(400)
          .json({ message: "User Not found Please Login Again" });

      const project = new Project({
        clientId: req.user.userId,
        title,
        description,
        budget,
        deadline,
        skillsRequired: parsedSkills,
        status: "open",
      });
      const user = await User.findById(req.user.userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      await project.save();
      await logActivity(req.user.userId, "Added a new project");
      res.status(200).json({
        message: "Project added successfully",
        email: user.email,
        username: user.username,
        projectId: project._id,
      });
    } catch (error) {
      console.log(error);
      res.status(500).send({ message: "Error adding project" });
    }
  }
);

router.get(
  "/get/wallet/:clientId",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    try {
      const { clientId } = req.params;
      // if (clientId !== req.user.userId)
      //   return res.status(401).json({ message: "Unauthorized" });

      const user = await User.findById(req.user.userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      // ── GLOBAL WALLET: single source of truth for balances ──
      const wallet = await Wallet.findOne({ userId: req.user.userId });
      const available_balance = wallet ? wallet.balance : 0;
      const escrow_balance = wallet ? wallet.escrowBalance : 0;

      // All WalletTransactions for this client (last 100)
      const walletTxns = await WalletTransaction.find({ userId: req.user.userId })
        .sort({ createdAt: -1 })
        .limit(100)
        .populate({ path: "referenceId", model: "Project", select: "title" })
        .lean();

      // Summaries from the immutable ledger
      const total_deposited = walletTxns
        .filter((t) => t.type === "deposit")
        .reduce((sum, t) => sum + t.amount, 0);

      const total_withdrawn = walletTxns
        .filter((t) => t.type === "withdrawal")
        .reduce((sum, t) => sum + t.amount, 0);

      const total_refunded = walletTxns
        .filter((t) => t.type === "escrow_refund")
        .reduce((sum, t) => sum + t.amount, 0);

      const transaction_history = walletTxns.map((t) => ({
        projectTitle: t.referenceId?.title || "N/A",
        projectId: t.referenceId?._id || "N/A",
        type: t.type,
        status: t.status,
        amount: t.amount,
        balanceAfter: t.balanceAfter,
        escrowBalanceAfter: t.escrowBalanceAfter,
        description: t.description,
        timestamp: t.createdAt,
      }));

      res.status(200).json({
        available_balance,     // free to withdraw
        escrow_balance,        // locked in active projects
        total_deposited,
        total_withdrawn,
        total_refunded,
        transaction_history,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error fetching wallet" });
    }
  }
);

router.put(
  "/projects/:projectId",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const project = await Project.findOne({
        _id: projectId,
        clientId: req.user.userId,
      });

      if (!project)
        return res.status(404).json({ message: "Project not found" });

      Object.assign(project, req.body);
      await project.save();
      await logActivity(req.user.userId, "Updated project");

      res.status(200).json({ message: "Project updated successfully" });
    } catch (error) {
      res.status(500).send({ message: "Error updating project" });
    }
  }
);

router.get(
  "/projects/:projectId/bids",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    try {
      const { projectId } = req.params;

      const project = await Project.findOne({
        _id: projectId,
        clientId: req.user.userId,
        status: "open",
      });

      if (!project)
        return res.status(404).json({
          message: "Freelancer already hired or project not found",
        });

      // Fetch bids for the given projectId and populate freelancer details
      const bids = await BidSchema.find({ projectId, status: "pending" })
        .populate({
          path: "freelancerId",
          select: "username resumeUrl profilePictureUrl",
        })
        .lean();

      // Filter bids based on resume permission
      const filteredBids = bids.map((bid) => {
        if (bid.resume_permission) {
          return bid;
        } else {
          const { resumeUrl, ...rest } = bid.freelancerId;
          return { ...bid, freelancerId: rest };
        }
      });

      // Send the filtered bids as response
      res.json({ bids: filteredBids });
    } catch (error) {
      console.error("Error fetching bids:", error); // Log the error
      res.status(500).send({ message: "Error fetching bids" });
    }
  }
);

router.get(
  "/projects/active",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    try {
      const projects = await Project.find({
        clientId: req.user.userId,
        status: { $in: ["in_progress", "pending_review"] },
      }).populate("freelancerId", "username");

      res.json({ projects });
    } catch (error) {
      res.status(500).send({ message: "Error fetching active projects" });
    }
  }
);

router.post(
  "/projects/:projectId/review",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const { rating, review } = req.body;

      const project = await Project.findOne({
        _id: projectId,
        clientId: req.user.userId,
        status: "completed",
      });

      if (!project)
        return res
          .status(404)
          .json({ message: "Project not found or not completed" });

      const reviewEntry = new ReviewSchema({
        reviewerId: req.user.userId,
        reviewedId: project.freelancerId,
        projectId,
        rating,
        comment: review,
      });

      await reviewEntry.save();

      await WorkHistory.findOneAndUpdate(
        { projectId },
        { rating, review },
        { upsert: true }
      );

      res.json({ message: "Review submitted successfully" });
    } catch (error) {
      res.status(500).send({ message: "Error submitting review" });
    }
  }
);

router.get(
  "/work-history",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    try {
      const history = await Project.find({ clientId: req.user.userId })
        .populate("freelancerId", "username")
        .populate("_id", "title");

      res.json({ history });
    } catch (error) {
      res.status(500).send({ message: "Error fetching work history" });
    }
  }
);

router.get(
  "/all/freelancers",
  verifyToken,
  authorize(["client"]),
  async (req, res) => {
    try {
      const freelancers = await User.find({ role: "freelancer" }).select(
        "username bio profilePictureUrl status"
      );

      const freelancerIds = freelancers.map((freelancer) => freelancer._id);

      // Fetch old projects and skills with only required fields
      const [oldProjects, userSkills] = await Promise.all([
        OldProjectsSchema.find({ freelancerId: { $in: freelancerIds } }).select(
          "title description frameworks link freelancerId"
        ),
        UserSkillSchema.find({ userId: { $in: freelancerIds } }).select(
          "skills.name skills.proficiency userId"
        ),
      ]);

      // Attach filtered old projects and skills to each freelancer
      const freelancerData = freelancers.map((freelancer) => {
        return {
          ...freelancer.toObject(),
          oldProjects: oldProjects
            .filter(
              (project) =>
                project.freelancerId.toString() === freelancer._id.toString()
            )
            .map(({ title, description, frameworks, link }) => ({
              title,
              description,
              frameworks,
              link,
            })),
          skills: userSkills
            .filter(
              (skill) => skill.userId.toString() === freelancer._id.toString()
            )
            .map(({ skills }) => skills),
        };
      });
      res.status(200).json({ freelancers: freelancerData });
    } catch (error) {
      console.error("Error fetching freelancers:", error);
      res.status(500).send({ message: "Error fetching freelancers" });
    }
  }
);

/// Pagenation Code
// router.get(
//   "/all/freelancers",
//   verifyToken,
//   authorize(["client"]),
//   async (req, res) => {
//     try {
//       const page = parseInt(req.query.page) || 1;
//       const limit = 12;
//       const skip = (page - 1) * limit;

//       const freelancers = await User.find({ role: "freelancer" })
//         .select("username bio profilePictureUrl status")
//         .skip(skip)
//         .limit(limit);

//       const freelancerIds = freelancers.map((freelancer) => freelancer._id);

//       const [oldProjects, userSkills] = await Promise.all([
//         OldProjectsSchema.find({ freelancerId: { $in: freelancerIds } }).select(
//           "title description frameworks link freelancerId"
//         ),
//         UserSkillSchema.find({ userId: { $in: freelancerIds } }).select(
//           "skills.name skills.proficiency userId"
//         ),
//       ]);

//       const freelancerData = freelancers.map((freelancer) => ({
//         ...freelancer.toObject(),
//         oldProjects: oldProjects
//           .filter(
//             (project) =>
//               project.freelancerId.toString() === freelancer._id.toString()
//           )
//           .map(({ title, description, frameworks, link }) => ({
//             title,
//             description,
//             frameworks,
//             link,
//           })),
//         skills: userSkills
//           .filter(
//             (skill) => skill.userId.toString() === freelancer._id.toString()
//           )
//           .map(({ skills }) => skills),
//       }));

//       const totalFreelancers = await User.countDocuments({
//         role: "freelancer",
//       });

//       res.json({
//         freelancers: freelancerData,
//         totalPages: Math.ceil(totalFreelancers / limit),
//         currentPage: page,
//       });
//     } catch (error) {
//       console.error("Error fetching freelancers:", error);
//       res.status(500).send({ message: "Error fetching freelancers" });
//     }
//   }
// );


module.exports = router;
