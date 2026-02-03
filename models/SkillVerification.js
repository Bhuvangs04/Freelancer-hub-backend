const mongoose = require("mongoose");

// ============================================================================
// GITHUB DATA SUB-SCHEMA
// ============================================================================

const GitHubDataSchema = new mongoose.Schema(
  {
    username: { type: String, required: true },
    profileUrl: { type: String },
    avatarUrl: { type: String },
    publicRepos: { type: Number, default: 0 },
    followers: { type: Number, default: 0 },
    following: { type: Number, default: 0 },
    totalCommits: { type: Number, default: 0 },
    accountAge: { type: Number }, // in months
    languages: [{
      name: { type: String },
      percentage: { type: Number },
      bytes: { type: Number },
    }],
    topRepositories: [{
      name: { type: String },
      url: { type: String },
      stars: { type: Number },
      forks: { type: Number },
      language: { type: String },
    }],
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
 */
SkillVerificationSchema.methods.calculateScore = function () {
  let score = 0;

  // GitHub contribution (max 40 points)
  if (this.githubVerification) {
    const gh = this.githubVerification;
    score += Math.min(gh.publicRepos * 2, 10); // repos
    score += Math.min(gh.totalCommits / 100, 15); // commits
    score += Math.min(gh.followers / 10, 10); // followers
    score += Math.min(gh.accountAge / 2, 5); // account age
  }

  // Challenge (max 30 points)
  if (this.challengeResult && this.challengeResult.passed) {
    score += (this.challengeResult.score / 100) * 30;
  }

  // Portfolio (max 20 points)
  if (this.portfolioVerification && this.portfolioVerification.verifiedAt) {
    score += 20;
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
