const mongoose = require("mongoose");

/**
 * WalletTransaction Model — Immutable ledger of every money movement
 *
 * Transaction types:
 *  deposit             – External money added by user (Razorpay payment verified)
 *  escrow_hold         – Funds moved from client balance → escrow (project funded)
 *  escrow_release      – Funds moved from client escrow → freelancer balance
 *  escrow_refund       – Funds returned from client escrow → client balance
 *  withdrawal          – Freelancer requests bank transfer (pending admin approval)
 *  withdrawal_reversal – Admin rejects payout; debited amount returned to freelancer
 *  admin_adjustment    – Admin manually credits / debits a wallet
 */
const WalletTransactionSchema = new mongoose.Schema(
  {
    walletId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Wallet",
      required: true,
      index: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: [
        "deposit",
        "escrow_hold",
        "escrow_release",
        "escrow_refund",
        "withdrawal",
        "withdrawal_reversal",
        "admin_adjustment",
        "admin_clawback",
      ],
      required: true,
    },

    // Positive = credit, Negative = debit (for adjustments)
    amount: {
      type: Number,
      required: true,
    },

    // Snapshot of the wallet balance AFTER this transaction
    balanceAfter: { type: Number },
    escrowBalanceAfter: { type: Number },

    status: {
      type: String,
      enum: ["pending", "completed", "failed", "reversed"],
      default: "completed",
    },

    // Optional link to the business entity that triggered this transaction
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    referenceModel: {
      type: String,
      enum: ["Project", "Agreement", "Milestone", "Dispute", "AdminWithdraw"],
    },

    // The Escrow document (project fund lock) that this transaction relates to
    escrowId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Escrow",
    },

    description: {
      type: String,
      trim: true,
    },

    // For admin-initiated adjustments
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
    // Transactions should never be mutated once written
    strict: true,
  }
);

// Index for fast per-user history queries
WalletTransactionSchema.index({ userId: 1, createdAt: -1 });
WalletTransactionSchema.index({ walletId: 1, type: 1 });
WalletTransactionSchema.index({ referenceId: 1, referenceModel: 1 });

module.exports = mongoose.model("WalletTransaction", WalletTransactionSchema);
