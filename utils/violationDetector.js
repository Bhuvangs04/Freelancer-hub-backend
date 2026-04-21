/**
 * Violation Detector — scans messages for off-platform deal attempts
 *
 * Returns { flagged, reasons[], score } for a given plaintext message.
 */

// ── Suspicious keywords (payment / contact bypass) ─────────────────────────
const PAYMENT_KEYWORDS = [
  "whatsapp",
  "upi",
  "gpay",
  "google pay",
  "paytm",
  "phonepe",
  "telegram",
  "direct payment",
  "direct pay",
  "outside payment",
  "pay directly",
  "pay outside",
  "off platform",
  "off-platform",
];

const CONTACT_KEYWORDS = [
  "call me",
  "contact me",
  "reach me",
  "ping me on",
  "text me on",
  "message me on",
  "my number",
  "my phone",
  "personal email",
  "personal number",
];

// ── External link patterns ─────────────────────────────────────────────────
const EXTERNAL_LINK_PATTERNS = [
  /https?:\/\//i,
  /wa\.me/i,
  /t\.me/i,
  /instagram\.com/i,
  /facebook\.com/i,
  /twitter\.com/i,
  /x\.com/i,
  /discord\.gg/i,
  /linkedin\.com\/in\//i,
];

// ── Phone number regex (10-15 consecutive digits) ──────────────────────────
const PHONE_REGEX = /\b\d{10,15}\b/;

// ── Scoring ────────────────────────────────────────────────────────────────
const SCORES = {
  EXTERNAL_LINK: 2,
  PHONE_NUMBER: 2,
  PAYMENT_KEYWORD: 3,
  CONTACT_KEYWORD: 2,
};

/**
 * Scan a plaintext message for violations.
 * @param {string} text - The raw message text
 * @returns {{ flagged: boolean, reasons: string[], score: number }}
 */
function scanMessage(text) {
  if (!text || typeof text !== "string") {
    return { flagged: false, reasons: [], score: 0 };
  }

  const lower = text.toLowerCase();
  const reasons = [];
  let score = 0;

  // Check payment keywords
  for (const keyword of PAYMENT_KEYWORDS) {
    if (lower.includes(keyword)) {
      reasons.push(`Payment keyword detected: "${keyword}"`);
      score += SCORES.PAYMENT_KEYWORD;
      break; // Only count once per category
    }
  }

  // Check contact keywords
  for (const keyword of CONTACT_KEYWORDS) {
    if (lower.includes(keyword)) {
      reasons.push(`Contact bypass keyword detected: "${keyword}"`);
      score += SCORES.CONTACT_KEYWORD;
      break;
    }
  }

  // Check external links
  for (const pattern of EXTERNAL_LINK_PATTERNS) {
    if (pattern.test(text)) {
      reasons.push(`External link detected: ${text.match(pattern)?.[0]}`);
      score += SCORES.EXTERNAL_LINK;
      break;
    }
  }

  // Check phone numbers
  if (PHONE_REGEX.test(text)) {
    reasons.push("Phone number detected");
    score += SCORES.PHONE_NUMBER;
  }

  return {
    flagged: reasons.length > 0,
    reasons,
    score,
  };
}

module.exports = {
  scanMessage,
  SCORES,
  PAYMENT_KEYWORDS,
  CONTACT_KEYWORDS,
  EXTERNAL_LINK_PATTERNS,
  PHONE_REGEX,
};
