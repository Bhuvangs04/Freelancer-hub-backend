const express = require("express");
const router = express.Router();
const AiRequest = require("../models/AiRequest");
const AiApiKey = require("../models/AiApiKey");
const { resolveData, SUPPORTED_ACTIONS } = require("../services/aiDataResolver");

// ============================================================================
// API KEY AUTHENTICATION MIDDLEWARE (DB-based)
// ============================================================================

/**
 * Validates the x-api-key header against keys stored in the AiApiKey collection.
 * Checks status, request limits, and increments usage counter.
 */
async function authenticateApiKey(req, res, next) {
  const apiKey = req.headers["x-api-key"];

  if (!apiKey) {
    return res.status(401).json({
      error: "Missing API key",
      message: "Provide a valid API key in the x-api-key header.",
    });
  }

  try {
    const keyDoc = await AiApiKey.findOne({ key: apiKey });

    if (!keyDoc) {
      return res.status(401).json({
        error: "Invalid API key",
        message: "The provided API key is not valid.",
      });
    }

    if (keyDoc.status === "revoked") {
      return res.status(401).json({
        error: "Revoked API key",
        message: "This API key has been revoked.",
      });
    }

    if (keyDoc.status === "blocked") {
      return res.status(403).json({
        error: "Blocked API key",
        message: `This API key is blocked. Reason: ${keyDoc.blockedReason || "No reason provided"}`,
      });
    }

    // Check request limit (0 = unlimited)
    if (keyDoc.requestLimit > 0 && keyDoc.usageCount >= keyDoc.requestLimit) {
      keyDoc.status = "blocked";
      keyDoc.blockedReason = "Request limit reached";
      keyDoc.blockedAt = new Date();
      await keyDoc.save();

      return res.status(429).json({
        error: "Request limit reached",
        message: `This API key has reached its limit of ${keyDoc.requestLimit} requests.`,
      });
    }

    // Record usage
    await keyDoc.recordUsage();

    // Attach key info to request for downstream use
    req.aiApiKey = {
      id: keyDoc._id,
      label: keyDoc.label,
    };

    next();
  } catch (err) {
    console.error("AI Gateway — API key validation error:", err);
    return res.status(500).json({
      error: "Internal error",
      message: "Failed to validate API key.",
    });
  }
}

// Apply API key auth to all routes in this router
router.use(authenticateApiKey);

// ============================================================================
// POST /request — AI service requests data from the backend
// ============================================================================

router.post("/request", async (req, res) => {
  const { action, params, serviceName } = req.body;

  // ── Validation ──────────────────────────────────────────────────────────────
  if (!action) {
    return res.status(400).json({
      error: "Missing action",
      message: "Provide an 'action' field in the request body.",
      supportedActions: SUPPORTED_ACTIONS,
    });
  }

  if (!SUPPORTED_ACTIONS.includes(action)) {
    return res.status(400).json({
      error: "Unsupported action",
      message: `Action '${action}' is not supported.`,
      supportedActions: SUPPORTED_ACTIONS,
    });
  }

  if (!params || typeof params !== "object") {
    return res.status(400).json({
      error: "Missing params",
      message: "Provide a 'params' object in the request body.",
    });
  }

  // ── Create tracking record ──────────────────────────────────────────────────
  let aiRequest;
  try {
    aiRequest = await AiRequest.create({
      action,
      params,
      aiServiceName: serviceName || "unknown",
      apiKeyId: req.aiApiKey?.id || null,
      status: "pending",
    });
  } catch (err) {
    console.error("AI Gateway — failed to create request record:", err);
    return res.status(500).json({
      error: "Internal error",
      message: "Failed to initialize the request.",
    });
  }

  // ── Resolve data ────────────────────────────────────────────────────────────
  try {
    const data = await resolveData(action, params);

    // Update tracking record
    aiRequest.status = "data_sent";
    aiRequest.dataSentAt = new Date();
    // Store a lightweight summary, not the full data (to save DB space)
    aiRequest.responseData = {
      recordCount: Array.isArray(data[Object.keys(data).find((k) => Array.isArray(data[k]))])
        ? data[Object.keys(data).find((k) => Array.isArray(data[k]))].length
        : 1,
      keys: Object.keys(data),
    };
    await aiRequest.save();

    return res.status(200).json({
      success: true,
      requestId: aiRequest.requestId,
      action,
      data,
    });
  } catch (err) {
    console.error(`AI Gateway — resolveData failed for action '${action}':`, err.message);

    // Mark as failed
    aiRequest.status = "failed";
    aiRequest.errorMessage = err.message;
    await aiRequest.save().catch(() => {});

    return res.status(400).json({
      success: false,
      requestId: aiRequest.requestId,
      error: err.message,
    });
  }
});

// ============================================================================
// POST /result — AI service sends back its processed result
// ============================================================================

router.post("/result", async (req, res) => {
  const { requestId, result } = req.body;

  if (!requestId) {
    return res.status(400).json({
      error: "Missing requestId",
      message: "Provide the 'requestId' returned from the /request endpoint.",
    });
  }

  if (!result || typeof result !== "object") {
    return res.status(400).json({
      error: "Missing result",
      message: "Provide a 'result' object containing the AI service output.",
    });
  }

  try {
    const aiRequest = await AiRequest.findOne({ requestId });

    if (!aiRequest) {
      return res.status(404).json({
        error: "Request not found",
        message: `No AI request found with id '${requestId}'.`,
      });
    }

    if (aiRequest.status === "completed") {
      return res.status(409).json({
        error: "Already completed",
        message: "This request has already been marked as completed.",
      });
    }

    aiRequest.aiResult = result;
    aiRequest.status = "completed";
    aiRequest.completedAt = new Date();
    await aiRequest.save();

    return res.status(200).json({
      success: true,
      message: "Result stored successfully.",
      requestId: aiRequest.requestId,
      action: aiRequest.action,
    });
  } catch (err) {
    console.error("AI Gateway — failed to store result:", err);
    return res.status(500).json({
      error: "Internal error",
      message: "Failed to store the AI result.",
    });
  }
});

// ============================================================================
// GET /requests — List recent AI requests (for admin/debugging)
// ============================================================================

router.get("/requests", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    // Optional filters
    const filter = {};
    if (req.query.action) filter.action = req.query.action;
    if (req.query.status) filter.status = req.query.status;

    const [requests, total] = await Promise.all([
      AiRequest.find(filter)
        .select("-responseData") // Exclude large response data by default
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AiRequest.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      requests,
    });
  } catch (err) {
    console.error("AI Gateway — failed to list requests:", err);
    return res.status(500).json({
      error: "Internal error",
      message: "Failed to fetch AI requests.",
    });
  }
});

// ============================================================================
// GET /actions — List all supported actions (discovery endpoint)
// ============================================================================

router.get("/actions", (_req, res) => {
  const actionDetails = {
    recommend_freelancers: {
      description: "Get top freelancers matching a project's required skills",
      requiredParams: "projectId OR skillsRequired[]",
      optionalParams: "limit (default: 20)",
    },
    recommend_projects: {
      description: "Get open projects matching a freelancer's skills",
      requiredParams: "freelancerId OR skills[]",
      optionalParams: "limit (default: 20)",
    },
    detect_fake_account: {
      description: "Get comprehensive user data for fraud analysis",
      requiredParams: "userId",
      optionalParams: "none",
    },
    get_user_profile: {
      description: "Get user profile with reviews and skill verifications",
      requiredParams: "userId",
      optionalParams: "none",
    },
    get_project_details: {
      description: "Get full project context including bids and agreement",
      requiredParams: "projectId",
      optionalParams: "none",
    },
    predict_success: {
      description: "Compute parameters for predicting freelancer success on a project",
      requiredParams: "freelancerId, projectId",
      optionalParams: "none",
      outputFields: "experience_years, total_projects, avg_rating, completion_rate, on_time_delivery_rate, skill_match_score, profile_completeness, budget_ratio",
    },
    detect_fake_profile: {
      description: "Compute parameters for detecting fake/suspicious freelancer profiles",
      requiredParams: "userId",
      optionalParams: "none",
      outputFields: "profile_completeness, total_skills, avg_rating, total_reviews, total_projects, account_age_days, portfolio_items, budget_ratio, has_certifications",
    },
  };

  return res.status(200).json({
    success: true,
    supportedActions: SUPPORTED_ACTIONS,
    details: actionDetails,
  });
});

module.exports = router;
