/**
 * walletHelper.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralized wallet operation helpers used across routes.
 *
 * Every function that modifies a wallet MUST be called inside a mongoose
 * session/transaction (pass `session` as the last argument).
 *
 * Flow overview:
 *  Client pays via Razorpay
 *    → creditWallet(clientId, amount, "deposit", ...)           [balance ↑]
 *    → holdEscrow(clientId, amount, projectId, escrowId, ...)   [balance ↓, escrowBalance ↑]
 *
 *  Client releases payment / milestone confirmed
 *    → releaseEscrow(clientId, freelancerId, amount, ...)       [clientEscrowBalance ↓, freelancerBalance ↑]
 *
 *  Project cancelled / admin refunds client
 *    → refundEscrow(clientId, amount, projectId, escrowId, ...) [escrowBalance ↓, balance ↑]
 *
 *  Freelancer withdraws earnings
 *    → debitWallet(freelancerId, amount, "withdrawal", ...)     [balance ↓]
 *
 *  Admin adjusts wallet
 *    → adminAdjustWallet(userId, delta, adminId, description, session)
 */

const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function _saveTransaction(data, session) {
  const [tx] = await WalletTransaction.create([data], { session });
  return tx;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Credit a user's available balance (e.g. after Razorpay deposit).
 */
async function creditWallet(userId, amount, description, referenceId, referenceModel, session) {
  const wallet = await Wallet.findOneAndUpdate(
    { userId },
    { $inc: { balance: amount } },
    { new: true, upsert: true, session }
  );

  await _saveTransaction({
    walletId: wallet._id,
    userId,
    type: "deposit",
    amount,
    balanceAfter: wallet.balance,
    escrowBalanceAfter: wallet.escrowBalance,
    status: "completed",
    referenceId,
    referenceModel,
    description,
  }, session);

  return wallet;
}

/**
 * Lock funds from client's balance into escrow for a specific project.
 * client.balance -= amount
 * client.escrowBalance += amount
 */
async function holdEscrow(clientId, amount, escrowId, projectId, description, session) {
  // Atomically deduct from balance & add to escrowBalance only if sufficient
  const wallet = await Wallet.findOneAndUpdate(
    { userId: clientId, balance: { $gte: amount } },
    {
      $inc: { balance: -amount, escrowBalance: amount },
    },
    { new: true, upsert: false, session }
  );

  if (!wallet) {
    throw new Error("Insufficient wallet balance to fund escrow");
  }

  await _saveTransaction({
    walletId: wallet._id,
    userId: clientId,
    type: "escrow_hold",
    amount,
    balanceAfter: wallet.balance,
    escrowBalanceAfter: wallet.escrowBalance,
    status: "completed",
    referenceId: projectId,
    referenceModel: "Project",
    escrowId,
    description,
  }, session);

  return wallet;
}

/**
 * Release funds from client's escrow to freelancer's available balance.
 * client.escrowBalance -= amount
 * freelancer.balance += amount
 */
async function releaseEscrow(
  clientId, freelancerId, amount, escrowId, projectId, description, session
) {
  // Deduct from client escrow
  const clientWallet = await Wallet.findOneAndUpdate(
    { userId: clientId, escrowBalance: { $gte: amount } },
    { $inc: { escrowBalance: -amount } },
    { new: true, upsert: false, session }
  );

  if (!clientWallet) {
    throw new Error("Insufficient client escrow balance");
  }

  // Credit freelancer balance
  const freelancerWallet = await Wallet.findOneAndUpdate(
    { userId: freelancerId },
    { $inc: { balance: amount } },
    { new: true, upsert: true, session }
  );

  const baseData = {
    status: "completed",
    referenceId: projectId,
    referenceModel: "Project",
    escrowId,
    description,
  };

  await _saveTransaction({
    ...baseData,
    walletId: clientWallet._id,
    userId: clientId,
    type: "escrow_release",
    amount: -amount, // debit
    balanceAfter: clientWallet.balance,
    escrowBalanceAfter: clientWallet.escrowBalance,
  }, session);

  await _saveTransaction({
    ...baseData,
    walletId: freelancerWallet._id,
    userId: freelancerId,
    type: "escrow_release",
    amount, // credit
    balanceAfter: freelancerWallet.balance,
    escrowBalanceAfter: freelancerWallet.escrowBalance,
  }, session);

  return { clientWallet, freelancerWallet };
}

/**
 * Refund funds from client's escrow back to client's available balance.
 * client.escrowBalance -= amount
 * client.balance += amount
 */
async function refundEscrow(clientId, amount, escrowId, projectId, description, session) {
  const wallet = await Wallet.findOneAndUpdate(
    { userId: clientId, escrowBalance: { $gte: amount } },
    { $inc: { escrowBalance: -amount, balance: amount } },
    { new: true, upsert: false, session }
  );

  if (!wallet) {
    throw new Error("Insufficient escrow balance to refund");
  }

  await _saveTransaction({
    walletId: wallet._id,
    userId: clientId,
    type: "escrow_refund",
    amount,
    balanceAfter: wallet.balance,
    escrowBalanceAfter: wallet.escrowBalance,
    status: "completed",
    referenceId: projectId,
    referenceModel: "Project",
    escrowId,
    description,
  }, session);

  return wallet;
}

/**
 * Debit a user's available balance (e.g. when freelancer requests withdrawal).
 * Will throw if the user's wallet has withdrawalsBlocked = true.
 */
async function debitWallet(userId, amount, referenceId, referenceModel, description, session) {
  // ── Enforcement: check if withdrawals are frozen for this user ──
  const walletCheck = await Wallet.findOne({ userId }).session(session);
  if (walletCheck && walletCheck.withdrawalsBlocked) {
    throw new Error(
      `Withdrawals are currently blocked for this account. Reason: ${
        walletCheck.withdrawalBlockedReason || "Admin hold"
      }`
    );
  }

  const wallet = await Wallet.findOneAndUpdate(
    { userId, balance: { $gte: amount } },
    { $inc: { balance: -amount } },
    { new: true, upsert: false, session }
  );

  if (!wallet) {
    throw new Error("Insufficient wallet balance for withdrawal");
  }

  await _saveTransaction({
    walletId: wallet._id,
    userId,
    type: "withdrawal",
    amount: -amount,
    balanceAfter: wallet.balance,
    escrowBalanceAfter: wallet.escrowBalance,
    status: "pending",
    referenceId,
    referenceModel,
    description,
  }, session);

  return wallet;
}

/**
 * Admin manually adjusts a wallet (positive or negative delta).
 */
async function adminAdjustWallet(userId, delta, adminId, description, session) {
  const updateExpr =
    delta >= 0
      ? { $inc: { balance: delta } }
      : { $inc: { balance: delta } }; // handled identically; the $gte guard is omitted for admin

  const wallet = await Wallet.findOneAndUpdate(
    { userId },
    updateExpr,
    { new: true, upsert: true, session }
  );

  await _saveTransaction({
    walletId: wallet._id,
    userId,
    type: "admin_adjustment",
    amount: delta,
    balanceAfter: wallet.balance,
    escrowBalanceAfter: wallet.escrowBalance,
    status: "completed",
    description,
    performedBy: adminId,
  }, session);

  return wallet;
}

/**
 * Admin-forced clawback: debit freelancer balance (ignoring withdrawalsBlocked)
 * and credit the original client's balance.
 *
 * Use when a frozen freelancer has already received payment that must be reversed.
 *
 * @param {ObjectId} freelancerId   - user whose wallet is debited
 * @param {ObjectId} clientId       - user who receives the refunded amount
 * @param {Number}   amount         - positive amount to reverse
 * @param {ObjectId} projectId      - reference for the transaction log
 * @param {ObjectId} adminId        - admin performing the action
 * @param {String}   reason         - audit reason string
 * @param {Object}   session        - mongoose session
 */
async function adminClawback(freelancerId, clientId, amount, projectId, adminId, reason, session) {
  // Debit freelancer — no withdrawalsBlocked guard (admin override)
  const freelancerWallet = await Wallet.findOneAndUpdate(
    { userId: freelancerId, balance: { $gte: amount } },
    { $inc: { balance: -amount } },
    { new: true, upsert: false, session }
  );

  if (!freelancerWallet) {
    throw new Error(
      `Clawback failed: freelancer has insufficient balance (requested ₹${amount})`
    );
  }

  // Credit client
  const clientWallet = await Wallet.findOneAndUpdate(
    { userId: clientId },
    { $inc: { balance: amount } },
    { new: true, upsert: true, session }
  );

  const baseData = {
    status: "completed",
    referenceId: projectId,
    referenceModel: "Project",
    description: reason,
    performedBy: adminId,
  };

  await _saveTransaction({
    ...baseData,
    walletId: freelancerWallet._id,
    userId: freelancerId,
    type: "admin_clawback",
    amount: -amount,
    balanceAfter: freelancerWallet.balance,
    escrowBalanceAfter: freelancerWallet.escrowBalance,
  }, session);

  await _saveTransaction({
    ...baseData,
    walletId: clientWallet._id,
    userId: clientId,
    type: "admin_clawback",
    amount,
    balanceAfter: clientWallet.balance,
    escrowBalanceAfter: clientWallet.escrowBalance,
  }, session);

  return { freelancerWallet, clientWallet };
}

/**
 * Get a wallet (or create one) without a session — for read-only ops.
 */
async function getWallet(userId) {
  return Wallet.findOrCreate(userId);
}

/**
 * Reverse a previously debited withdrawal — used when admin REJECTS a payout.
 * Credits back amount to user's balance and marks WalletTransaction as reversed.
 *
 * @param {ObjectId} userId        - freelancer whose wallet is credited back
 * @param {Number}   amount        - positive withdrawal amount to return
 * @param {ObjectId} withdrawalId  - AdminWithdraw document ID
 * @param {Object}   session       - mongoose session
 */
async function reverseWithdrawal(userId, amount, withdrawalId, session) {
  // Credit the amount back to the user's available balance
  const wallet = await Wallet.findOneAndUpdate(
    { userId },
    { $inc: { balance: amount } },
    { new: true, upsert: false, session }
  );

  if (!wallet) {
    throw new Error("Cannot reverse withdrawal: wallet not found for user");
  }

  // Log a reversal transaction
  await _saveTransaction({
    walletId: wallet._id,
    userId,
    type: "withdrawal_reversal",
    amount,           // positive = credited back
    balanceAfter: wallet.balance,
    escrowBalanceAfter: wallet.escrowBalance,
    status: "completed",
    referenceId: withdrawalId,
    referenceModel: "AdminWithdraw",
    description: "Withdrawal rejected by admin — amount returned to wallet",
  }, session);

  // Also find and mark the original pending withdrawal WalletTransaction as reversed
  await WalletTransaction.findOneAndUpdate(
    {
      userId,
      type: "withdrawal",
      status: "pending",
      referenceId: withdrawalId,
    },
    { status: "reversed" },
    { session }
  );

  return wallet;
}

module.exports = {
  creditWallet,
  holdEscrow,
  releaseEscrow,
  refundEscrow,
  debitWallet,
  adminAdjustWallet,
  adminClawback,
  reverseWithdrawal,
  getWallet,
};
