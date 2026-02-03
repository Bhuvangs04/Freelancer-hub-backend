const mongoose = require("mongoose");

// ============================================================================
// EVIDENCE SUB-SCHEMA
// ============================================================================

const EvidenceSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["file", "screenshot", "chat_log", "contract", "milestone", "other"],
      required: true,
    },
    title: { type: String, required: true },
    description: { type: String },
    url: { type: String, required: true },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

// ============================================================================
// CHAT LOG SUB-SCHEMA
// ============================================================================

const ChatLogSchema = new mongoose.Schema(
  {
    message: { type: String, required: true },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    senderRole: { type: String, enum: ["client", "freelancer"] },
    timestamp: { type: Date, required: true },
  },
  { _id: false }
);

// ============================================================================
// ADMIN ACTION LOG SUB-SCHEMA
// ============================================================================

const AdminActionSchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
    note: { type: String },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

// ============================================================================
// MAIN DISPUTE SCHEMA (ENHANCED)
// ============================================================================

const DisputeSchema = new mongoose.Schema(
  {
    // Dispute Number (auto-generated)
    disputeNumber: {
      type: String,
      unique: true,
      index: true,
    },

// References
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
    agreementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agreement",
      index: true,
    },
    milestoneId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Milestone",
    },

    // Parties
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    freelancerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    filedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    filedAgainst: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    filerRole: {
      type: String,
      enum: ["client", "freelancer"],
      required: true,
    },

    // Dispute Details
    category: {
      type: String,
      enum: ["quality", "deadline", "scope", "payment", "communication", "fraud", "other"],
      required: true,
    },
    reason: {
      type: String,
      required: true,
      minlength: 50,
      maxlength: 5000,
    },
    amountInDispute: {
      type: Number,
      required: true,
      min: 0,
    },

    // Status
    status: {
      type: String,
      enum: [
        "pending_payment",  // Arbitration fee not paid
        "open",             // Fee paid, under review
        "under_review",     // Admin actively reviewing
        "awaiting_response", // Waiting for other party
        "resolved",         // Decision made
        "escalated",        // Escalated to higher authority
        "withdrawn",        // Filer withdrew dispute
      ],
      default: "pending_payment",
      index: true,
    },

    // Arbitration Fee
    arbitrationFee: {
      type: Number,
      required: true,
      default: 200, // ₹200 default
    },
    arbitrationFeePaid: {
      type: Boolean,
      default: false,
    },
    arbitrationPaymentId: { type: String },
    arbitrationPaymentLink: { type: String },
    arbitrationPaidAt: { type: Date },

    // Evidence
    evidence: [EvidenceSchema],
    chatLogs: [ChatLogSchema],

    // Response from other party
    respondentResponse: {
      response: { type: String },
      submittedAt: { type: Date },
      evidence: [EvidenceSchema],
    },

    // Admin Handling
    assignedAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
    adminActions: [AdminActionSchema],
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
    },

    // Resolution
    resolution: {
      decision: {
        type: String,
        enum: ["client_favor", "freelancer_favor", "split", "dismissed", null],
      },
      awardedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      awardedAmount: { type: Number },
      refundAmount: { type: Number },
      penaltyApplied: { type: Boolean, default: false },
      penaltyAmount: { type: Number },
      reasoning: { type: String },
      resolvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Admin",
      },
      resolvedAt: { type: Date },
    },

    // Deadlines
    responseDeadline: { type: Date },
    resolutionDeadline: { type: Date },

    // Flags
    isBinding: { type: Boolean, default: true },
    appealAllowed: { type: Boolean, default: false },
    appealDeadline: { type: Date },
  },
  { timestamps: true }
);

// ============================================================================
// INDEXES
// ============================================================================

DisputeSchema.index({ status: 1, priority: -1, createdAt: -1 });
DisputeSchema.index({ filedBy: 1, status: 1 });

// ============================================================================
// PRE-SAVE HOOKS
// ============================================================================

DisputeSchema.pre("save", async function (next) {
  // Generate dispute number
  if (this.isNew && !this.disputeNumber) {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    this.disputeNumber = `DSP-${timestamp}-${random}`;
  }

  // Calculate arbitration fee based on amount in dispute
  if (this.isNew && !this.arbitrationFee) {
    if (this.amountInDispute <= 5000) {
      this.arbitrationFee = 100;
    } else if (this.amountInDispute <= 20000) {
      this.arbitrationFee = 200;
    } else if (this.amountInDispute <= 50000) {
      this.arbitrationFee = 350;
    } else {
      this.arbitrationFee = 500;
    }
  }

  // Set deadlines
  if (this.isNew) {
    this.responseDeadline = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours
    this.resolutionDeadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  }

  next();
});

// ============================================================================
// INSTANCE METHODS
// ============================================================================

/**
 * Mark arbitration fee as paid
 */
DisputeSchema.methods.markFeePaid = async function (paymentId) {
  this.arbitrationFeePaid = true;
  this.arbitrationPaymentId = paymentId;
  this.arbitrationPaidAt = new Date();
  this.status = "open";
  return this.save();
};

/**
 * Add evidence
 */
DisputeSchema.methods.addEvidence = async function (evidence, uploadedBy) {
  this.evidence.push({
    ...evidence,
    uploadedBy,
    uploadedAt: new Date(),
  });
  return this.save();
};

/**
 * Submit respondent response
 */
DisputeSchema.methods.submitResponse = async function (response, evidence = []) {
  this.respondentResponse = {
    response,
    submittedAt: new Date(),
    evidence,
  };
  this.status = "under_review";
  return this.save();
};

/**
 * Assign to admin
 */
DisputeSchema.methods.assignToAdmin = async function (adminId) {
  this.assignedAdmin = adminId;
  this.status = "under_review";
  this.adminActions.push({
    action: "assigned",
    adminId,
    note: "Dispute assigned for review",
  });
  return this.save();
};

/**
 * Resolve dispute
 */
DisputeSchema.methods.resolve = async function (resolution, adminId) {
  this.resolution = {
    ...resolution,
    resolvedBy: adminId,
    resolvedAt: new Date(),
  };
  this.status = "resolved";
  this.adminActions.push({
    action: "resolved",
    adminId,
    note: `Decision: ${resolution.decision}`,
  });
  return this.save();
};

/**
 * Withdraw dispute
 */
DisputeSchema.methods.withdraw = async function () {
  if (this.status === "resolved") {
    throw new Error("Cannot withdraw resolved dispute");
  }
  this.status = "withdrawn";
  return this.save();
};

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Get disputes for admin dashboard
 */
DisputeSchema.statics.getAdminDashboard = async function (filters = {}) {
  const query = {};

  if (filters.status) {
    query.status = filters.status;
  } else {
    query.status = { $in: ["open", "under_review", "awaiting_response"] };
  }

  if (filters.priority) {
    query.priority = filters.priority;
  }

  if (filters.assignedAdmin) {
    query.assignedAdmin = filters.assignedAdmin;
  }

  return this.find(query)
    .populate("clientId", "username email")
    .populate("freelancerId", "username email")
    .populate("projectId", "title budget")
    .populate("assignedAdmin", "username")
    .sort({ priority: -1, createdAt: 1 })
    .limit(filters.limit || 50);
};

/**
 * Get stats for admin
 */
DisputeSchema.statics.getStats = async function () {
  const stats = await this.aggregate([
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        totalAmount: { $sum: "$amountInDispute" },
      },
    },
  ]);

  return stats.reduce((acc, s) => {
    acc[s._id] = { count: s.count, totalAmount: s.totalAmount };
    return acc;
  }, {});
};

module.exports = mongoose.model("Dispute", DisputeSchema);
