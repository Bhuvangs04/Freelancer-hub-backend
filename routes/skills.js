const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { verifyToken, authorize } = require("../middleware/Auth");
const SkillVerification = require("../models/SkillVerification");
const Activity = require("../models/ActionSchema");

// ============================================================================
// GITHUB PUBLIC API (No auth, 60 req/hour limit)
// ============================================================================

const fetchGitHubProfile = async (username) => {
  try {
    const userResponse = await fetch(`https://api.github.com/users/${username}`, {
      headers: { "User-Agent": "FreelancerHub-Skill-Verification" },
    });

    if (!userResponse.ok) {
      throw new Error(`GitHub user not found: ${username}`);
    }

    const userData = await userResponse.json();

    // Fetch repos
    const reposResponse = await fetch(`https://api.github.com/users/${username}/repos?per_page=100&sort=updated`, {
      headers: { "User-Agent": "FreelancerHub-Skill-Verification" },
    });
    const repos = await reposResponse.json();

    // Calculate language stats
    const languageStats = {};
    let totalBytes = 0;

    for (const repo of repos.slice(0, 20)) { // Limit to top 20 repos
      if (repo.language) {
        languageStats[repo.language] = (languageStats[repo.language] || 0) + (repo.size * 1024);
        totalBytes += repo.size * 1024;
      }
    }

    const languages = Object.entries(languageStats)
      .map(([name, bytes]) => ({
        name,
        bytes,
        percentage: Math.round((bytes / totalBytes) * 100),
      }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 10);

    // Top repositories
    const topRepositories = repos
      .sort((a, b) => (b.stargazers_count + b.forks_count) - (a.stargazers_count + a.forks_count))
      .slice(0, 5)
      .map(repo => ({
        name: repo.name,
        url: repo.html_url,
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        language: repo.language,
      }));

    // Calculate account age in months
    const createdAt = new Date(userData.created_at);
    const accountAge = Math.floor((Date.now() - createdAt.getTime()) / (30 * 24 * 60 * 60 * 1000));

    return {
      username: userData.login,
      profileUrl: userData.html_url,
      avatarUrl: userData.avatar_url,
      publicRepos: userData.public_repos,
      followers: userData.followers,
      following: userData.following,
      totalCommits: repos.reduce((sum, r) => sum + (r.size || 0) / 10, 0), // Estimate
      accountAge,
      languages,
      topRepositories,
      lastFetchedAt: new Date(),
    };
  } catch (error) {
    console.error("GitHub fetch error:", error);
    throw error;
  }
};

// Map GitHub languages to skill names
const mapLanguagesToSkills = (languages) => {
  const skillMap = {
    JavaScript: ["javascript", "nodejs", "react", "vue", "angular"],
    TypeScript: ["typescript", "nodejs", "react"],
    Python: ["python", "django", "flask", "machine-learning"],
    Java: ["java", "spring", "android"],
    "C#": ["csharp", "dotnet", "unity"],
    PHP: ["php", "laravel", "wordpress"],
    Ruby: ["ruby", "rails"],
    Go: ["golang", "go"],
    Rust: ["rust"],
    Swift: ["swift", "ios"],
    Kotlin: ["kotlin", "android"],
    HTML: ["html", "frontend"],
    CSS: ["css", "frontend"],
    SQL: ["sql", "database"],
  };

  const skills = new Set();
  for (const lang of languages) {
    const mapped = skillMap[lang.name] || [lang.name.toLowerCase()];
    mapped.forEach(s => skills.add(s));
  }
  return Array.from(skills);
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const logActivity = async (userId, action) => {
  try {
    await Activity.create({ userId, action });
  } catch (error) {
    console.error("Error logging activity:", error);
  }
};

const isValidObjectId = (id) => {
  return (
    mongoose.Types.ObjectId.isValid(id) &&
    new mongoose.Types.ObjectId(id).toString() === id
  );
};

// ============================================================================
// ROUTES
// ============================================================================

/**
 * POST /skills/verify/github
 * Verify skills via GitHub profile
 */
router.post(
  "/verify/github",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const { githubUsername } = req.body;

      if (!githubUsername || githubUsername.length < 1) {
        return res.status(400).json({ message: "GitHub username is required" });
      }

      // Fetch GitHub data
      const githubData = await fetchGitHubProfile(githubUsername);

      // Extract skills from languages
      const detectedSkills = mapLanguagesToSkills(githubData.languages);

      // Create or update skill verifications
      const verifications = [];

      for (const skillName of detectedSkills.slice(0, 10)) { // Limit to 10 skills
        let verification = await SkillVerification.findOne({ userId, skillName });

        if (!verification) {
          verification = new SkillVerification({
            userId,
            skillName,
            skillCategory: "programming",
            verificationType: "github",
          });
        }

        verification.githubVerification = githubData;
        verification.lastUpdatedAt = new Date();
        verification.calculateScore();

        // Auto-verify if score is sufficient
        if (verification.verificationScore >= 30) {
          verification.status = "verified";
          verification.verifiedAt = new Date();
          verification.expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
        }

        await verification.save();
        verifications.push({
          skillName: verification.skillName,
          level: verification.level,
          score: verification.verificationScore,
          status: verification.status,
        });
      }

      await logActivity(userId, `Verified ${verifications.length} skills via GitHub`);

      res.json({
        message: `Verified ${verifications.length} skills from GitHub`,
        githubProfile: {
          username: githubData.username,
          repos: githubData.publicRepos,
          followers: githubData.followers,
          topLanguages: githubData.languages.slice(0, 5),
        },
        verifiedSkills: verifications,
      });
    } catch (err) {
      console.error("GitHub Verify Error:", err);
      res.status(500).json({ message: err.message || "Error verifying GitHub" });
    }
  }
);

/**
 * POST /skills/verify/portfolio
 * Submit portfolio for verification
 */
router.post(
  "/verify/portfolio",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const { skillName, portfolioUrl, projectName, description, screenshotUrl } = req.body;

      if (!skillName || !portfolioUrl) {
        return res.status(400).json({ message: "Skill name and portfolio URL are required" });
      }

      // Validate URL
      try {
        new URL(portfolioUrl);
      } catch {
        return res.status(400).json({ message: "Invalid portfolio URL" });
      }

      let verification = await SkillVerification.findOne({ userId, skillName: skillName.toLowerCase() });

      if (!verification) {
        verification = new SkillVerification({
          userId,
          skillName: skillName.toLowerCase(),
          verificationType: "portfolio",
        });
      }

      verification.portfolioVerification = {
        portfolioUrl,
        projectName: projectName || "Portfolio Project",
        description: description || "",
        screenshotUrl: screenshotUrl || null,
        verificationMethod: "manual_review",
      };
      verification.status = "pending";
      verification.lastUpdatedAt = new Date();

      await verification.save();

      await logActivity(userId, `Submitted portfolio for skill: ${skillName}`);

      res.status(201).json({
        message: "Portfolio submitted for verification. An admin will review shortly.",
        verification: {
          _id: verification._id,
          skillName: verification.skillName,
          status: verification.status,
        },
      });
    } catch (err) {
      console.error("Portfolio Verify Error:", err);
      res.status(500).json({ message: "Error submitting portfolio" });
    }
  }
);

/**
 * POST /skills/verify/challenge
 * Submit challenge result
 */
router.post(
  "/verify/challenge",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const { skillName, challengeId, challengeTitle, difficulty, score, timeTaken } = req.body;

      if (!skillName || !challengeId || score === undefined) {
        return res.status(400).json({ message: "Skill name, challenge ID, and score are required" });
      }

      const passingScore = 70;
      const passed = score >= passingScore;

      let verification = await SkillVerification.findOne({ userId, skillName: skillName.toLowerCase() });

      if (!verification) {
        verification = new SkillVerification({
          userId,
          skillName: skillName.toLowerCase(),
          verificationType: "challenge",
        });
      }

      verification.challengeResult = {
        challengeId,
        challengeTitle: challengeTitle || "Skill Challenge",
        skillTested: skillName,
        difficulty: difficulty || "intermediate",
        score,
        passed,
        passingScore,
        timeTaken: timeTaken || 0,
        completedAt: new Date(),
        attempts: (verification.challengeResult?.attempts || 0) + 1,
      };

      verification.lastUpdatedAt = new Date();
      verification.calculateScore();

      if (passed) {
        verification.status = "verified";
        verification.verifiedAt = new Date();
        verification.expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      }

      await verification.save();

      await logActivity(userId, `Completed skill challenge for: ${skillName} (Score: ${score})`);

      res.json({
        message: passed ? "Challenge passed! Skill verified." : "Challenge completed but not passed.",
        verification: {
          _id: verification._id,
          skillName: verification.skillName,
          score,
          passed,
          level: verification.level,
          status: verification.status,
        },
      });
    } catch (err) {
      console.error("Challenge Verify Error:", err);
      res.status(500).json({ message: "Error submitting challenge result" });
    }
  }
);

/**
 * GET /skills/my
 * Get current user's verified skills
 */
router.get(
  "/my",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const userId = req.user.userId;

      const skills = await SkillVerification.find({ userId })
        .sort({ verificationScore: -1 });

      const verified = skills.filter(s => s.status === "verified");
      const pending = skills.filter(s => s.status === "pending");

      res.json({
        verifiedCount: verified.length,
        pendingCount: pending.length,
        skills,
      });
    } catch (err) {
      console.error("Get Skills Error:", err);
      res.status(500).json({ message: "Error fetching skills" });
    }
  }
);

/**
 * GET /skills/user/:userId
 * Get verified skills for a user (public)
 */
router.get(
  "/user/:userId",
  async (req, res) => {
    try {
      const { userId } = req.params;

      if (!isValidObjectId(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }

      const skills = await SkillVerification.getVerifiedSkills(userId);

      res.json({
        userId,
        verifiedSkillsCount: skills.length,
        skills: skills.map(s => ({
          skillName: s.skillName,
          level: s.level,
          score: s.verificationScore,
          verificationType: s.verificationType,
          verifiedAt: s.verifiedAt,
        })),
      });
    } catch (err) {
      console.error("Get User Skills Error:", err);
      res.status(500).json({ message: "Error fetching skills" });
    }
  }
);

/**
 * GET /skills/search/:skillName
 * Find users by verified skill
 */
router.get(
  "/search/:skillName",
  async (req, res) => {
    try {
      const { skillName } = req.params;
      const { minLevel } = req.query;

      const results = await SkillVerification.findBySkill(skillName, minLevel || "basic");

      res.json({
        skillName,
        count: results.length,
        freelancers: results.map(r => ({
          userId: r.userId._id,
          username: r.userId.username,
          profilePicture: r.userId.profilePictureUrl,
          title: r.userId.title,
          level: r.level,
          score: r.verificationScore,
        })),
      });
    } catch (err) {
      console.error("Search Skills Error:", err);
      res.status(500).json({ message: "Error searching skills" });
    }
  }
);

/**
 * POST /skills/admin/:id/verify
 * Admin verifies portfolio/certificate
 */
router.post(
  "/admin/:id/verify",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    try {
      const adminId = req.user.userId;
      const { id } = req.params;
      const { approved, notes } = req.body;

      if (!isValidObjectId(id)) {
        return res.status(400).json({ message: "Invalid verification ID" });
      }

      const verification = await SkillVerification.findById(id);

      if (!verification) {
        return res.status(404).json({ message: "Verification not found" });
      }

      if (verification.portfolioVerification) {
        verification.portfolioVerification.verifiedBy = adminId;
        verification.portfolioVerification.verifiedAt = new Date();
        verification.portfolioVerification.notes = notes || "";
      }

      if (approved) {
        await verification.verify();
      } else {
        verification.status = "rejected";
        await verification.save();
      }

      res.json({
        message: approved ? "Skill verified" : "Skill verification rejected",
        verification: {
          _id: verification._id,
          skillName: verification.skillName,
          status: verification.status,
          level: verification.level,
        },
      });
    } catch (err) {
      console.error("Admin Verify Error:", err);
      res.status(500).json({ message: "Error verifying skill" });
    }
  }
);

module.exports = router;
