const mongoose = require("mongoose");

/**
 * Wallet Model — Global per-user balance tracker
 *
 * Each user (client or freelancer) has exactly ONE Wallet document.
 * - balance:        Funds freely available for withdrawal or spending
 * - escrowBalance:  Funds locked inside active project escrows (client-side)
 *
 * A WalletTransaction is created for every state change, giving a complete
 * and tamper-evident audit trail.
 */
const WalletSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true, // One wallet per user
    },

    // Available balance: freelancer earnings ready to withdraw,
    // or client funds not yet locked into a project
    balance: {
      type: Number,
      default: 0,
      min: [0, "Balance cannot go below zero"],
    },

    // Funds locked into ongoing project escrows (client-side only in practice)
    escrowBalance: {
      type: Number,
      default: 0,
      min: [0, "Escrow balance cannot go below zero"],
    },

    currency: {
      type: String,
      default: "INR",
    },

    // ── Admin withdrawal controls ──────────────────────────────────────────────
    /** When true, the user's balance cannot be debited for a withdrawal. */
    withdrawalsBlocked: {
      type: Boolean,
      default: false,
    },
    withdrawalBlockedReason: {
      type: String,
      default: null,
    },
    withdrawalBlockedAt: {
      type: Date,
      default: null,
    },
    withdrawalBlockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

// ─── Statics ──────────────────────────────────────────────────────────────────

/**
 * Find or create a wallet for a given user.
 * Safe to call concurrently; mongo unique index prevents duplicates.
 */
WalletSchema.statics.findOrCreate = async function (userId) {
  let wallet = await this.findOne({ userId });
  if (!wallet) {
    wallet = await this.create({ userId });
  }
  return wallet;
};

// ─── Instance helpers ─────────────────────────────────────────────────────────

/** Total funds owned by this user (available + locked) */
WalletSchema.methods.totalBalance = function () {
  return this.balance + this.escrowBalance;
};

module.exports = mongoose.model("Wallet", WalletSchema);
