const mongoose = require("mongoose");

// ============================================================================
// DELIVERABLE SUB-SCHEMA
// ============================================================================

const DeliverableSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    url: { type: String, required: true },
    fileType: { type: String },
    fileSize: { type: Number },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// ============================================================================
// MILESTONE SCHEMA
// ============================================================================

const MilestoneSchema = new mongoose.Schema(
  {
    // References
    agreementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agreement",
      required: true,
      index: true,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
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

    // Milestone Details
    milestoneNumber: {
      type: Number,
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      required: true,
      maxlength: 2000,
    },

    // Financial Details
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    escrowFunded: {
      type: Boolean,
      default: false,
    },

    // Timeline
    dueDate: {
      type: Date,
      required: true,
    },
    slaDeadline: {
      type: Date,
      required: true,
    },

    // Penalty/Bonus Configuration
    penaltyPercent: {
      type: Number,
      default: 5, // 5% per day late
      min: 0,
      max: 20,
    },
    bonusPercent: {
      type: Number,
      default: 3, // 3% bonus for early delivery
      min: 0,
      max: 10,
    },
    maxPenaltyCap: {
      type: Number,
      default: 50, // Maximum 50% penalty
      min: 0,
      max: 100,
    },

    // Status and Tracking
    status: {
      type: String,
      enum: [
        "pending",      // Not yet started
        "in_progress",  // Work underway
        "submitted",    // Freelancer submitted
        "revision",     // Client requested changes
        "confirmed",    // Client approved
        "disputed",     // Under dispute
        "released",     // Payment released
        "cancelled",    // Cancelled
      ],
      default: "pending",
      index: true,
    },

    // Timestamps for auto-unlock
    startedAt: { type: Date },
    submittedAt: { type: Date },
    confirmedAt: { type: Date },
    releasedAt: { type: Date },

    // Auto-release config (72 hours default)
    autoReleaseAfterHours: {
      type: Number,
      default: 72,
    },
    autoReleaseScheduledAt: { type: Date },

    // Deliverables
    deliverables: [DeliverableSchema],

    // Revision tracking
    revisionCount: {
      type: Number,
      default: 0,
    },
    maxRevisions: {
      type: Number,
      default: 3,
    },
    revisionNotes: [{
      note: String,
      requestedAt: Date,
      requestedBy: mongoose.Schema.Types.ObjectId,
    }],

    // Final Amount Calculation
    daysLate: {
      type: Number,
      default: 0,
    },
    daysEarly: {
      type: Number,
      default: 0,
    },
    penaltyAmount: {
      type: Number,
      default: 0,
    },
    bonusAmount: {
      type: Number,
      default: 0,
    },
    finalAmount: {
      type: Number,
    },

    // Dispute Info
    disputeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Dispute",
    },
    disputeReason: { type: String },
    disputedAt: { type: Date },
    disputeResolution: {
      type: String,
      enum: ["pending", "client_favor", "freelancer_favor", "split", null],
    },
  },
  { timestamps: true }
);

// ============================================================================
// INDEXES
// ============================================================================

MilestoneSchema.index({ agreementId: 1, milestoneNumber: 1 }, { unique: true });
MilestoneSchema.index({ status: 1, autoReleaseScheduledAt: 1 });

// ============================================================================
// INSTANCE METHODS
// ============================================================================

/**
 * Calculate and apply penalty for late delivery
 */
MilestoneSchema.methods.calculatePenalty = function () {
  if (!this.submittedAt || !this.slaDeadline) return 0;

  const submittedTime = new Date(this.submittedAt).getTime();
  const deadlineTime = new Date(this.slaDeadline).getTime();

  if (submittedTime <= deadlineTime) {
    this.daysLate = 0;
    this.penaltyAmount = 0;
    return 0;
  }

  const msLate = submittedTime - deadlineTime;
  const daysLate = Math.ceil(msLate / (24 * 60 * 60 * 1000));
  this.daysLate = daysLate;

  // Calculate penalty: penaltyPercent per day, capped at maxPenaltyCap
  let penaltyPercent = this.penaltyPercent * daysLate;
  penaltyPercent = Math.min(penaltyPercent, this.maxPenaltyCap);

  this.penaltyAmount = Math.round(this.amount * (penaltyPercent / 100) * 100) / 100;
  return this.penaltyAmount;
};

/**
 * Calculate and apply bonus for early delivery
 */
MilestoneSchema.methods.calculateBonus = function () {
  if (!this.submittedAt || !this.dueDate) return 0;

  const submittedTime = new Date(this.submittedAt).getTime();
  const dueTime = new Date(this.dueDate).getTime();

  if (submittedTime >= dueTime) {
    this.daysEarly = 0;
    this.bonusAmount = 0;
    return 0;
  }

  const msEarly = dueTime - submittedTime;
  const daysEarly = Math.floor(msEarly / (24 * 60 * 60 * 1000));
  this.daysEarly = daysEarly;

  // Bonus capped at bonusPercent (not per day, just flat bonus)
  this.bonusAmount = Math.round(this.amount * (this.bonusPercent / 100) * 100) / 100;
  return this.bonusAmount;
};

/**
 * Calculate final amount after penalties/bonuses
 */
MilestoneSchema.methods.calculateFinalAmount = function () {
  this.calculatePenalty();
  this.calculateBonus();

  // Apply bonus or penalty (never both)
  if (this.daysEarly > 0) {
    this.finalAmount = this.amount + this.bonusAmount;
  } else if (this.daysLate > 0) {
    this.finalAmount = this.amount - this.penaltyAmount;
    // Ensure minimum 50% payment
    this.finalAmount = Math.max(this.finalAmount, this.amount * 0.5);
  } else {
    this.finalAmount = this.amount;
  }

  return this.finalAmount;
};

/**
 * Submit milestone for review
 */
MilestoneSchema.methods.submit = async function (deliverables) {
  if (this.status !== "pending" && this.status !== "in_progress" && this.status !== "revision") {
    throw new Error(`Cannot submit milestone in ${this.status} status`);
  }

  this.deliverables = deliverables;
  this.submittedAt = new Date();
  this.status = "submitted";

  // Schedule auto-release
  this.autoReleaseScheduledAt = new Date(
    Date.now() + this.autoReleaseAfterHours * 60 * 60 * 1000
  );

  // Calculate final amount
  this.calculateFinalAmount();

  return this.save();
};

/**
 * Client confirms the milestone
 */
MilestoneSchema.methods.confirm = async function () {
  if (this.status !== "submitted") {
    throw new Error("Can only confirm submitted milestones");
  }

  this.confirmedAt = new Date();
  this.status = "confirmed";
  this.autoReleaseScheduledAt = null; // Clear auto-release

  return this.save();
};

/**
 * Request revision (client)
 */
MilestoneSchema.methods.requestRevision = async function (note, requestedBy) {
  if (this.status !== "submitted") {
    throw new Error("Can only request revision for submitted milestones");
  }

  if (this.revisionCount >= this.maxRevisions) {
    throw new Error(`Maximum revisions (${this.maxRevisions}) reached`);
  }

  this.revisionCount += 1;
  this.revisionNotes.push({
    note,
    requestedAt: new Date(),
    requestedBy,
  });
  this.status = "revision";
  this.autoReleaseScheduledAt = null; // Reset auto-release

  return this.save();
};

/**
 * File dispute
 */
MilestoneSchema.methods.dispute = async function (reason, disputedBy) {
  if (!["submitted", "revision", "confirmed"].includes(this.status)) {
    throw new Error("Cannot dispute milestone in current status");
  }

  this.status = "disputed";
  this.disputeReason = reason;
  this.disputedAt = new Date();
  this.autoReleaseScheduledAt = null;

  return this.save();
};

/**
 * Release payment
 */
MilestoneSchema.methods.release = async function () {
  if (this.status !== "confirmed" && this.status !== "submitted") {
    throw new Error("Cannot release payment for unconfirmed milestone");
  }

  this.status = "released";
  this.releasedAt = new Date();

  return this.save();
};

/**
 * Check if auto-release should trigger
 */
MilestoneSchema.methods.shouldAutoRelease = function () {
  if (this.status !== "submitted") return false;
  if (!this.autoReleaseScheduledAt) return false;

  return Date.now() >= new Date(this.autoReleaseScheduledAt).getTime();
};

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Get all milestones due for auto-release
 */
MilestoneSchema.statics.getDueForAutoRelease = async function () {
  return this.find({
    status: "submitted",
    autoReleaseScheduledAt: { $lte: new Date() },
  });
};

/**
 * Get milestone summary for a project
 */
MilestoneSchema.statics.getProjectSummary = async function (projectId) {
  const milestones = await this.find({ projectId }).sort({ milestoneNumber: 1 });

  const summary = {
    total: milestones.length,
    totalAmount: 0,
    released: 0,
    releasedAmount: 0,
    pending: 0,
    inProgress: 0,
    disputed: 0,
  };

  for (const m of milestones) {
    summary.totalAmount += m.amount;
    if (m.status === "released") {
      summary.released += 1;
      summary.releasedAmount += m.finalAmount || m.amount;
    } else if (m.status === "pending") {
      summary.pending += 1;
    } else if (["in_progress", "submitted", "revision", "confirmed"].includes(m.status)) {
      summary.inProgress += 1;
    } else if (m.status === "disputed") {
      summary.disputed += 1;
    }
  }

  return summary;
};

module.exports = mongoose.model("Milestone", MilestoneSchema);
