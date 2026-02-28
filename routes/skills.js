const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { verifyToken, authorize } = require("../middleware/Auth");
const SkillVerification = require("../models/SkillVerification");
const SkillQuestion = require("../models/SkillQuestion");
const User = require("../models/User");
const Activity = require("../models/ActionSchema");

// ============================================================================
// GITHUB AUTHENTICATED API HELPERS
// ============================================================================

const GITHUB_TOKEN = process.env.access_token;

const githubHeaders = () => ({
  "User-Agent": "FreelancerHub-Skill-Verification",
  Accept: "application/vnd.github.v3+json",
  ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
});

const githubFetch = async (url) => {
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${body}`);
  }
  return res.json();
};

const githubGraphQL = async (query, variables = {}) => {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      ...githubHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub GraphQL error ${res.status}: ${body}`);
  }
  return res.json();
};

// ============================================================================
// COMPREHENSIVE GITHUB DATA FETCHER (Authenticated)
// ============================================================================

const fetchGitHubProfile = async (username) => {
  try {
    // 1. User Profile
    const userData = await githubFetch(`https://api.github.com/users/${username}`);

    // 2. All Repositories (paginated, up to 200)
    let allRepos = [];
    let page = 1;
    while (page <= 2) {
      const repos = await githubFetch(
        `https://api.github.com/users/${username}/repos?per_page=100&sort=updated&page=${page}`
      );
      if (repos.length === 0) break;
      allRepos = allRepos.concat(repos);
      if (repos.length < 100) break;
      page++;
    }

// 3. Detailed Language Stats (fetch per-repo languages for top 15 repos)
    const languageStats = {};
    let totalBytes = 0;
    const sortedRepos = [...allRepos]
      .sort((a, b) => (b.stargazers_count + b.forks_count) - (a.stargazers_count + a.forks_count));

    for (const repo of sortedRepos.slice(0, 15)) {
      try {
        const langs = await githubFetch(
          `https://api.github.com/repos/${username}/${repo.name}/languages`
        );
        for (const [lang, bytes] of Object.entries(langs)) {
          languageStats[lang] = (languageStats[lang] || 0) + bytes;
          totalBytes += bytes;
        }
      } catch (e) {
    // Skip repos where we can't fetch languages
      }
    }

    const languages = Object.entries(languageStats)
      .map(([name, bytes]) => ({
        name,
        bytes,
        percentage: totalBytes > 0 ? Math.round((bytes / totalBytes) * 100) : 0,
      }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 15);

    // 4. Pull Requests (via search API)
    let prData = { total: 0, merged: 0, open: 0 };
    try {
      const prSearch = await githubFetch(
        `https://api.github.com/search/issues?q=author:${username}+type:pr&per_page=1`
      );
      prData.total = prSearch.total_count || 0;

      const prMerged = await githubFetch(
        `https://api.github.com/search/issues?q=author:${username}+type:pr+is:merged&per_page=1`
      );
      prData.merged = prMerged.total_count || 0;

      const prOpen = await githubFetch(
        `https://api.github.com/search/issues?q=author:${username}+type:pr+is:open&per_page=1`
      );
      prData.open = prOpen.total_count || 0;
    } catch (e) {
      console.warn("PR fetch warning:", e.message);
    }

    // 5. Issues
    let issueData = { total: 0, open: 0, closed: 0 };
    try {
      const issueSearch = await githubFetch(
        `https://api.github.com/search/issues?q=author:${username}+type:issue&per_page=1`
      );
      issueData.total = issueSearch.total_count || 0;

      const issueClosed = await githubFetch(
        `https://api.github.com/search/issues?q=author:${username}+type:issue+is:closed&per_page=1`
      );
      issueData.closed = issueClosed.total_count || 0;
      issueData.open = issueData.total - issueData.closed;
    } catch (e) {
      console.warn("Issue fetch warning:", e.message);
    }

    // 6. Organizations
    let orgs = [];
    try {
      const orgsData = await githubFetch(`https://api.github.com/users/${username}/orgs`);
      orgs = orgsData.map((o) => ({
        name: o.login,
        avatarUrl: o.avatar_url,
      }));
    } catch (e) {
      console.warn("Orgs fetch warning:", e.message);
    }

    // 7. Gists count
    let gistsCount = 0;
    try {
      const gistsData = await githubFetch(
        `https://api.github.com/users/${username}/gists?per_page=1`
      );
      gistsCount = userData.public_gists || gistsData.length;
    } catch (e) {
      // skip
    }

    // 8. Contribution calendar via GraphQL
    let totalContributions = 0;
    try {
      const graphqlResult = await githubGraphQL(`
        query {
          user(login: "${username}") {
            contributionsCollection {
              contributionCalendar {
                totalContributions
              }
            }
          }
        }
      `);
      totalContributions =
        graphqlResult?.data?.user?.contributionsCollection?.contributionCalendar
          ?.totalContributions || 0;
    } catch (e) {
      console.warn("GraphQL contributions warning:", e.message);
    }

    // 9. Estimate total commits (sum of contributor stats for own repos, top 5)
    let totalCommits = 0;
    let weeklyCommitSum = 0;
    let weekCount = 0;
    for (const repo of sortedRepos.slice(0, 5)) {
      try {
        const stats = await githubFetch(
          `https://api.github.com/repos/${username}/${repo.name}/stats/commit_activity`
        );
        if (Array.isArray(stats)) {
          for (const week of stats) {
            totalCommits += week.total || 0;
            weeklyCommitSum += week.total || 0;
            weekCount++;
          }
        }
      } catch (e) {
        // stats endpoints may return 202 (not ready), skip
      }
    }
    const commitFrequency = weekCount > 0 ? Math.round(weeklyCommitSum / weekCount * 10) / 10 : 0;

    // 10. Top Repositories with content analysis
    const topRepositories = [];
    for (const repo of sortedRepos.slice(0, 10)) {
      let hasReadme = false, hasCI = false, hasDocker = false, hasTests = false;
      try {
        const contents = await githubFetch(
          `https://api.github.com/repos/${username}/${repo.name}/contents/`
        );
        if (Array.isArray(contents)) {
          const names = contents.map((c) => c.name.toLowerCase());
          hasReadme = names.some((n) => n === "readme.md" || n === "readme.rst" || n === "readme");
          hasDocker = names.some((n) => n === "dockerfile" || n === "docker-compose.yml" || n === "docker-compose.yaml");
          hasTests = names.some((n) =>
            n === "tests" || n === "test" || n === "__tests__" || n === "spec"
          );
          hasCI = names.some((n) => n === ".github") || names.some((n) => n === ".gitlab-ci.yml" || n === ".travis.yml" || n === "jenkinsfile");
        }
      } catch (e) {
        // skip
      }

      // Releases count for this repo
      let releasesCount = 0;
      try {
        const releases = await githubFetch(
          `https://api.github.com/repos/${username}/${repo.name}/releases?per_page=1`
        );
        releasesCount = releases.length;
      } catch (e) {
        // skip
      }

      topRepositories.push({
        name: repo.name,
        fullName: repo.full_name,
        url: repo.html_url,
        description: repo.description || "",
        private: repo.private,
        fork: repo.fork,
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        watchers: repo.watchers_count,
        openIssues: repo.open_issues_count,
        language: repo.language,
        topics: repo.topics || [],
        license: repo.license?.spdx_id || null,
        defaultBranch: repo.default_branch,
        size: repo.size,
        hasReadme,
        hasCI,
        hasDocker,
        hasTests,
        createdAt: repo.created_at,
        updatedAt: repo.updated_at,
        pushedAt: repo.pushed_at,
      });
    }

    // Calculate account age
    const createdAt = new Date(userData.created_at);
    const accountAge = Math.floor((Date.now() - createdAt.getTime()) / (30 * 24 * 60 * 60 * 1000));

    return {
      // Profile
      username: userData.login,
      profileUrl: userData.html_url,
      avatarUrl: userData.avatar_url,
      name: userData.name || "",
      bio: userData.bio || "",
      email: userData.email || "",
      hireable: userData.hireable || false,
      company: userData.company || "",
      blog: userData.blog || "",
      twitterUsername: userData.twitter_username || "",
      location: userData.location || "",

      // Repos
      publicRepos: userData.public_repos || 0,
      privateRepos: userData.total_private_repos || userData.owned_private_repos || 0,
      totalRepos: allRepos.length,

      // Social
      followers: userData.followers || 0,
      following: userData.following || 0,

      // Contributions
      totalContributions,
      totalCommits,
      commitFrequency,

      // PRs
      pullRequests: prData,

      // Issues
      issues: issueData,

      // Orgs
      organizations: orgs,

      // Account
      accountAge,
      accountCreatedAt: userData.created_at,

      // Languages
      languages,

      // Repos detail
      topRepositories,

      // Extras
      gistsCount,
      releasesCount: topRepositories.reduce((sum, r) => sum + (r.releasesCount || 0), 0),

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
    Shell: ["devops", "bash", "linux"],
    Dockerfile: ["docker", "devops"],
    HCL: ["terraform", "devops"],
    Dart: ["dart", "flutter"],
    "C++": ["cpp", "systems-programming"],
    C: ["c", "systems-programming"],
    Scala: ["scala", "jvm"],
    R: ["r", "data-science"],
    MATLAB: ["matlab", "data-science"],
    Jupyter: ["python", "data-science", "machine-learning"],
  };

  const skills = new Set();
  for (const lang of languages) {
    const mapped = skillMap[lang.name] || [lang.name.toLowerCase()];
    mapped.forEach((s) => skills.add(s));
  }
  return Array.from(skills);
};

// Build user-facing summary from full GitHub data
const buildGitHubSummary = (ghData) => {
  return {
    username: ghData.username,
    avatarUrl: ghData.avatarUrl,
    name: ghData.name,
    bio: ghData.bio,
    publicRepos: ghData.publicRepos,
    privateRepos: ghData.privateRepos,
    totalRepos: ghData.totalRepos,
    followers: ghData.followers,
    following: ghData.following,
    totalContributions: ghData.totalContributions,
    totalCommits: ghData.totalCommits,
    commitFrequency: ghData.commitFrequency,
    pullRequests: ghData.pullRequests,
    issues: ghData.issues,
    organizations: ghData.organizations,
    topLanguages: ghData.languages,
    topRepositories: (ghData.topRepositories || []).slice(0, 10).map((r) => ({
      name: r.name,
      url: r.url,
      stars: r.stars,
      forks: r.forks,
      language: r.language,
      description: r.description,
      topics: r.topics,
      private: r.private,
      hasCI: r.hasCI,
      hasDocker: r.hasDocker,
      hasTests: r.hasTests,
      hasReadme: r.hasReadme,
    })),
    accountAgeMonths: ghData.accountAge,
    gistsCount: ghData.gistsCount,
    lastFetchedAt: ghData.lastFetchedAt,
    company: ghData.company,
    blog: ghData.blog,
    twitterUsername: ghData.twitterUsername,
    location: ghData.location,
    hireable: ghData.hireable,
    email: ghData.email,
    profileUrl: ghData.profileUrl,
  };
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
 * Verify skills via GitHub profile (Authenticated API)
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

      // Fetch GitHub data using authenticated API
      const githubData = await fetchGitHubProfile(githubUsername);

      // Store in User model
      await User.findByIdAndUpdate(userId, {
        githubUsername,
        githubData: buildGitHubSummary(githubData),
      });

      // Extract skills from languages
      const detectedSkills = mapLanguagesToSkills(githubData.languages);

      // Create or update skill verifications
      const verifications = [];

      for (const skillName of detectedSkills.slice(0, 10)) {
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

      await logActivity(userId, `Verified ${verifications.length} skills via GitHub (Authenticated)`);

      res.json({
        message: `Verified ${verifications.length} skills from GitHub`,
        githubProfile: buildGitHubSummary(githubData),
        verifiedSkills: verifications,
      });
    } catch (err) {
      console.error("GitHub Verify Error:", err);
      res.status(500).json({ message: err.message || "Error verifying GitHub" });
    }
  }
);

/**
 * GET /skills/github/profile
 * Get stored GitHub data for the logged-in freelancer
 */
router.get(
  "/github/profile",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const user = await User.findById(req.user.userId).select("githubUsername githubData");

      if (!user || !user.githubData || !user.githubData.username) {
        return res.status(404).json({
          message: "No GitHub data found. Please connect your GitHub profile first.",
        });
      }

      // Also fetch existing verified skills
      const verifiedSkills = await SkillVerification.find({
        userId: req.user.userId,
        verificationType: "github",
      }).select("skillName level verificationScore status");

      res.json({
        githubUsername: user.githubUsername,
        githubData: user.githubData,
        verifiedSkills: verifiedSkills.map((s) => ({
          skillName: s.skillName,
          level: s.level,
          verificationScore: s.verificationScore,
          status: s.status,
        })),
      });
    } catch (err) {
      console.error("Get GitHub Profile Error:", err);
      res.status(500).json({ message: "Error fetching GitHub profile" });
    }
  }
);

/**
 * POST /skills/github/refresh
 * Re-fetch GitHub data and update everything
 */
router.post(
  "/github/refresh",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const user = await User.findById(userId);

      const githubUsername = req.body.githubUsername || user.githubUsername;

      if (!githubUsername) {
        return res.status(400).json({
          message: "No GitHub username found. Please provide one.",
        });
      }

      // Fetch fresh GitHub data
      const githubData = await fetchGitHubProfile(githubUsername);
      const summary = buildGitHubSummary(githubData);

      // Update User model
      user.githubUsername = githubUsername;
      user.githubData = summary;
      await user.save();

      // Update all existing GitHub skill verifications
      const detectedSkills = mapLanguagesToSkills(githubData.languages);
      const verifications = [];

      for (const skillName of detectedSkills.slice(0, 10)) {
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

      await logActivity(userId, `Refreshed GitHub data for ${githubUsername}`);

      res.json({
        message: `GitHub data refreshed. ${verifications.length} skills updated.`,
        githubProfile: summary,
        verifiedSkills: verifications,
      });
    } catch (err) {
      console.error("GitHub Refresh Error:", err);
      res.status(500).json({ message: err.message || "Error refreshing GitHub data" });
    }
  }
);

/**
 * GET /skills/github/profile/:userId
 * Public route - Get GitHub data for any user (for clients to view)
 */
router.get(
  "/github/profile/:userId",
  async (req, res) => {
    try {
      const { userId } = req.params;

      if (!isValidObjectId(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }

      const user = await User.findById(userId).select("username githubUsername githubData profilePictureUrl title");

      if (!user || !user.githubData || !user.githubData.username) {
        return res.status(404).json({
          message: "No GitHub data found for this user.",
        });
      }

      res.json({
        username: user.username,
        title: user.title,
        profilePictureUrl: user.profilePictureUrl,
        githubUsername: user.githubUsername,
        githubData: user.githubData,
      });
    } catch (err) {
      console.error("Get Public GitHub Profile Error:", err);
      res.status(500).json({ message: "Error fetching GitHub profile" });
    }
  }
);

// ============================================================================
// PORTFOLIO & CHALLENGE ROUTES (Unchanged)
// ============================================================================

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
  authorize(["admin", "super_admin"]),
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

// ============================================================================
// SKILL CHALLENGE QUESTION ROUTES (Option B - Server-side)
// ============================================================================

/**
 * GET /skills/challenges/available
 * Get list of skills that have challenge questions available
 */
router.get(
  "/challenges/available",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const skills = await SkillQuestion.aggregate([
        { $match: { isActive: true } },
        {
          $group: {
            _id: "$skillName",
            questionCount: { $sum: 1 },
            difficulties: { $addToSet: "$difficulty" },
          },
        },
        { $match: { questionCount: { $gte: 5 } } },
        { $sort: { _id: 1 } },
      ]);

      console.log(skills);

      res.json({
        availableSkills: skills.map((s) => ({
          skillName: s._id,
          questionCount: s.questionCount,
          difficulties: s.difficulties,
        })),
      });
    } catch (err) {
      console.error("Get Available Challenges Error:", err);
      res.status(500).json({ message: "Error fetching available challenges" });
    }
  }
);

/**
 * GET /skills/challenges/:skillName/questions
 * Get random questions for a skill challenge (answers stripped)
 */
router.get(
  "/challenges/:skillName/questions",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const { skillName } = req.params;
      const { difficulty, count } = req.query;

      const questionCount = Math.min(parseInt(count) || 10, 20);

      const questions = await SkillQuestion.getRandomQuestions(
        skillName,
        questionCount,
        difficulty || null
      );

      if (questions.length === 0) {
        return res.status(404).json({
          message: `No challenge questions found for skill: ${skillName}`,
        });
      }

      // Generate a challenge session ID
      const challengeId = new mongoose.Types.ObjectId().toString();

      res.json({
        challengeId,
        skillName: skillName.toLowerCase(),
        questionCount: questions.length,
        timeLimit: questions.length * 60, // 1 minute per question
        questions,
      });
    } catch (err) {
      console.error("Get Challenge Questions Error:", err);
      res.status(500).json({ message: "Error fetching challenge questions" });
    }
  }
);

/**
 * POST /skills/challenges/:skillName/submit
 * Submit challenge answers for grading (server-side)
 */
router.post(
  "/challenges/:skillName/submit",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const { skillName } = req.params;
      const { challengeId, answers, timeTaken } = req.body;

      if (!challengeId || !answers || typeof answers !== "object") {
        return res.status(400).json({
          message: "challengeId, and answers (object of questionId -> selectedOptionId) are required",
        });
      }

      const questionIds = Object.keys(answers);
      if (questionIds.length === 0) {
        return res.status(400).json({ message: "No answers provided" });
      }

      // Grade the answers server-side
      const gradeResult = await SkillQuestion.gradeAnswers(questionIds, answers);

      // Update or create skill verification
      let verification = await SkillVerification.findOne({
        userId,
        skillName: skillName.toLowerCase(),
      });

      if (!verification) {
        verification = new SkillVerification({
          userId,
          skillName: skillName.toLowerCase(),
          verificationType: "challenge",
        });
      }

      // Determine difficulty based on score
      let difficulty = "intermediate";
      if (gradeResult.score >= 90) difficulty = "advanced";
      else if (gradeResult.score < 50) difficulty = "beginner";

      verification.challengeResult = {
        challengeId,
        challengeTitle: `${skillName} Skill Challenge`,
        skillTested: skillName,
        difficulty,
        score: gradeResult.score,
        passed: gradeResult.passed,
        passingScore: 70,
        timeTaken: timeTaken || 0,
        completedAt: new Date(),
        attempts: (verification.challengeResult?.attempts || 0) + 1,
      };

      verification.lastUpdatedAt = new Date();
      verification.calculateScore();

      if (gradeResult.passed) {
        verification.status = "verified";
        verification.verifiedAt = new Date();
        verification.expiresAt = new Date(
          Date.now() + 365 * 24 * 60 * 60 * 1000
        );
      }

      await verification.save();
      await logActivity(userId, `Completed skill challenge for: ${skillName} (Score: ${gradeResult.score})`);

      res.json({
        message: gradeResult.passed
          ? "Challenge passed! Skill verified."
          : "Challenge completed but score below 70%. Try again.",
        challengeResult: gradeResult,
        verification: {
          _id: verification._id,
          skillName: verification.skillName,
          score: gradeResult.score,
          passed: gradeResult.passed,
          level: verification.level,
          status: verification.status,
          verificationScore: verification.verificationScore,
        },
      });
    } catch (err) {
      console.error("Submit Challenge Error:", err);
      res.status(500).json({ message: "Error submitting challenge" });
    }
  }
);

/**
 * POST /skills/admin/questions
 * Admin adds questions to the question bank
 */
router.post(
  "/admin/questions",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const { questions } = req.body;

      if (!Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({
          message: "questions must be a non-empty array",
        });
      }

      const created = await SkillQuestion.insertMany(questions);
      res.status(201).json({
        message: `${created.length} questions added successfully`,
        count: created.length,
      });
    } catch (err) {
      console.error("Admin Add Questions Error:", err);
      res.status(500).json({ message: "Error adding questions" });
    }
  }
);

/**
 * GET /skills/admin/questions/:skillName
 * Admin views all questions for a skill
 */
router.get(
  "/admin/questions/:skillName",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const { skillName } = req.params;
      const questions = await SkillQuestion.find({
        skillName: skillName.toLowerCase(),
      }).sort({ difficulty: 1, createdAt: -1 });

      res.json({
        skillName,
        count: questions.length,
        questions,
      });
    } catch (err) {
      console.error("Admin Get Questions Error:", err);
      res.status(500).json({ message: "Error fetching questions" });
    }
  }
);

/**
 * DELETE /skills/admin/questions/:id
 * Admin deletes a specific question
 */
router.delete(
  "/admin/questions/:id",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return res.status(400).json({ message: "Invalid question ID" });
      }

      const deleted = await SkillQuestion.findByIdAndDelete(id);

      if (!deleted) {
        return res.status(404).json({ message: "Question not found" });
      }

      res.json({
        message: "Question deleted successfully",
        question: deleted,
      });
    } catch (err) {
      console.error("Admin Delete Question Error:", err);
      res.status(500).json({ message: "Error deleting question" });
    }
  }
);

/**
 * DELETE /skills/admin/questions/skill/:skillName
 * Admin deletes all questions for a specific skill (deleting the challenge entirely)
 */
router.delete(
  "/admin/questions/skill/:skillName",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const { skillName } = req.params;

      const result = await SkillQuestion.deleteMany({
        skillName: skillName.toLowerCase(),
      });

      res.json({
        message: `Deleted all questions for ${skillName} challenge (${result.deletedCount} questions)`,
        deletedCount: result.deletedCount,
      });
    } catch (err) {
      console.error("Admin Delete Challenge Error:", err);
      res.status(500).json({ message: "Error deleting skill challenge" });
    }
  }
);

/**
 * GET /skills/admin/challenges
 * Admin gets all available challenges (even those with < 5 questions)
 */
router.get(
  "/admin/challenges",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const skills = await SkillQuestion.aggregate([
        {
          $group: {
            _id: "$skillName",
            questionCount: { $sum: 1 },
            difficulties: { $addToSet: "$difficulty" },
            isActive: { $first: "$isActive" }
          },
        },
        { $sort: { _id: 1 } },
      ]);

      res.json({
        count: skills.length,
        challenges: skills.map((s) => ({
          skillName: s._id,
          questionCount: s.questionCount,
          difficulties: s.difficulties,
          isActive: s.isActive
        })),
      });
    } catch (err) {
      console.error("Admin Get All Challenges Error:", err);
      res.status(500).json({ message: "Error fetching all challenges" });
    }
  }
);

/**
 * GET /skills/admin/pending
 * Admin gets all pending skill verifications
 */
router.get(
  "/admin/pending",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const pending = await SkillVerification.find({ status: "pending" })
        .populate("userId", "username profilePictureUrl title email")
        .sort({ createdAt: -1 });

      res.json({
        count: pending.length,
        verifications: pending,
      });
    } catch (err) {
      console.error("Admin Get Pending Error:", err);
      res.status(500).json({ message: "Error fetching pending verifications" });
    }
  }
);

module.exports = router;
