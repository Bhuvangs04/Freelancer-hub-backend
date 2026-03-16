// ============================================================================
// AI Data Resolver Service
// Fetches the right data from MongoDB based on the AI service's action type
// ============================================================================

const User = require("../models/User");
const Project = require("../models/Project");
const Bid = require("../models/Bid");
const Review = require("../models/Review");
const ContractReview = require("../models/ContractReview");
const SkillVerification = require("../models/SkillVerification");
const Agreement = require("../models/Agreement");
const Ongoing = require("../models/OnGoingProject.Schema");
const Wallet = require("../models/Wallet");
const Milestone = require("../models/Milestone");

// ============================================================================
// SUPPORTED ACTIONS
// ============================================================================

const SUPPORTED_ACTIONS = [
  "recommend_freelancers",
  "recommend_projects",
  "detect_fake_account",
  "get_user_profile",
  "get_project_details",
  "predict_success",
  "detect_fake_profile",
];

// ============================================================================
// MAIN DISPATCHER
// ============================================================================

/**
 * Resolve data for a given AI action.
 * @param {string} action - The action type
 * @param {object} params - Parameters from the AI service
 * @returns {object} The resolved data
 */
async function resolveData(action, params) {
  switch (action) {
    case "recommend_freelancers":
      return resolveRecommendFreelancers(params);
    case "recommend_projects":
      return resolveRecommendProjects(params);
    case "detect_fake_account":
      return resolveDetectFakeAccount(params);
    case "get_user_profile":
      return resolveUserProfile(params);
    case "get_project_details":
      return resolveProjectDetails(params);
    case "predict_success":
      return resolvePredictSuccess(params);
    case "detect_fake_profile":
      return resolveDetectFakeProfile(params);
    default:
      throw new Error(`Unsupported action: ${action}`);
  }
}

// ============================================================================
// ACTION RESOLVERS
// ============================================================================

/**
 * Fetch top freelancers matching a project's required skills.
 * Returns freelancer profiles, skill verifications, ratings, and completed projects.
 *
 * Required params: { projectId } OR { skillsRequired: string[] }
 */
async function resolveRecommendFreelancers(params) {
  let skillsRequired = params.skillsRequired || [];

  // If projectId provided, extract skills from the project
  if (params.projectId && skillsRequired.length === 0) {
    const project = await Project.findById(params.projectId).lean();
    if (!project) throw new Error("Project not found");
    skillsRequired = project.skillsRequired || [];
  }

  if (skillsRequired.length === 0) {
    throw new Error("No skills provided. Pass projectId or skillsRequired[]");
  }

  const limit = params.limit || 20;

  // Find freelancers whose skills overlap with the required skills
  const freelancers = await User.find({
    role: "freelancer",
    isBanned: false,
    profileComplete: true,
    "skills.name": {
      $in: skillsRequired.map((s) => new RegExp(s, "i")),
    },
  })
    .select("-password")
    .limit(limit * 2) // Over-fetch to allow enrichment filtering
    .lean();

  // Enrich each freelancer with ratings and verifications
  const enriched = await Promise.all(
    freelancers.map(async (f) => {
      const [ratings, verifications, completedProjects] = await Promise.all([
        ContractReview.calculateAverageRatings(f._id).catch(() => null),
        SkillVerification.getVerifiedSkills(f._id).catch(() => []),
        Agreement.countDocuments({
          freelancerId: f._id,
          status: { $in: ["completed", "active"] },
        }).catch(() => 0),
      ]);

      return {
        userId: f._id,
        username: f.username,
        email: f.email,
        title: f.title,
        bio: f.bio,
        location: f.location,
        skills: f.skills,
        profilePictureUrl: f.profilePictureUrl,
        githubData: f.githubData || null,
        ratings: ratings || {},
        verifiedSkills: verifications.map((v) => ({
          skillName: v.skillName,
          level: v.level,
          score: v.verificationScore,
          status: v.status,
        })),
        completedProjects,
        accountCreatedAt: f.createdAt,
      };
    })
  );

  return {
    skillsSearched: skillsRequired,
    totalFound: enriched.length,
    freelancers: enriched.slice(0, limit),
  };
}

/**
 * Fetch open projects that match a freelancer's skills.
 *
 * Required params: { freelancerId } OR { skills: string[] }
 */
async function resolveRecommendProjects(params) {
  let skills = params.skills || [];

  // If freelancerId provided, extract skills from their profile
  if (params.freelancerId && skills.length === 0) {
    const freelancer = await User.findById(params.freelancerId)
      .select("skills")
      .lean();
    if (!freelancer) throw new Error("Freelancer not found");
    skills = (freelancer.skills || []).map((s) => s.name);
  }

  if (skills.length === 0) {
    throw new Error("No skills provided. Pass freelancerId or skills[]");
  }

  const limit = params.limit || 20;

  const projects = await Project.find({
    status: "open",
    skillsRequired: {
      $in: skills.map((s) => new RegExp(s, "i")),
    },
  })
    .populate("clientId", "username companyName Industry profilePictureUrl")
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  // Enrich with bid count
  const enriched = await Promise.all(
    projects.map(async (p) => {
      const bidCount = await Bid.countDocuments({ projectId: p._id }).catch(
        () => 0
      );
      return {
        projectId: p._id,
        title: p.title,
        description: p.description,
        budget: p.budget,
        deadline: p.deadline,
        skillsRequired: p.skillsRequired,
        status: p.status,
        client: p.clientId || null,
        bidCount,
        createdAt: p.createdAt,
      };
    })
  );

  return {
    skillsSearched: skills,
    totalFound: enriched.length,
    projects: enriched,
  };
}

/**
 * Fetch comprehensive data for fake account detection.
 * Returns everything the AI model needs to assess legitimacy.
 *
 * Required params: { userId }
 */
async function resolveDetectFakeAccount(params) {
  if (!params.userId) throw new Error("userId is required");

  const user = await User.findById(params.userId).select("-password").lean();
  if (!user) throw new Error("User not found");

  const [
    ratings,
    reviews,
    verifications,
    completedContracts,
    totalProjects,
    totalBids,
    wallet,
    ongoingProjects,
    crs,
  ] = await Promise.all([
    ContractReview.calculateAverageRatings(user._id).catch(() => null),
    ContractReview.find({ revieweeId: user._id })
      .select("overallRating comment type createdAt wasDisputed")
      .sort({ createdAt: -1 })
      .limit(20)
      .lean()
      .catch(() => []),
    SkillVerification.find({ userId: user._id }).lean().catch(() => []),
    Agreement.countDocuments({
      $or: [{ clientId: user._id }, { freelancerId: user._id }],
      status: { $in: ["completed", "active"] },
    }).catch(() => 0),
    Project.countDocuments({
      $or: [{ clientId: user._id }, { freelancerId: user._id }],
    }).catch(() => 0),
    Bid.countDocuments({ freelancerId: user._id }).catch(() => 0),
    Wallet.findOne({ userId: user._id })
      .select("balance escrowBalance withdrawalsBlocked currency")
      .lean()
      .catch(() => null),
    Ongoing.countDocuments({
      $or: [{ clientId: String(user._id) }, { freelancerId: String(user._id) }],
    }).catch(() => 0),
    ContractReview.calculateCRS(user._id).catch(() => null),
  ]);

  return {
    user: {
      userId: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
      bio: user.bio,
      location: user.location,
      skills: user.skills,
      experiences: user.experiences,
      profileComplete: user.profileComplete,
      isBanned: user.isBanned,
      Strikes: user.Strikes,
      profilePictureUrl: user.profilePictureUrl,
      resumeUrl: user.resumeUrl,
      githubUsername: user.githubUsername,
      githubData: user.githubData || null,
      accountCreatedAt: user.createdAt,
      lastUpdated: user.updatedAt,
    },
    activityMetrics: {
      completedContracts,
      totalProjects,
      totalBids,
      ongoingProjects,
    },
    wallet: wallet
      ? {
          balance: wallet.balance,
          escrowBalance: wallet.escrowBalance,
          withdrawalsBlocked: wallet.withdrawalsBlocked,
        }
      : null,
    ratings: ratings || {},
    contractReliabilityScore: crs,
    recentReviews: reviews,
    skillVerifications: verifications.map((v) => ({
      skillName: v.skillName,
      category: v.skillCategory,
      verificationType: v.verificationType,
      level: v.level,
      score: v.verificationScore,
      status: v.status,
      hasGithub: !!v.githubVerification,
      hasChallenge: !!v.challengeResult,
      hasPortfolio: !!v.portfolioVerification,
      hasCertificate: !!v.certificateUrl,
    })),
  };
}

/**
 * Fetch a user's profile with reviews and skill verifications.
 *
 * Required params: { userId }
 */
async function resolveUserProfile(params) {
  if (!params.userId) throw new Error("userId is required");

  const user = await User.findById(params.userId).select("-password").lean();
  if (!user) throw new Error("User not found");

  const [ratings, reviews, verifications] = await Promise.all([
    ContractReview.calculateAverageRatings(user._id).catch(() => null),
    ContractReview.getReviewsForUser(user._id, { limit: 10 }).catch(() => []),
    SkillVerification.getVerifiedSkills(user._id).catch(() => []),
  ]);

  return {
    user: {
      userId: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
      bio: user.bio,
      title: user.title,
      location: user.location,
      skills: user.skills,
      experiences: user.experiences,
      profilePictureUrl: user.profilePictureUrl,
      githubData: user.githubData || null,
      accountCreatedAt: user.createdAt,
    },
    ratings: ratings || {},
    recentReviews: reviews,
    verifiedSkills: verifications.map((v) => ({
      skillName: v.skillName,
      level: v.level,
      score: v.verificationScore,
      status: v.status,
    })),
  };
}

/**
 * Fetch full project context — project, bids, agreement, ongoing data.
 *
 * Required params: { projectId }
 */
async function resolveProjectDetails(params) {
  if (!params.projectId) throw new Error("projectId is required");

  const project = await Project.findById(params.projectId)
    .populate("clientId", "username companyName Industry profilePictureUrl")
    .populate("freelancerId", "username title profilePictureUrl")
    .lean();

  if (!project) throw new Error("Project not found");

  const [bids, agreement, ongoing] = await Promise.all([
    Bid.find({ projectId: project._id })
      .populate("freelancerId", "username title profilePictureUrl skills")
      .lean()
      .catch(() => []),
    Agreement.getCurrentAgreementForProject(project._id)
      .then((a) => (a ? a.toObject() : null))
      .catch(() => null),
    Ongoing.findOne({ projectId: String(project._id) })
      .lean()
      .catch(() => null),
  ]);

  return {
    project: {
      projectId: project._id,
      title: project.title,
      description: project.description,
      budget: project.budget,
      status: project.status,
      deadline: project.deadline,
      skillsRequired: project.skillsRequired,
      client: project.clientId || null,
      freelancer: project.freelancerId || null,
      createdAt: project.createdAt,
    },
    bids: bids.map((b) => ({
      bidId: b._id,
      freelancer: b.freelancerId || null,
      amount: b.amount,
      message: b.message,
      status: b.status,
      createdAt: b.createdAt,
    })),
    agreement: agreement
      ? {
          agreementId: agreement._id,
          agreementNumber: agreement.agreementNumber,
          agreedAmount: agreement.agreedAmount,
          status: agreement.status,
          version: agreement.version,
          deadline: agreement.deadline,
          clientSigned: agreement.clientSignature?.signed || false,
          freelancerSigned: agreement.freelancerSignature?.signed || false,
        }
      : null,
    ongoingProject: ongoing
      ? {
          status: ongoing.status,
          progress: ongoing.progress,
          tasksCount: (ongoing.tasks || []).length,
          tasksCompleted: (ongoing.tasks || []).filter((t) => t.completed)
            .length,
          filesCount: (ongoing.files || []).length,
        }
      : null,
  };
}

// ============================================================================
// AI MODEL-SPECIFIC RESOLVERS
// ============================================================================

/**
 * Success Prediction — compute the exact parameters the AI model expects.
 *
 * Required params: { freelancerId, projectId }
 *
 * Returns: experience_years, total_projects, avg_rating, completion_rate,
 *          on_time_delivery_rate, skill_match_score, profile_completeness,
 *          budget_ratio
 */
async function resolvePredictSuccess(params) {
  if (!params.freelancerId) throw new Error("freelancerId is required");
  if (!params.projectId) throw new Error("projectId is required");

  const [user, project] = await Promise.all([
    User.findById(params.freelancerId).select("-password").lean(),
    Project.findById(params.projectId).lean(),
  ]);

  if (!user) throw new Error("Freelancer not found");
  if (!project) throw new Error("Project not found");

  // ── experience_years ────────────────────────────────────────────────────
  let experienceYears = 0;
  if (user.experiences && user.experiences.length > 0) {
    experienceYears = user.experiences.reduce((sum, exp) => {
      // Try to parse period like "2020-2023" or "2 years"
      const match = exp.period?.match(/(\d{4})\s*[-–]\s*(\d{4}|present)/i);
      if (match) {
        const start = parseInt(match[1]);
        const end = match[2].toLowerCase() === "present"
          ? new Date().getFullYear()
          : parseInt(match[2]);
        return sum + Math.max(end - start, 0);
      }
      // Fallback: try "X years"
      const yearsMatch = exp.period?.match(/(\d+)\s*year/i);
      if (yearsMatch) return sum + parseInt(yearsMatch[1]);
      return sum + 1; // default 1 year per experience entry
    }, 0);
  }
  // Also consider account age as min baseline
  const accountAgeYears = (Date.now() - new Date(user.createdAt).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  experienceYears = Math.max(experienceYears, Math.round(accountAgeYears * 10) / 10);

  // ── total_projects ──────────────────────────────────────────────────────
  const totalProjects = await Agreement.countDocuments({
    freelancerId: user._id,
    status: { $in: ["completed", "active"] },
  }).catch(() => 0);

  // ── avg_rating ──────────────────────────────────────────────────────────
  // Check BOTH ContractReview and the older Review model
  const [contractRatings, oldReviews] = await Promise.all([
    ContractReview.calculateAverageRatings(user._id).catch(() => null),
    Review.find({ reviewedId: String(user._id) }).select("rating").lean().catch(() => []),
  ]);
  const contractAvg = contractRatings?.avgOverall || 0;
  const contractCount = contractRatings?.totalReviews || 0;
  const oldAvg = oldReviews.length > 0
    ? oldReviews.reduce((sum, r) => sum + r.rating, 0) / oldReviews.length
    : 0;
  const oldCount = oldReviews.length;
  // Weighted average across both sources
  const totalReviewCount = contractCount + oldCount;
  const avgRating = totalReviewCount > 0
    ? Math.round(((contractAvg * contractCount + oldAvg * oldCount) / totalReviewCount) * 10) / 10
    : 0;

  // ── completion_rate ─────────────────────────────────────────────────────
  const totalAgreements = await Agreement.countDocuments({
    freelancerId: user._id,
  }).catch(() => 0);
  const completedAgreements = await Agreement.countDocuments({
    freelancerId: user._id,
    status: "completed",
  }).catch(() => 0);
  const completionRate = totalAgreements > 0
    ? Math.round((completedAgreements / totalAgreements) * 100 * 10) / 10
    : 100; // New freelancers get benefit of doubt

  // ── on_time_delivery_rate ───────────────────────────────────────────────
  const milestones = await Milestone.find({
    freelancerId: user._id,
    status: { $in: ["confirmed", "released"] },
  }).select("daysLate daysEarly").lean().catch(() => []);

  let onTimeDeliveryRate = 100;
  if (milestones.length > 0) {
    const onTime = milestones.filter((m) => (m.daysLate || 0) === 0).length;
    onTimeDeliveryRate = Math.round((onTime / milestones.length) * 100 * 10) / 10;
  }

  // ── skill_match_score ───────────────────────────────────────────────────
  // Include skills from BOTH user profile AND SkillVerification
  const userSkills = (user.skills || []).map((s) => s.name?.toLowerCase()).filter(Boolean);
  const verifiedDocs = await SkillVerification.find({ userId: user._id })
    .select("skillName")
    .lean()
    .catch(() => []);
  const verifiedNames = verifiedDocs.map((v) => v.skillName?.toLowerCase()).filter(Boolean);
  const freelancerSkills = [...new Set([...userSkills, ...verifiedNames])];

  const projectSkills = (project.skillsRequired || []).map((s) => s.toLowerCase());
  let matchCount = 0;
  for (const ps of projectSkills) {
    if (freelancerSkills.some((fs) => fs.includes(ps) || ps.includes(fs))) {
      matchCount++;
    }
  }
  const skillMatchScore = projectSkills.length > 0
    ? Math.round((matchCount / projectSkills.length) * 100 * 10) / 10
    : 0;

  // ── profile_completeness ────────────────────────────────────────────────
  let profileFields = 0;
  let filledFields = 0;
  const checks = [
    user.profilePictureUrl,
    user.resumeUrl,
    user.bio,
    user.skills && user.skills.length > 0,
    user.experiences && user.experiences.length > 0,
    user.location && user.location !== "Not specified",
    user.title && user.title !== "Freelancer",
    user.githubUsername,
  ];
  profileFields = checks.length;
  filledFields = checks.filter(Boolean).length;
  const profileCompleteness = Math.round((filledFields / profileFields) * 100 * 10) / 10;

  // ── budget_ratio ────────────────────────────────────────────────────────
  // Freelancer's bid amount vs project budget
  const bid = await Bid.findOne({
    projectId: project._id,
    freelancerId: user._id,
  }).select("amount").lean().catch(() => null);

  const budgetRatio = bid && project.budget > 0
    ? Math.round((bid.amount / project.budget) * 100) / 100
    : 1.0;

  return {
    model: "success_prediction",
    parameters: {
      experience_years: Math.round(experienceYears * 10) / 10,
      total_projects: totalProjects,
      avg_rating: avgRating,
      completion_rate: completionRate,
      on_time_delivery_rate: onTimeDeliveryRate,
      skill_match_score: skillMatchScore,
      profile_completeness: profileCompleteness,
      budget_ratio: budgetRatio,
    },
    context: {
      freelancerId: user._id,
      freelancerUsername: user.username,
      projectId: project._id,
      projectTitle: project.title,
    },
  };
}

/**
 * Fake Profile Detection — compute the exact parameters the AI model expects.
 *
 * Required params: { userId }
 *
 * Returns: profile_completeness, total_skills, avg_rating, total_reviews,
 *          total_projects, account_age_days, portfolio_items, budget_ratio,
 *          has_certifications
 */
async function resolveDetectFakeProfile(params) {
  if (!params.userId) throw new Error("userId is required");

  const user = await User.findById(params.userId).select("-password").lean();
  if (!user) throw new Error("User not found");

  // ── profile_completeness ────────────────────────────────────────────────
  const checks = [
    user.profilePictureUrl,
    user.resumeUrl,
    user.bio,
    user.skills && user.skills.length > 0,
    user.experiences && user.experiences.length > 0,
    user.location && user.location !== "Not specified",
    user.title && user.title !== "Freelancer",
    user.githubUsername,
  ];
  const profileCompleteness = Math.round((checks.filter(Boolean).length / checks.length) * 100 * 10) / 10;

  // ── total_skills ────────────────────────────────────────────────────────
  // Count unique skills from BOTH user profile AND SkillVerification collection
  const userSkillNames = (user.skills || []).map((s) => s.name?.toLowerCase()).filter(Boolean);
  const verifiedSkillDocs = await SkillVerification.find({ userId: user._id })
    .select("skillName")
    .lean()
    .catch(() => []);
  const verifiedSkillNames = verifiedSkillDocs.map((v) => v.skillName?.toLowerCase()).filter(Boolean);
  // Merge into a unique set
  const allSkills = new Set([...userSkillNames, ...verifiedSkillNames]);
  const totalSkills = allSkills.size;

  // ── avg_rating + total_reviews ──────────────────────────────────────────
  // Check BOTH ContractReview and the older Review model
  const [contractRatings, oldReviews] = await Promise.all([
    ContractReview.calculateAverageRatings(user._id).catch(() => null),
    Review.find({ reviewedId: String(user._id) }).select("rating").lean().catch(() => []),
  ]);
  const contractAvg = contractRatings?.avgOverall || 0;
  const contractCount = contractRatings?.totalReviews || 0;
  const oldAvg = oldReviews.length > 0
    ? oldReviews.reduce((sum, r) => sum + r.rating, 0) / oldReviews.length
    : 0;
  const oldCount = oldReviews.length;
  // Weighted average across both sources
  const totalReviews = contractCount + oldCount;
  const avgRating = totalReviews > 0
    ? Math.round(((contractAvg * contractCount + oldAvg * oldCount) / totalReviews) * 10) / 10
    : 0;

  // ── total_projects ──────────────────────────────────────────────────────
  const totalProjects = await Agreement.countDocuments({
    $or: [{ clientId: user._id }, { freelancerId: user._id }],
    status: { $in: ["completed", "active"] },
  }).catch(() => 0);

  // ── account_age_days ────────────────────────────────────────────────────
  const accountAgeDays = Math.floor(
    (Date.now() - new Date(user.createdAt).getTime()) / (24 * 60 * 60 * 1000)
  );

  // ── portfolio_items ─────────────────────────────────────────────────────
  const portfolioVerifications = await SkillVerification.countDocuments({
    userId: user._id,
    portfolioVerification: { $exists: true, $ne: null },
  }).catch(() => 0);
  // Also count user's portfolio URL as 1 if present
  const portfolioItems = portfolioVerifications + (user.portflio ? 1 : 0);

  // ── budget_ratio ────────────────────────────────────────────────────────
  // Average bid amount / average project budget for this user
  const bids = await Bid.find({ freelancerId: user._id })
    .select("amount projectId")
    .lean()
    .catch(() => []);

  let budgetRatio = 1.0;
  if (bids.length > 0) {
    const projectIds = bids.map((b) => b.projectId);
    const projects = await Project.find({ _id: { $in: projectIds } })
      .select("budget")
      .lean()
      .catch(() => []);

    const budgetMap = {};
    projects.forEach((p) => { budgetMap[p._id.toString()] = p.budget; });

    let totalRatio = 0;
    let validCount = 0;
    for (const b of bids) {
      const pBudget = budgetMap[b.projectId?.toString()];
      if (pBudget && pBudget > 0) {
        totalRatio += b.amount / pBudget;
        validCount++;
      }
    }
    budgetRatio = validCount > 0 ? Math.round((totalRatio / validCount) * 100) / 100 : 1.0;
  }

  // ── has_certifications ──────────────────────────────────────────────────
  const certCount = await SkillVerification.countDocuments({
    userId: user._id,
    certificateUrl: { $exists: true, $ne: null },
  }).catch(() => 0);
  const hasCertifications = certCount > 0 ? 1 : 0;

  return {
    model: "fake_profile_detection",
    parameters: {
      profile_completeness: profileCompleteness,
      total_skills: totalSkills,
      avg_rating: avgRating,
      total_reviews: totalReviews,
      total_projects: totalProjects,
      account_age_days: accountAgeDays,
      portfolio_items: portfolioItems,
      budget_ratio: budgetRatio,
      has_certifications: hasCertifications,
    },
    context: {
      userId: user._id,
      username: user.username,
      role: user.role,
      isBanned: user.isBanned,
      accountCreatedAt: user.createdAt,
    },
  };
}

module.exports = {
  resolveData,
  SUPPORTED_ACTIONS,
};
