// ============================================================================
// ML Client Service
// HTTP client that calls the Python FastAPI ML service
// Handles: success prediction, fake detection, TLAM matching
// ============================================================================

const axios = require("axios");

const ML_API_URL = process.env.ML_API_URL || "http://localhost:5001";
const ML_TIMEOUT = parseInt(process.env.ML_TIMEOUT) || 15000; // 15s default
const ML_RETRIES = parseInt(process.env.ML_RETRIES) || 2;

// ============================================================================
// CIRCUIT BREAKER STATE
// ============================================================================

let circuitState = {
  failures: 0,
  lastFailure: null,
  isOpen: false,
  threshold: 5,           // open circuit after 5 failures
  resetTimeout: 30000,    // try again after 30s
};

function checkCircuit() {
  if (!circuitState.isOpen) return true;

  // Check if enough time has passed to retry
  const now = Date.now();
  if (now - circuitState.lastFailure > circuitState.resetTimeout) {
    console.log("🔄 ML Circuit breaker: half-open, attempting retry...");
    circuitState.isOpen = false;
    circuitState.failures = 0;
    return true;
  }

  return false;
}

function recordFailure() {
  circuitState.failures++;
  circuitState.lastFailure = Date.now();

  if (circuitState.failures >= circuitState.threshold) {
    circuitState.isOpen = true;
    console.error(
      `🔴 ML Circuit breaker OPEN — ${circuitState.failures} consecutive failures. ` +
      `Will retry after ${circuitState.resetTimeout / 1000}s`
    );
  }
}

function recordSuccess() {
  circuitState.failures = 0;
  circuitState.isOpen = false;
}

// ============================================================================
// HTTP REQUEST WITH RETRY
// ============================================================================

async function mlRequest(method, path, data = null, retries = ML_RETRIES) {
  if (!checkCircuit()) {
    throw new Error(
      "ML service circuit breaker is OPEN — service appears to be down. " +
      `Will retry automatically in ${Math.ceil((circuitState.resetTimeout - (Date.now() - circuitState.lastFailure)) / 1000)}s`
    );
  }

  const url = `${ML_API_URL}${path}`;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const config = {
        method,
        url,
        timeout: ML_TIMEOUT,
        headers: { "Content-Type": "application/json" },
      };

      if (data) config.data = data;

      const response = await axios(config);
      recordSuccess();
      return response.data;
    } catch (err) {
      const isLast = attempt > retries;

      if (err.code === "ECONNREFUSED" || err.code === "ECONNRESET" || err.code === "ETIMEDOUT") {
        recordFailure();
        if (isLast) {
          throw new Error(
            `ML service unavailable at ${ML_API_URL}. ` +
            `Make sure the Python ML API is running: cd freelancer-ml-project && python api_gateway_integration.py`
          );
        }
        console.warn(`⚠️ ML request attempt ${attempt}/${retries + 1} failed (${err.code}), retrying...`);
        await new Promise((r) => setTimeout(r, 1000 * attempt)); // exponential backoff
        continue;
      }

      // Non-connection errors — don't retry
      if (err.response) {
        throw new Error(
          `ML API returned ${err.response.status}: ${JSON.stringify(err.response.data)}`
        );
      }

      throw err;
    }
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Check ML service health
 */
async function healthCheck() {
  try {
    const result = await mlRequest("GET", "/health", null, 0);
    return { available: true, ...result };
  } catch (err) {
    return {
      available: false,
      error: err.message,
      circuit: circuitState.isOpen ? "OPEN" : "CLOSED",
    };
  }
}

/**
 * Predict freelancer success probability
 * @param {object} parameters - The 8 required fields from aiDataResolver
 */
async function predictSuccess(parameters) {
  return mlRequest("POST", "/api/ml/predict", {
    model: "success_prediction",
    parameters,
  });
}

/**
 * Detect fake freelancer profile
 * @param {object} parameters - The 9 required fields from aiDataResolver
 */
async function detectFake(parameters) {
  return mlRequest("POST", "/api/ml/predict", {
    model: "fake_profile_detection",
    parameters,
  });
}

/**
 * TLAM/Weighted-Sum freelancer-project matching
 * @param {Array} freelancers - Array of freelancer data objects
 * @param {object} project - Project data object
 * @param {number} limit - Max results to return
 * @param {string} scoringMethod - 'tlam' (strict) or 'weighted_sum' (lenient)
 */
async function matchFreelancers(freelancers, project, limit = 10, scoringMethod = "tlam") {
  return mlRequest("POST", "/api/ml/match", {
    freelancers,
    project,
    limit,
    scoring_method: scoringMethod,
  });
}

/**
 * Get required fields for each model
 */
async function getRequiredFields() {
  return mlRequest("GET", "/api/fields");
}

module.exports = {
  healthCheck,
  predictSuccess,
  detectFake,
  matchFreelancers,
  getRequiredFields,
  ML_API_URL,
};
