const mongoose = require("mongoose");
const crypto = require("crypto");

// ============================================================================
// SIGNATURE SUB-SCHEMA
// ============================================================================

const SignatureSchema = new mongoose.Schema(
  {
    signed: {
      type: Boolean,
      default: false,
    },
    signedAt: {
      type: Date,
      default: null,
    },
    ipAddress: {
      type: String,
      default: null,
    },
    userAgent: {
      type: String,
      default: null,
    },
    signatureHash: {
      type: String,
      default: null,
    },
  },
  { _id: false }


);



// ============================================================================
// AMENDMENT HISTORY SUB-SCHEMA
// ============================================================================

const AmendmentSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true },
    previousAmount: { type: Number },
    newAmount: { type: Number },
    reason: { type: String },
    amendedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    amendedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// ============================================================================
// MAIN AGREEMENT SCHEMA
// ============================================================================

const AgreementSchema = new mongoose.Schema(
  {
    // Reference IDs
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
    bidId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bid",
      required: true,
    },
    parentAgreementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agreement",
      default: null,
    },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    freelancerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Agreement Version Control
    version: {
      type: Number,
      default: 1,
    },
    amendmentHistory: [AmendmentSchema],

    // Agreement Terms (Snapshot at creation)
    projectTitle: {
      type: String,
      required: true,
    },
    projectDescription: {
      type: String,
      required: true,
    },
    agreedAmount: {
      type: Number,
      required: true,
    },
    platformFee: {
      type: Number,
      required: true,
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    deadline: {
      type: Date,
      required: true,
    },
    deliverables: {
      type: String,
      required: true,
    },

    // Standard Platform Terms
    terms: {
      type: String,
      default: `
FREELANCERHUB PROJECT AGREEMENT

1. SCOPE OF WORK
The Freelancer agrees to complete the project as described in the deliverables section above.

2. PAYMENT TERMS
- Payment is held in escrow until project completion
- Platform fee is deducted from the total amount
- Freelancer receives the agreed amount upon client approval

3. TIMELINE
- Work must be completed by the specified deadline
- Extensions require mutual agreement and may require contract amendment

4. INTELLECTUAL PROPERTY
- Upon full payment, all work product becomes the property of the Client
- Freelancer may retain samples for portfolio purposes unless otherwise specified

5. CONFIDENTIALITY
- Both parties agree to maintain confidentiality of project details
- NDA provisions apply as specified in FreelancerHub terms of service

6. DISPUTE RESOLUTION
- Disputes will be handled through FreelancerHub's dispute resolution system
- Platform decisions are final and binding

7. CANCELLATION
- Either party may request cancellation before work begins
- Partial refunds may apply for cancelled work-in-progress

By signing this agreement, both parties acknowledge they have read, understood, and agree to these terms.
      `.trim(),
    },

    // Signatures
    clientSignature: {
      type: SignatureSchema,
      default: () => ({}),
    },
    freelancerSignature: {
      type: SignatureSchema,
      default: () => ({}),
    },

    // Agreement Status
    status: {
      type: String,
      enum: [
        "draft",               // Client can edit, not sent for signing yet
        "pending_freelancer",  // Sent for signing, waiting for freelancer
        "pending_client",      // Freelancer signed, waiting for client
        "active",              // Both signed, work can begin
        "completed",           // Project completed under this agreement
        "cancelled",           // Agreement cancelled
        "disputed",            // Under dispute
        "amended",             // Replaced by newer version
      ],
      default: "draft",
      index: true,
    },
    cancellation: {
      reason: { type: String },
      cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      cancelledAt: { type: Date },
    },


    // Metadata
    agreementNumber: {
      type: String,
      unique: true,
      index: true,
    },
    contentHash: {
      type: String,
    },
  },
  { timestamps: true }
);

// ============================================================================
// INDEXES
// ============================================================================

AgreementSchema.index({ projectId: 1, version: -1 });
AgreementSchema.index({ clientId: 1, status: 1 });
AgreementSchema.index({ freelancerId: 1, status: 1 });

// ============================================================================
// PRE-SAVE HOOKS
// ============================================================================

AgreementSchema.pre("save", async function (next) {
  // Generate agreement number if new
  if (this.isNew && !this.agreementNumber) {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = crypto.randomBytes(3).toString("hex").toUpperCase();
    this.agreementNumber = `AGR-${timestamp}-${random}`;
  }

  // Generate content hash for integrity verification
  if (
    this.isModified("agreedAmount") ||
    this.isModified("deliverables") ||
    this.isModified("terms") ||
    this.isModified("projectDescription") ||
    this.isModified("projectTitle") ||
    this.isModified("deadline") ||
    this.isNew
  )
 {
    const contentToHash = JSON.stringify({
      projectId: this.projectId.toString(),
      clientId: this.clientId.toString(),
      freelancerId: this.freelancerId.toString(),
      agreedAmount: this.agreedAmount,
      deadline: this.deadline.toISOString(),
      deliverables: this.deliverables,
      version: this.version,
      projectTitle: this.projectTitle,
      terms: this.terms,
      projectDescription: this.projectDescription,
    });
    this.contentHash = crypto.createHash("sha256").update(contentToHash).digest("hex");
  }

  next();
});

// ============================================================================
// INSTANCE METHODS
// ============================================================================

/**
 * Sign the agreement as client (after freelancer has signed)
 */
AgreementSchema.methods.signAsClient = async function (ipAddress, userAgent) {
  if (this.clientSignature.signed) {
    throw new Error("Client has already signed this agreement");
  }

  if (this.status !== "pending_client") {
    throw new Error("Agreement is not pending client signature. Freelancer must sign first.");
  }

  if (!this.freelancerSignature.signed) {
    throw new Error("Freelancer must sign the agreement first");
  }

  this.clientSignature = {
    signed: true,
    signedAt: new Date(),
    ipAddress: ipAddress || "unknown",
    userAgent: userAgent || "unknown",
    signatureHash: crypto
      .createHash("sha256")
      .update(`${this.contentHash}:client:${Date.now()}`)
      .digest("hex"),
  };

  this.status = "active";
  return this.save();
};

/**
 * Sign the agreement as freelancer (first to sign)
 */
AgreementSchema.methods.signAsFreelancer = async function (ipAddress, userAgent) {
  if (this.freelancerSignature.signed) {
    throw new Error("Freelancer has already signed this agreement");
  }

  if (this.status !== "pending_freelancer") {
    throw new Error("Agreement is not pending freelancer signature");
  }

  this.freelancerSignature = {
    signed: true,
    signedAt: new Date(),
    ipAddress: ipAddress || "unknown",
    userAgent: userAgent || "unknown",
    signatureHash: crypto
      .createHash("sha256")
      .update(`${this.contentHash}:freelancer:${Date.now()}`)
      .digest("hex"),
  };

  // Freelancer signed, now waiting for client
  this.status = "pending_client";
  return this.save();
};

/**
 * Send agreement for signing (client action)
 * Changes status from draft to pending_freelancer
 */
AgreementSchema.methods.sendForSigning = async function () {
  if (this.status !== "draft") {
    throw new Error("Only draft agreements can be sent for signing");
  }

  this.status = "pending_freelancer";
  return this.save();
};

/**
 * Update agreement terms (client action, only in draft status)
 */
AgreementSchema.methods.updateTerms = async function (updates) {
  if (this.status !== "draft") {
    throw new Error("Agreement can only be edited while in draft status");
  }

  const allowedFields = ["deliverables", "deadline", "agreedAmount", "projectDescription"];
  
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      this[field] = updates[field];
    }
  }

  // Recalculate total if amount changed
  if (updates.agreedAmount !== undefined) {
    this.totalAmount = updates.agreedAmount + this.platformFee;
  }

  return this.save();
};

/**
 * Check if agreement is fully signed
 */
AgreementSchema.methods.isFullySigned = function () {
  return this.clientSignature.signed && this.freelancerSignature.signed;
};

/**
 * Cancel the agreement
 */
AgreementSchema.methods.cancelWithRollback = async function (
  reason,
  cancelledBy
) {

  if (this.status === "cancelled") {
    throw new Error("Agreement is already cancelled");
  }

  if (["active", "completed"].includes(this.status)) {
    throw new Error("Active agreements must go through dispute flow");
  }


  const Agreement = mongoose.model("Agreement");

  // Cancel current agreement
  this.status = "cancelled";
  this.cancellation = {
    reason: reason || "No reason provided",
    cancelledBy: cancelledBy || null,
    cancelledAt: new Date(),
  };
  await this.save();

  // Rollback logic for amendments
  if (this.version >= 1 && this.parentAgreementId) {
    const previous = await Agreement.findById(this.parentAgreementId);

    if (
      previous &&
      previous.status === "amended" &&
      previous.isFullySigned()
    ) {
      previous.status = "active";
      await previous.save();
    }
  }

  return this;
};



/**
 * Create an amended version of this agreement
 */
AgreementSchema.methods.createAmendment = async function (newAmount, reason, amendedBy) {

  if (!this.isFullySigned() || this.status !== "active") {
    throw new Error("Only active, fully signed agreements can be amended");
  }

  // Mark current as amended
  this.status = "amended";
  await this.save();

  // Create new agreement with incremented version
  const Agreement = mongoose.model("Agreement");
  const newAgreement = new Agreement({
    parentAgreementId: this._id,
    projectId: this.projectId,
    bidId: this.bidId,
    clientId: this.clientId,
    freelancerId: this.freelancerId,
    version: this.version + 1,
    clientSignature: {},
    freelancerSignature: {},
    amendmentHistory: [
      ...this.amendmentHistory,
      {
        version: this.version,
        previousAmount: this.agreedAmount,
        newAmount: newAmount,
        reason: reason,
        amendedBy: amendedBy,
        amendedAt: new Date(),
      },
    ],
    projectTitle: this.projectTitle,
    projectDescription: this.projectDescription,
    agreedAmount: newAmount,
    platformFee: this.platformFee,
    totalAmount: newAmount + this.platformFee,
    deadline: this.deadline,
    deliverables: this.deliverables,
    status: "draft", // Both must re-sign
  });

  return newAgreement.save();
};

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Get active agreement for a project
 */
AgreementSchema.statics.getCurrentAgreementForProject = async function (projectId) {
  return this.findOne({
    projectId: projectId,
    status: { $in: ["draft", "pending_client", "pending_freelancer", "active"] },
  }).sort({ version: -1 });
};

/**
 * Check if project has a fully signed agreement
 */
AgreementSchema.statics.hasSignedAgreement = async function (projectId) {
  const agreement = await this.findOne({
    projectId: projectId,
    status: "active",
  });
  return !!agreement;
};

/**
 * Verify agreement integrity - check if content hash matches current data
 */
AgreementSchema.methods.verifyIntegrity = function () {
  const contentToHash = JSON.stringify({
    projectId: this.projectId.toString(),
    clientId: this.clientId.toString(),
    freelancerId: this.freelancerId.toString(),
    agreedAmount: this.agreedAmount,
    deadline: this.deadline.toISOString(),
    deliverables: this.deliverables,
    terms: this.terms,
    projectDescription: this.projectDescription,
    projectTitle: this.projectTitle,
    version: this.version,
  });
  const calculatedHash = crypto.createHash("sha256").update(contentToHash).digest("hex");
  return calculatedHash === this.contentHash;
};

/**
 * Get verification details for transparency
 */
AgreementSchema.methods.getVerificationDetails = function () {
  return {
    agreementNumber: this.agreementNumber,
    version: this.version,
    contentHash: this.contentHash,
    isIntact: this.verifyIntegrity(),
    clientSignature: this.clientSignature.signed ? {
      signed: true,
      signedAt: this.clientSignature.signedAt,
      signatureHash: this.clientSignature.signatureHash,
    } : { signed: false },
    freelancerSignature: this.freelancerSignature.signed ? {
      signed: true,
      signedAt: this.freelancerSignature.signedAt,
      signatureHash: this.freelancerSignature.signatureHash,
    } : { signed: false },
    status: this.status,
    agreedAmount: this.agreedAmount,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

AgreementSchema.index(
  { projectId: 1 },
  { unique: true, partialFilterExpression: { status: "active" } }
);


module.exports = mongoose.model("Agreement", AgreementSchema);
