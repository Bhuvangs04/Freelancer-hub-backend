const mongoose = require("mongoose");

// ============================================================================
// GITHUB DATA SUB-SCHEMA (Comprehensive - Authenticated API)
// ============================================================================

const GitHubRepoSchema = new mongoose.Schema(
  {
    name: { type: String },
    fullName: { type: String },
    url: { type: String },
    description: { type: String },
    private: { type: Boolean, default: false },
    fork: { type: Boolean, default: false },
    stars: { type: Number, default: 0 },
    forks: { type: Number, default: 0 },
    watchers: { type: Number, default: 0 },
    openIssues: { type: Number, default: 0 },
    language: { type: String },
    topics: [{ type: String }],
    license: { type: String },
    defaultBranch: { type: String },
    size: { type: Number, default: 0 },
    // Content analysis flags
    hasReadme: { type: Boolean, default: false },
    hasCI: { type: Boolean, default: false },
    hasDocker: { type: Boolean, default: false },
    hasTests: { type: Boolean, default: false },
    // Timestamps
    createdAt: { type: Date },
    updatedAt: { type: Date },
    pushedAt: { type: Date },
  },
  { _id: false }
);

const GitHubDataSchema = new mongoose.Schema(
  {
    // Profile
    username: { type: String, required: true },
    profileUrl: { type: String },
    avatarUrl: { type: String },
    name: { type: String },
    bio: { type: String },
    email: { type: String },
    hireable: { type: Boolean },
    company: { type: String },
    blog: { type: String },
    twitterUsername: { type: String },
    location: { type: String },

    // Repo counts
    publicRepos: { type: Number, default: 0 },
    privateRepos: { type: Number, default: 0 },
    totalRepos: { type: Number, default: 0 },

    // Social
    followers: { type: Number, default: 0 },
    following: { type: Number, default: 0 },

    // Contributions
    totalContributions: { type: Number, default: 0 },
    totalCommits: { type: Number, default: 0 },
    commitFrequency: { type: Number, default: 0 }, // avg commits per week

    // PRs
    pullRequests: {
      total: { type: Number, default: 0 },
      merged: { type: Number, default: 0 },
      open: { type: Number, default: 0 },
    },

    // Issues
    issues: {
      total: { type: Number, default: 0 },
      open: { type: Number, default: 0 },
      closed: { type: Number, default: 0 },
    },

    // Organizations
    organizations: [
      {
        name: { type: String },
        avatarUrl: { type: String },
      },
    ],

    // Account meta
    accountAge: { type: Number }, // in months
    accountCreatedAt: { type: Date },

    // Languages
    languages: [
      {
        name: { type: String },
        percentage: { type: Number },
        bytes: { type: Number },
      },
    ],

    // Top Repositories (detailed)
    topRepositories: [GitHubRepoSchema],

    // Extras
    gistsCount: { type: Number, default: 0 },
    releasesCount: { type: Number, default: 0 },

    lastFetchedAt: { type: Date },
  },
  { _id: false }
);

// ============================================================================
// CHALLENGE RESULT SUB-SCHEMA
// ============================================================================

const ChallengeResultSchema = new mongoose.Schema(
  {
    challengeId: { type: String, required: true },
    challengeTitle: { type: String },
    skillTested: { type: String },
    difficulty: { type: String, enum: ["beginner", "intermediate", "advanced"] },
    score: { type: Number, min: 0, max: 100 },
    passed: { type: Boolean },
    passingScore: { type: Number, default: 70 },
    timeTaken: { type: Number }, // in seconds
    completedAt: { type: Date },
    attempts: { type: Number, default: 1 },
  },
  { _id: false }
);

// ============================================================================
// PORTFOLIO VERIFICATION SUB-SCHEMA
// ============================================================================

const PortfolioVerificationSchema = new mongoose.Schema(
  {
    portfolioUrl: { type: String, required: true },
    projectName: { type: String },
    description: { type: String },
    screenshotUrl: { type: String },
    verificationMethod: {
      type: String,
      enum: ["domain_ownership", "code_access", "manual_review"],
    },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
    verifiedAt: { type: Date },
    notes: { type: String },
  },
  { _id: false }
);

// ============================================================================
// MAIN SKILL VERIFICATION SCHEMA
// ============================================================================

const SkillVerificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    skillName: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    skillCategory: {
      type: String,
      enum: ["programming", "design", "writing", "marketing", "video", "audio", "other"],
      default: "other",
    },

    // Verification Types
    verificationType: {
      type: String,
      enum: ["github", "challenge", "portfolio", "certificate", "combined"],
      required: true,
    },

    // Verification Data
    githubVerification: GitHubDataSchema,
    challengeResult: ChallengeResultSchema,
    portfolioVerification: PortfolioVerificationSchema,
    certificateUrl: { type: String },

    // Status
    status: {
      type: String,
      enum: ["pending", "verified", "rejected", "expired"],
      default: "pending",
      index: true,
    },
    verificationScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },

    // Verification Level
    level: {
      type: String,
      enum: ["basic", "intermediate", "advanced", "expert"],
      default: "basic",
    },

    // Timestamps
    verifiedAt: { type: Date },
    expiresAt: { type: Date },
    lastUpdatedAt: { type: Date },
  },
  { timestamps: true }
);

// ============================================================================
// INDEXES
// ============================================================================

SkillVerificationSchema.index({ userId: 1, skillName: 1 }, { unique: true });
SkillVerificationSchema.index({ skillName: 1, status: 1, level: -1 });

// ============================================================================
// INSTANCE METHODS
// ============================================================================

/**
 * Calculate verification score based on all data
 * GitHub (max 50), Challenge (max 25), Portfolio (max 15), Certificate (max 10)
 */
SkillVerificationSchema.methods.calculateScore = function () {
  let score = 0;

  // GitHub contribution (max 50 points)
  if (this.githubVerification) {
    const gh = this.githubVerification;

    // Repos (max 10)
    score += Math.min(gh.publicRepos * 1.5 + (gh.privateRepos || 0) * 2, 10);

    // Commits / Contributions (max 15)
    const commitScore = Math.min((gh.totalCommits || 0) / 200, 8);
    const contribScore = Math.min((gh.totalContributions || 0) / 500, 7);
    score += Math.min(commitScore + contribScore, 15);

    // Followers (max 5)
    score += Math.min((gh.followers || 0) / 20, 5);

    // Account age (max 5)
    score += Math.min((gh.accountAge || 0) / 6, 5);

    // Pull Requests (max 8)
    if (gh.pullRequests) {
      score += Math.min((gh.pullRequests.total || 0) / 25, 5);
      score += Math.min((gh.pullRequests.merged || 0) / 20, 3);
    }

    // Organizations (max 4)
    if (gh.organizations) {
      score += Math.min(gh.organizations.length * 2, 4);
    }

    // Issues (max 3)
    if (gh.issues) {
      score += Math.min((gh.issues.total || 0) / 20, 3);
    }
  }

  // Challenge (max 25 points)
  if (this.challengeResult && this.challengeResult.passed) {
    score += (this.challengeResult.score / 100) * 25;
  }

  // Portfolio (max 15 points)
  if (this.portfolioVerification && this.portfolioVerification.verifiedAt) {
    score += 15;
  }

  // Certificate (max 10 points)
  if (this.certificateUrl) {
    score += 10;
  }

  this.verificationScore = Math.min(Math.round(score), 100);

  // Determine level
  if (this.verificationScore >= 80) {
    this.level = "expert";
  } else if (this.verificationScore >= 60) {
    this.level = "advanced";
  } else if (this.verificationScore >= 40) {
    this.level = "intermediate";
  } else {
    this.level = "basic";
  }

  return this.verificationScore;
};

/**
 * Mark as verified
 */
SkillVerificationSchema.methods.verify = async function () {
  this.status = "verified";
  this.verifiedAt = new Date();
  // Verification valid for 1 year
  this.expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  this.lastUpdatedAt = new Date();
  this.calculateScore();
  return this.save();
};

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Get verified skills for a user
 */
SkillVerificationSchema.statics.getVerifiedSkills = async function (userId) {
  return this.find({
    userId,
    status: "verified",
    expiresAt: { $gt: new Date() },
  }).sort({ verificationScore: -1 });
};

/**
 * Search users by verified skill
 */
SkillVerificationSchema.statics.findBySkill = async function (skillName, minLevel = "basic") {
  const levelOrder = { basic: 1, intermediate: 2, advanced: 3, expert: 4 };
  const minLevelNum = levelOrder[minLevel] || 1;

  const results = await this.find({
    skillName: skillName.toLowerCase(),
    status: "verified",
    expiresAt: { $gt: new Date() },
  })
    .populate("userId", "username profilePictureUrl title")
    .sort({ verificationScore: -1 });

  return results.filter(r => (levelOrder[r.level] || 1) >= minLevelNum);
};

module.exports = mongoose.model("SkillVerification", SkillVerificationSchema);
