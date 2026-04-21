// ============================================================================
// ML Routes — /api/vi/ml
// End-to-end ML prediction endpoints
// Flow: Auth → Resolve data from MongoDB → Call Python ML API → Return result
// ============================================================================

const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/Auth");
const { resolveData } = require("../services/aiDataResolver");
const mlClient = require("../services/mlClient");

// MongoDB models needed for TLAM matching
const User = require("../models/User");
const Project = require("../models/Project");
const Bid = require("../models/Bid");
const Review = require("../models/Review");
const ContractReview = require("../models/ContractReview");
const SkillVerification = require("../models/SkillVerification");
const Agreement = require("../models/Agreement");

// ============================================================================
// GET /health — ML service health check
// ============================================================================

router.get("/health", async (_req, res) => {
  try {
    const mlHealth = await mlClient.healthCheck();
    const backendHealthy = true;

    return res.status(200).json({
      success: true,
      backend: { status: "healthy" },
      mlService: mlHealth,
      allHealthy: backendHealthy && mlHealth.available,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// ============================================================================
// GET /models — List available ML models and their required fields
// ============================================================================

router.get("/models", async (_req, res) => {
  try {
    const fields = await mlClient.getRequiredFields();
    return res.status(200).json({
      success: true,
      models: fields,
    });
  } catch (err) {
    // Return static info if ML service is down
    return res.status(200).json({
      success: true,
      mlServiceDown: true,
      models: {
        success_prediction: {
          description: "Predicts if a freelancer will succeed on a project",
          requiredParams: "freelancerId, projectId",
          endpoint: "POST /api/vi/ml/predict-success",
        },
        fake_profile_detection: {
          description: "Detects suspicious/fake freelancer profiles",
          requiredParams: "userId",
          endpoint: "POST /api/vi/ml/detect-fake",
        },
        freelancer_matching: {
          description: "Ranks freelancers for a project using ML scoring",
          requiredParams: "projectId OR skillsRequired[]",
          optionalParams: "scoring_method ('tlam' | 'weighted_sum'), limit",
          scoring_methods: {
            tlam: "Multiplicative (C^a)(R^b)(A^g) — strict, 0 if no skill match",
            weighted_sum: "Linear sum(w_i * f_i) — lenient, partial scores always",
          },
          endpoint: "POST /api/vi/ml/match-freelancers",
        },
      },
    });
  }
});

// ============================================================================
// POST /predict-success — Predict freelancer success on a project
// ============================================================================

router.post("/predict-success", verifyToken, async (req, res) => {
  try {
    const { freelancerId, projectId } = req.body;

    if (!freelancerId || !projectId) {
      return res.status(400).json({
        success: false,
        error: "Both freelancerId and projectId are required",
      });
    }

    // Step 1: Resolve data from MongoDB using existing aiDataResolver
    console.log(`🔮 ML: Resolving success prediction data for freelancer=${freelancerId}, project=${projectId}`);
    const resolvedData = await resolveData("predict_success", {
      freelancerId,
      projectId,
    });

    // Step 2: Call ML API with the resolved parameters
    console.log("📡 ML: Calling Python ML service for success prediction...");
    const mlResult = await mlClient.predictSuccess(resolvedData.parameters);

    // Step 3: Return enriched result
    return res.status(200).json({
      success: true,
      model: "success_prediction",
      prediction: mlResult.prediction,
      context: resolvedData.context,
      inputParameters: mlResult.input_parameters || resolvedData.parameters,
      model_info: mlResult.model_info || null,
    });
  } catch (err) {
    console.error("ML predict-success error:", err.message);
    return res.status(500).json({
      success: false,
      error: err.message,
      hint: "Make sure the Python ML API is running on port 5001",
    });
  }
});

// ============================================================================
// POST /detect-fake — Detect fake freelancer profile
// ============================================================================

router.post("/detect-fake", verifyToken, async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "userId is required",
      });
    }

    // Step 1: Resolve data from MongoDB
    console.log(`🔍 ML: Resolving fake detection data for user=${userId}`);
    const resolvedData = await resolveData("detect_fake_profile", { userId });

    // Step 2: Call ML API
    console.log("📡 ML: Calling Python ML service for fake detection...");
    const mlResult = await mlClient.detectFake(resolvedData.parameters);

    // Step 3: Return result
    return res.status(200).json({
      success: true,
      model: "fake_profile_detection",
      prediction: mlResult.prediction,
      context: resolvedData.context,
      inputParameters: mlResult.input_parameters || resolvedData.parameters,
      model_info: mlResult.model_info || null,
    });
  } catch (err) {
    console.error("ML detect-fake error:", err.message);
    return res.status(500).json({
      success: false,
      error: err.message,
      hint: "Make sure the Python ML API is running on port 5001",
    });
  }
});

// ============================================================================
// POST /match-freelancers — Freelancer-project matching (both models)
// scoring_method: 'tlam' (strict) or 'weighted_sum' (lenient)
// ============================================================================

router.post("/match-freelancers", verifyToken, async (req, res) => {
  try {
    const { projectId, skillsRequired, limit, scoring_method } = req.body;

    if (!projectId && (!skillsRequired || skillsRequired.length === 0)) {
      return res.status(400).json({
        success: false,
        error: "Provide either projectId or skillsRequired[]",
      });
    }

    // Step 1: Get project data
    let project;
    let skills = skillsRequired || [];

    if (projectId) {
      project = await Project.findById(projectId).lean();
      if (!project) {
        return res.status(404).json({
          success: false,
          error: "Project not found",
        });
      }
      skills = project.skillsRequired || skills;
    }

    if (skills.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No skills to match against. Project has no skillsRequired.",
      });
    }

    // Step 2: Find candidate freelancers from MongoDB
    const maxCandidates = Math.min((limit || 10) * 5, 100); // over-fetch

    const freelancerUsers = await User.find({
      role: "freelancer",
      isBanned: false,
      profileComplete: true,
      "skills.name": {
        $in: skills.map((s) => new RegExp(s, "i")),
      },
    })
      .select("-password")
      .limit(maxCandidates)
      .lean();

    if (freelancerUsers.length === 0) {
      return res.status(200).json({
        success: true,
        model: "tlam_matching",
        projectId: projectId || null,
        projectSkills: skills,
        totalCandidates: 0,
        matches: [],
        message: "No matching freelancers found",
      });
    }

    // Step 3: Enrich freelancer data for TLAM
    const enrichedFreelancers = await Promise.all(
      freelancerUsers.map(async (f) => {
        // Get ratings
        const [contractRatings, oldReviews] = await Promise.all([
          ContractReview.calculateAverageRatings(f._id).catch(() => null),
          Review.find({ reviewedId: String(f._id) })
            .select("rating")
            .lean()
            .catch(() => []),
        ]);

        const contractAvg = contractRatings?.avgOverall || 0;
        const contractCount = contractRatings?.totalReviews || 0;
        const oldAvg =
          oldReviews.length > 0
            ? oldReviews.reduce((s, r) => s + r.rating, 0) / oldReviews.length
            : 0;
        const oldCount = oldReviews.length;
        const totalReviewCount = contractCount + oldCount;
        const avgRating =
          totalReviewCount > 0
            ? (contractAvg * contractCount + oldAvg * oldCount) / totalReviewCount
            : 0;

        // Get completed projects
        const completedProjects = await Agreement.countDocuments({
          freelancerId: f._id,
          status: { $in: ["completed", "active"] },
        }).catch(() => 0);

        // Get total agreements for completion rate
        const totalAgreements = await Agreement.countDocuments({
          freelancerId: f._id,
        }).catch(() => 0);

        const completionRate =
          totalAgreements > 0 ? completedProjects / totalAgreements : 0.5;

        // Compute experience years
        let experienceYears = 0;
        if (f.experiences && f.experiences.length > 0) {
          experienceYears = f.experiences.reduce((sum, exp) => {
            const match = exp.period?.match(
              /(\d{4})\s*[-–]\s*(\d{4}|present)/i
            );
            if (match) {
              const start = parseInt(match[1]);
              const end =
                match[2].toLowerCase() === "present"
                  ? new Date().getFullYear()
                  : parseInt(match[2]);
              return sum + Math.max(end - start, 0);
            }
            return sum + 1;
          }, 0);
        }

        // Skills as string list
        const skillNames = (f.skills || []).map((s) => s.name || s).filter(Boolean);

        // Profile text for semantic matching
        const profileText = [f.title, f.bio, ...skillNames].filter(Boolean).join(" ");

        // Budget estimation from past bids
        const recentBid = await Bid.findOne({ freelancerId: f._id })
          .sort({ createdAt: -1 })
          .select("amount")
          .lean()
          .catch(() => null);

        return {
          id: f._id.toString(),
          skills: skillNames,
          profile_text: profileText,
          experience: experienceYears,
          rating: avgRating,
          completed_projects: completedProjects,
          success_rate: completionRate,
          interaction: Math.min(avgRating / 5, 1.0), // normalize rating as interaction proxy
          rate: recentBid ? recentBid.amount : 0,
        };
      })
    );

    // Step 4: Prepare project data for TLAM
    const projectData = {
      id: projectId || "custom",
      required_skills: skills,
      description: project?.description || skills.join(" "),
      budget: project?.budget || 0,
    };

    // Step 5: Call Python ML service for matching
    console.log(
      `ML: Matching ${enrichedFreelancers.length} freelancers [method=${scoring_method || "tlam"}] against project [${skills.join(", ")}]`
    );
    const matchResult = await mlClient.matchFreelancers(
      enrichedFreelancers,
      projectData,
      limit || 10,
      scoring_method || "tlam"
    );

    // Step 6: Enrich results with user details
    const userMap = {};
    freelancerUsers.forEach((f) => {
      userMap[f._id.toString()] = {
        username: f.username,
        title: f.title,
        profilePictureUrl: f.profilePictureUrl,
        location: f.location,
      };
    });

    if (matchResult.matches) {
      matchResult.matches = matchResult.matches.map((m) => ({
        ...m,
        user: userMap[m.freelancer_id] || null,
      }));
    }

    return res.status(200).json({
      success: true,
      ...matchResult,
    });
  } catch (err) {
    console.error("ML match-freelancers error:", err.message);
    return res.status(500).json({
      success: false,
      error: err.message,
      hint: "Make sure the Python ML API is running on port 5001",
    });
  }
});

// ============================================================================
// POST /predict-success/demo — Direct demo (no MongoDB, pass raw params)
// ============================================================================

router.post("/predict-success/demo", async (req, res) => {
  try {
    const { parameters } = req.body;

    if (!parameters) {
      return res.status(400).json({
        success: false,
        error: "Provide 'parameters' object with the 8 required fields",
        required: [
          "experience_years", "total_projects", "avg_rating", "completion_rate",
          "on_time_delivery_rate", "skill_match_score", "profile_completeness", "budget_ratio",
        ],
        example: {
          experience_years: 5.0,
          total_projects: 45,
          avg_rating: 4.7,
          completion_rate: 95,
          on_time_delivery_rate: 92,
          skill_match_score: 85,
          profile_completeness: 90,
          budget_ratio: 0.95,
        },
      });
    }

    const mlResult = await mlClient.predictSuccess(parameters);
    return res.status(200).json({ success: true, ...mlResult });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// ============================================================================
// POST /detect-fake/demo — Direct demo (no MongoDB, pass raw params)
// ============================================================================

router.post("/detect-fake/demo", async (req, res) => {
  try {
    const { parameters } = req.body;

    if (!parameters) {
      return res.status(400).json({
        success: false,
        error: "Provide 'parameters' object with the 9 required fields",
        required: [
          "profile_completeness", "total_skills", "avg_rating", "total_reviews",
          "total_projects", "account_age_days", "portfolio_items", "budget_ratio",
          "has_certifications",
        ],
        example: {
          profile_completeness: 20,
          total_skills: 35,
          avg_rating: 5.0,
          total_reviews: 1,
          total_projects: 0,
          account_age_days: 15,
          portfolio_items: 0,
          budget_ratio: 25,
          has_certifications: 0,
        },
      });
    }

    const mlResult = await mlClient.detectFake(parameters);
    return res.status(200).json({ success: true, ...mlResult });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// ============================================================================
// POST /match-freelancers/demo — Direct TLAM demo (no MongoDB)
// ============================================================================

router.post("/match-freelancers/demo", async (req, res) => {
  try {
    const { freelancers, project, limit, scoring_method } = req.body;

    if (!freelancers || !project) {
      return res.status(400).json({
        success: false,
        error: "Provide 'freelancers' array and 'project' object",
        scoring_methods: {
          tlam: "(default) Multiplicative — strict, 0 if no skill match",
          weighted_sum: "Linear — lenient, always gives partial scores",
        },
        example: {
          freelancers: [
            {
              id: "1",
              skills: ["react", "javascript", "css"],
              profile_text: "Experienced React developer",
              experience: 5,
              rating: 4.5,
              completed_projects: 20,
              success_rate: 0.85,
              interaction: 0.9,
              rate: 40,
            },
          ],
          project: {
            id: "101",
            required_skills: ["react", "frontend"],
            description: "Build a React frontend application",
            budget: 500,
          },
          scoring_method: "tlam",
          limit: 10,
        },
      });
    }

    const matchResult = await mlClient.matchFreelancers(freelancers, project, limit || 10, scoring_method || "tlam");
    return res.status(200).json({ success: true, ...matchResult });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

module.exports = router;
