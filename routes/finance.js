const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { verifyToken, authorize } = require("../middleware/Auth");
const WalletTransaction = require("../models/WalletTransaction");
const Wallet = require("../models/Wallet");
const Milestone = require("../models/Milestone");
const Agreement = require("../models/Agreement");
const Project = require("../models/Project");
const User = require("../models/User");

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const isValidObjectId = (id) => {
  return (
    mongoose.Types.ObjectId.isValid(id) &&
    new mongoose.Types.ObjectId(id).toString() === id
  );
};

/**
 * Format currency for display
 */
const formatCurrency = (amount) => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
};

// ============================================================================
// ROUTES
// ============================================================================

/**
 * GET /finance/dashboard
 * Get comprehensive income dashboard for a freelancer
 */
router.get(
  "/dashboard",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const freelancerId = req.user.userId;

      // ── Wallet snapshot ──
      const wallet = await Wallet.findOne({ userId: freelancerId });
      const availableBalance = wallet ? wallet.balance : 0;
      const escrowBalance = wallet ? wallet.escrowBalance : 0;

      // ── All completed payments received by freelancer ──
      const payments = await WalletTransaction.find({
        userId: freelancerId,
        type: "escrow_release",
        status: "completed",
        amount: { $gt: 0 }, // credit side only
      })
        .populate({ path: "referenceId", model: "Project", select: "title clientId" })
        .sort({ createdAt: -1 });

      // Calculate totals
      const totalEarnings = payments.reduce((sum, p) => sum + p.amount, 0);

      // This month
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const thisMonthEarnings = payments
        .filter((p) => new Date(p.createdAt) >= monthStart)
        .reduce((sum, p) => sum + p.amount, 0);

      // This year
      const yearStart = new Date(new Date().getFullYear(), 0, 1);
      const thisYearEarnings = payments
        .filter((p) => new Date(p.createdAt) >= yearStart)
        .reduce((sum, p) => sum + p.amount, 0);

      // Pending milestone earnings
      const pendingMilestones = await Milestone.find({
        freelancerId,
        status: { $in: ["submitted", "confirmed"] },
      });
      const pendingAmount = pendingMilestones.reduce(
        (sum, m) => sum + (m.finalAmount || m.amount),
        0
      );

      // Project stats
      const completedProjects = await Agreement.countDocuments({
        freelancerId,
        status: "completed",
      });

      const activeProjects = await Agreement.countDocuments({
        freelancerId,
        status: "active",
      });

      const avgPerProject =
        completedProjects > 0 ? totalEarnings / completedProjects : 0;

      // Top clients
      const clientMap = {};
      for (const payment of payments) {
        const clientId = payment.referenceId?.clientId?.toString();
        if (clientId) {
          clientMap[clientId] = (clientMap[clientId] || 0) + payment.amount;
        }
      }

      const topClientIds = Object.entries(clientMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id]) => id);

      const topClients = await User.find({ _id: { $in: topClientIds } }).select(
        "username companyName"
      );

      const topClientsData = topClients.map((client) => ({
        name: client.companyName || client.username,
        totalPaid: clientMap[client._id.toString()],
      }));

      // Monthly breakdown (last 12 months)
      const monthlyBreakdown = [];
      for (let i = 11; i >= 0; i--) {
        const monthDate = new Date();
        monthDate.setMonth(monthDate.getMonth() - i);
        const mStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
        const mEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);

        const monthPayments = payments.filter((p) => {
          const d = new Date(p.createdAt);
          return d >= mStart && d <= mEnd;
        });

        monthlyBreakdown.push({
          month: mStart.toLocaleDateString("en-US", {
            month: "short",
            year: "numeric",
          }),
          earnings: monthPayments.reduce((sum, p) => sum + p.amount, 0),
          projects: new Set(
            monthPayments.map((p) => p.referenceId?._id?.toString())
          ).size,
        });
      }

      res.json({
        wallet: {
          availableBalance,
          escrowBalance,
          totalOwned: availableBalance + escrowBalance,
        },
        summary: {
          totalEarnings,
          thisMonthEarnings,
          thisYearEarnings,
          pendingAmount,
          avgPerProject: Math.round(avgPerProject),
          completedProjects,
          activeProjects,
        },
        topClients: topClientsData,
        monthlyBreakdown,
        recentPayments: payments.slice(0, 10).map((p) => ({
          amount: p.amount,
          projectTitle: p.referenceId?.title || "Unknown",
          date: p.createdAt,
        })),
      });
    } catch (err) {
      console.error("Dashboard Error:", err);
      res.status(500).json({ message: "Error fetching dashboard" });
    }
  }
);

/**
 * GET /finance/tax-summary/:year
 * Get tax-ready earnings summary for a specific year
 */
router.get(
  "/tax-summary/:year",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const freelancerId = req.user.userId;
      const year = parseInt(req.params.year);

      if (isNaN(year) || year < 2020 || year > new Date().getFullYear()) {
        return res.status(400).json({ message: "Invalid year" });
      }

      const yearStart = new Date(year, 0, 1);
      const yearEnd = new Date(year, 11, 31, 23, 59, 59);

      // All earned (released) payments for the year
      const payments = await WalletTransaction.find({
        userId: freelancerId,
        type: "escrow_release",
        status: "completed",
        amount: { $gt: 0 },
        createdAt: { $gte: yearStart, $lte: yearEnd },
      }).populate({ path: "referenceId", model: "Project", select: "title clientId" });

      const user = await User.findById(freelancerId).select("username email");
      const grossEarnings = payments.reduce((sum, p) => sum + p.amount, 0);

      const platformFeeRate = 0.1;
      const estimatedPlatformFee = Math.round(grossEarnings * platformFeeRate);
      const netEarnings = grossEarnings - estimatedPlatformFee;

      const quarters = [
        { name: "Q1 (Jan-Mar)", start: new Date(year, 0, 1), end: new Date(year, 2, 31) },
        { name: "Q2 (Apr-Jun)", start: new Date(year, 3, 1), end: new Date(year, 5, 30) },
        { name: "Q3 (Jul-Sep)", start: new Date(year, 6, 1), end: new Date(year, 8, 30) },
        { name: "Q4 (Oct-Dec)", start: new Date(year, 9, 1), end: new Date(year, 11, 31) },
      ];

      const quarterlyBreakdown = quarters.map((q) => {
        const qPayments = payments.filter((p) => {
          const d = new Date(p.createdAt);
          return d >= q.start && d <= q.end;
        });
        return {
          quarter: q.name,
          gross: qPayments.reduce((sum, p) => sum + p.amount, 0),
          projectCount: new Set(
            qPayments.map((p) => p.referenceId?._id?.toString())
          ).size,
        };
      });

      const clientBreakdown = {};
      for (const payment of payments) {
        const clientId = payment.referenceId?.clientId?.toString();
        const projectId = payment.referenceId?._id?.toString();
        if (clientId) {
          if (!clientBreakdown[clientId]) {
            clientBreakdown[clientId] = { total: 0, projects: new Set() };
          }
          clientBreakdown[clientId].total += payment.amount;
          clientBreakdown[clientId].projects.add(projectId);
        }
      }

      const clientIds = Object.keys(clientBreakdown);
      const clients = await User.find({ _id: { $in: clientIds } }).select(
        "username companyName email"
      );

      const clientSummary = clients.map((c) => ({
        name: c.companyName || c.username,
        email: c.email,
        totalPaid: clientBreakdown[c._id.toString()].total,
        projectCount: clientBreakdown[c._id.toString()].projects.size,
      }));

      res.json({
        taxYear: year,
        freelancer: { name: user.username, email: user.email },
        earnings: { gross: grossEarnings, estimatedPlatformFee, net: netEarnings },
        quarterlyBreakdown,
        clientSummary: clientSummary.sort((a, b) => b.totalPaid - a.totalPaid),
        totalProjects: new Set(
          payments.map((p) => p.referenceId?._id?.toString())
        ).size,
        paymentCount: payments.length,
        disclaimer:
          "This is an estimated summary. Please consult a tax professional for accurate filing.",
      });
    } catch (err) {
      console.error("Tax Summary Error:", err);
      res.status(500).json({ message: "Error generating tax summary" });
    }
  }
);

/**
 * POST /finance/invoice/generate
 * Generate a simple HTML invoice from milestones or custom items
 */
router.post(
  "/invoice/generate",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const freelancerId = req.user.userId;
      const { projectId, milestoneId, customItems } = req.body;

      const freelancer = await User.findById(freelancerId).select(
        "username email location"
      );

      let invoiceItems = [];
      let client = null;
      let projectTitle = "";

      if (projectId && isValidObjectId(projectId)) {
        const project = await Project.findById(projectId).populate(
          "clientId",
          "username email companyName"
        );

        if (!project) {
          return res.status(404).json({ message: "Project not found" });
        }

        client = project.clientId;
        projectTitle = project.title;

        if (milestoneId && isValidObjectId(milestoneId)) {
          const milestone = await Milestone.findById(milestoneId);
          if (milestone) {
            invoiceItems.push({
              description: `Milestone: ${milestone.title}`,
              amount: milestone.finalAmount || milestone.amount,
            });
          }
        } else {
          const milestones = await Milestone.find({
            projectId,
            freelancerId,
            status: "released",
          });
          invoiceItems = milestones.map((m) => ({
            description: `Milestone ${m.milestoneNumber}: ${m.title}`,
            amount: m.finalAmount || m.amount,
          }));
        }
      } else if (Array.isArray(customItems)) {
        invoiceItems = customItems.filter((item) => item.description && item.amount);
      } else {
        return res.status(400).json({ message: "Project ID or custom items required" });
      }

      if (invoiceItems.length === 0) {
        return res.status(400).json({ message: "No items for invoice" });
      }

      const subtotal = invoiceItems.reduce((sum, item) => sum + item.amount, 0);
      const platformFee = Math.round(subtotal * 0.1);
      const total = subtotal;

      const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}-${Math.random()
        .toString(36)
        .substring(2, 6)
        .toUpperCase()}`;

      const invoiceHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Invoice ${invoiceNumber}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; }
    .header { display: flex; justify-content: space-between; border-bottom: 2px solid #4CAF50; padding-bottom: 20px; }
    .logo { font-size: 24px; font-weight: bold; color: #4CAF50; }
    .invoice-info { text-align: right; }
    .parties { display: flex; justify-content: space-between; margin: 30px 0; }
    .from, .to { width: 45%; }
    .label { font-weight: bold; color: #666; margin-bottom: 5px; }
    table { width: 100%; border-collapse: collapse; margin: 30px 0; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f5f5f5; }
    .total-row { font-weight: bold; font-size: 18px; background: #e8f5e9; }
    .footer { margin-top: 40px; text-align: center; color: #888; font-size: 12px; }
    .amount { text-align: right; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">FreelancerHub</div>
    <div class="invoice-info">
      <h2>INVOICE</h2>
      <p><strong>${invoiceNumber}</strong></p>
      <p>Date: ${new Date().toLocaleDateString("en-IN")}</p>
    </div>
  </div>
  <div class="parties">
    <div class="from">
      <div class="label">FROM</div>
      <strong>${freelancer.username}</strong><br>
      ${freelancer.email}<br>
      ${freelancer.location || ""}
    </div>
    <div class="to">
      <div class="label">TO</div>
      ${
        client
          ? `<strong>${client.companyName || client.username}</strong><br>${client.email}`
          : "Custom Invoice"
      }
    </div>
  </div>
  ${projectTitle ? `<p><strong>Project:</strong> ${projectTitle}</p>` : ""}
  <table>
    <thead>
      <tr><th>Description</th><th class="amount">Amount</th></tr>
    </thead>
    <tbody>
      ${invoiceItems
          .map(
            (item) =>
              `<tr><td>${item.description}</td><td class="amount">${formatCurrency(
                item.amount
              )}</td></tr>`
          )
          .join("")}
      <tr class="total-row"><td>TOTAL</td><td class="amount">${formatCurrency(total)}</td></tr>
    </tbody>
  </table>
  <p><strong>Platform Fee (deducted):</strong> ${formatCurrency(platformFee)}</p>
  <p><strong>Net Payable to Freelancer:</strong> ${formatCurrency(total - platformFee)}</p>
  <div class="footer"><p>Generated by FreelancerHub | This is a computer-generated invoice</p></div>
</body>
</html>
      `;

      res.json({
        invoiceNumber,
        invoiceHtml,
        summary: {
          subtotal,
          platformFee,
          total,
          netPayable: total - platformFee,
          itemCount: invoiceItems.length,
        },
      });
    } catch (err) {
      console.error("Invoice Generate Error:", err);
      res.status(500).json({ message: "Error generating invoice" });
    }
  }
);

/**
 * GET /finance/predictions
 * Get earnings predictions based on last 6 months of WalletTransactions
 */
router.get(
  "/predictions",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const freelancerId = req.user.userId;

      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      const payments = await WalletTransaction.find({
        userId: freelancerId,
        type: "escrow_release",
        status: "completed",
        amount: { $gt: 0 },
        createdAt: { $gte: sixMonthsAgo },
      });

      const monthlyEarnings = [];
      for (let i = 5; i >= 0; i--) {
        const monthDate = new Date();
        monthDate.setMonth(monthDate.getMonth() - i);
        const mStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
        const mEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);

        const monthPayments = payments.filter((p) => {
          const d = new Date(p.createdAt);
          return d >= mStart && d <= mEnd;
        });

        monthlyEarnings.push(monthPayments.reduce((sum, p) => sum + p.amount, 0));
      }

      const avgMonthly = monthlyEarnings.reduce((a, b) => a + b, 0) / 6;
      const recentAvg = (monthlyEarnings[4] + monthlyEarnings[5]) / 2;
      const trend = avgMonthly > 0 ? ((recentAvg - avgMonthly) / avgMonthly) * 100 : 0;

      const pendingMilestones = await Milestone.find({
        freelancerId,
        status: { $in: ["in_progress", "submitted", "confirmed"] },
      });
      const pendingIncome = pendingMilestones.reduce(
        (sum, m) => sum + (m.finalAmount || m.amount),
        0
      );

      const activeAgreements = await Agreement.find({ freelancerId, status: "active" });
      const activeProjectsValue = activeAgreements.reduce(
        (sum, a) => sum + a.agreedAmount,
        0
      );

      const nextMonthPrediction = Math.round(avgMonthly * (1 + trend / 100));
      const nextQuarterPrediction = nextMonthPrediction * 3;
      const yearEndPrediction = nextMonthPrediction * (12 - new Date().getMonth());

      res.json({
        historicalData: {
          monthlyEarnings,
          avgMonthly: Math.round(avgMonthly),
          trend: Math.round(trend),
          trendDirection: trend > 0 ? "up" : trend < 0 ? "down" : "stable",
        },
        currentPipeline: {
          pendingIncome,
          activeProjectsValue,
          pendingMilestones: pendingMilestones.length,
        },
        predictions: {
          nextMonth: nextMonthPrediction,
          nextQuarter: nextQuarterPrediction,
          yearEnd: yearEndPrediction,
          confidence:
            monthlyEarnings.filter((e) => e > 0).length >= 3 ? "medium" : "low",
        },
        disclaimer: "Predictions are based on historical data and may vary.",
      });
    } catch (err) {
      console.error("Predictions Error:", err);
      res.status(500).json({ message: "Error generating predictions" });
    }
  }
);

/**
 * GET /finance/wallet
 * Get the current user's wallet details and recent transaction history
 */
router.get(
  "/wallet",
  verifyToken,
  authorize(["freelancer", "client"]),
  async (req, res) => {
    try {
      const userId = req.user.userId;

      const wallet = await Wallet.findOne({ userId });
      if (!wallet) {
        return res.json({
          balance: 0,
          escrowBalance: 0,
          transactions: [],
        });
      }

      const transactions = await WalletTransaction.find({ userId })
        .sort({ createdAt: -1 })
        .limit(50)
        .select("type amount balanceAfter escrowBalanceAfter description status createdAt referenceModel");

      res.json({
        balance: wallet.balance,
        escrowBalance: wallet.escrowBalance,
        totalOwned: wallet.balance + wallet.escrowBalance,
        currency: wallet.currency,
        transactions,
      });
    } catch (err) {
      console.error("Get Wallet Error:", err);
      res.status(500).json({ message: "Error fetching wallet" });
    }
  }
);

// ============================================================================
// ADMIN FINANCIAL TRACKING
// ============================================================================

/**
 * GET /finance/admin/bonus-penalty-summary
 * Admin view: Track all bonus charges, penalty refunds, and deficits
 */
router.get(
  "/admin/bonus-penalty-summary",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      // 1. Fetch all released milestones that have a bonus or penalty
      const completedMilestones = await Milestone.find({
        status: "released",
        $or: [{ bonusAmount: { $gt: 0 } }, { penaltyAmount: { $gt: 0 } }]
      });

      // 2. Calculate totals from Milestones (this ensures historical accuracy)
      const totalBonusesPaid = completedMilestones.reduce((sum, m) => sum + (m.bonusAmount || 0), 0);
      const totalPenaltiesApplied = completedMilestones.reduce((sum, m) => sum + (m.penaltyAmount || 0), 0);

      // 3. Track Pending Deficits via WalletTransactions (active debts from new system)
      const pendingDeficitsTx = await WalletTransaction.find({
        type: "bonus_charge",
        status: "pending",
        amount: { $lt: 0 }
      })
        .populate({ path: "userId", model: "User", select: "username email" })
        .populate({ path: "referenceId", model: "Milestone", select: "title" })
        .sort({ createdAt: -1 });

      const mappedDeficits = pendingDeficitsTx.map((t) => ({
        _id: t._id.toString(),
        clientName: t.userId?.username,
        clientEmail: t.userId?.email,
        amount: Math.abs(t.amount),
        milestoneTitle: t.referenceId?.title || "Unknown",
        description: t.description,
        createdAt: t.createdAt,
      }));

      // 3b. Calculate Legacy Deficits
      // Find completed milestones with bonuses that DO NOT have a bonus_charge transaction
      const legacyBonuses = await Milestone.find({
        status: "released",
        bonusAmount: { $gt: 0 }
      }).populate({ path: "clientId", model: "User", select: "username email" });

      for (const m of legacyBonuses) {
        // Did we charge a bonus for this milestone?
        const hasCharge = await WalletTransaction.exists({
          referenceId: m._id,
          type: "bonus_charge"
        });

        if (!hasCharge) {
          // This is a legacy bonus. Did the client actually pay for it out of wallet?
          // Since old logic pulled from escrow (and if escrow was fully drained, it just bypassed wallet balance),
          // the platform technically paid this bonus. We register it as a legacy deficit.
          mappedDeficits.push({
            _id: `legacy-${m._id.toString()}`,
            clientName: m.clientId?.username,
            clientEmail: m.clientId?.email,
            amount: m.bonusAmount,
            milestoneTitle: m.title,
            description: `[LEGACY DEFICIT] Early delivery bonus for '${m.title}'. Platform covered the bonus (₹${m.bonusAmount}) because it was released before the split-payment system was installed.`,
            createdAt: m.releasedAt || m.updatedAt,
          });
        }
      }

      // Sort deficits by date
      mappedDeficits.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      const totalDeficitAmount = mappedDeficits.reduce((sum, d) => sum + d.amount, 0);

      // 4. Fetch Recent Bonuses from Milestones
      const recentBonusMilestones = await Milestone.find({
        status: "released",
        bonusAmount: { $gt: 0 }
      })
        .populate({ path: "freelancerId", model: "User", select: "username role" })
        .sort({ releasedAt: -1, updatedAt: -1 })
        .limit(20);

      res.json({
        summary: {
          totalBonusesPaid,
          totalPenaltiesApplied,
          totalDeficitAmount,
          pendingDeficitCount: mappedDeficits.length,
          netImpact: totalBonusesPaid - totalPenaltiesApplied,
        },
        pendingDeficits: mappedDeficits,
        recentBonuses: recentBonusMilestones.map((m) => ({
          _id: m._id,
          userName: m.freelancerId?.username,
          role: m.freelancerId?.role,
          amount: m.bonusAmount,
          milestoneTitle: m.title,
          createdAt: m.releasedAt || m.updatedAt,
        })),
      });
    } catch (err) {
      console.error("Admin Bonus Summary Error:", err);
      res.status(500).json({ message: "Error fetching bonus summary" });
    }
  }
);

/**
 * POST /finance/admin/deficits/:deficitId/remind
 * Send an email reminder to a client about a pending deficit.
 */
router.post(
  "/admin/deficits/:deficitId/remind",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    try {
      const { deficitId } = req.params;
      const sendEmail = require("../utils/sendEmail");

      let clientEmail, clientName, amount, milestoneTitle;
      let isLegacy = deficitId.startsWith("legacy-");

      if (isLegacy) {
        const milestoneId = deficitId.replace("legacy-", "");
        const milestone = await Milestone.findById(milestoneId).populate("clientId");
        if (!milestone) return res.status(404).json({ message: "Milestone not found for legacy deficit" });
        
        clientEmail = milestone.clientId.email;
        clientName = milestone.clientId.username;
        amount = milestone.bonusAmount;
        milestoneTitle = milestone.title;
      } else {
        const transaction = await WalletTransaction.findById(deficitId).populate("userId referenceId");
        if (!transaction) return res.status(404).json({ message: "Deficit transaction not found" });
        
        clientEmail = transaction.userId.email;
        clientName = transaction.userId.username;
        amount = Math.abs(transaction.amount);
        milestoneTitle = transaction.referenceId ? transaction.referenceId.title : "Unknown Milestone";
      }

      if (!clientEmail) {
        return res.status(400).json({ message: "Client email not found" });
      }

      const subject = "Action Required: Negative Wallet Balance due to Early Delivery Bonus";
      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
          <h2 style="color: #6366f1;">Wallet Deficit Notice</h2>
          <p>Hello ${clientName},</p>
          <p>This is a reminder regarding a pending deficit on your Freelancer Hub account.</p>
          <p>You recently awarded an early-delivery bonus for the milestone <strong>"${milestoneTitle}"</strong>. However, your platform wallet did not have sufficient funds to cover the complete bonus amount.</p>
          <p style="font-size: 1.1em; padding: 15px; background-color: #fef2f2; border-left: 4px solid #ef4444; margin: 20px 0;">
            <strong>Amount Due: ₹${amount.toLocaleString("en-IN")}</strong>
          </p>
          <p>The platform has temporarily covered this cost to ensure the freelancer was paid on time. Please log in to your account and <strong>Top Up your Wallet</strong> as soon as possible to clear this negative balance.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="https://freelancerhub-five.vercel.app/login" style="background-color: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Log In to Top Up</a>
          </div>
          <p>If you have any questions, please contact our support team.</p>
          <p>Best regards,<br>The Freelancer Hub Team</p>
        </div>
      `;

      await sendEmail(clientEmail, subject, htmlContent);

      res.json({ message: "Reminder email sent successfully to the client." });

    } catch (err) {
      console.error("Email Reminder Error:", err);
      res.status(500).json({ message: "Error sending reminder email" });
    }
  }
);

/**
 * POST /finance/admin/deficits/:deficitId/resolve
 * Resolve a pending deficit by charging the client's wallet.
 * Fails if the client's available balance is insufficient.
 */
router.post(
  "/admin/deficits/:deficitId/resolve",
  verifyToken,
  authorize(["admin", "super_admin"]),
  async (req, res) => {
    const mongoose = require("mongoose");
    const session = await mongoose.startSession();
    
    try {
      const { deficitId } = req.params;
      session.startTransaction();

      let clientWallet, amount, description;
      let isLegacy = deficitId.startsWith("legacy-");
      let transactionToUpdate = null;
      let milestoneId = null;

      if (isLegacy) {
        // Resolve legacy deficit
        milestoneId = deficitId.replace("legacy-", "");
        const milestone = await Milestone.findById(milestoneId).session(session);
        if (!milestone) throw new Error("Milestone not found for legacy deficit");
        
        // Ensure it hasn't already been resolved
        const existingTx = await WalletTransaction.findOne({
          referenceId: milestone._id,
          type: "bonus_charge",
          status: "completed",
          amount: -milestone.bonusAmount
        }).session(session);

        if (existingTx) throw new Error("This legacy deficit is already resolved");

        clientWallet = await Wallet.findOne({ userId: milestone.clientId }).session(session);
        amount = milestone.bonusAmount;
        description = `[DEFICIT RESOLVED] Recovered legacy bonus deficit for milestone: '${milestone.title}'`;

      } else {
        // Resolve standard pending deficit
        transactionToUpdate = await WalletTransaction.findById(deficitId).session(session);
        if (!transactionToUpdate) throw new Error("Deficit transaction not found");
        if (transactionToUpdate.status !== "pending") throw new Error("This transaction is not pending");

        clientWallet = await Wallet.findOne({ userId: transactionToUpdate.userId }).session(session);
        amount = Math.abs(transactionToUpdate.amount);
        description = transactionToUpdate.description.replace("[BONUS DEFICIT]", "[DEFICIT RESOLVED]");
      }

      if (!clientWallet) throw new Error("Client wallet not found");

      // Check balance
      if (clientWallet.balance < amount) {
        await session.abortTransaction();
        return res.status(400).json({ 
          message: `Client does not have enough balance. They need ₹${amount}, but only have ₹${clientWallet.balance}. Please ask them to deposit funds first.` 
        });
      }

      // Deduct balance
      clientWallet.balance -= amount;
      await clientWallet.save({ session });

      if (isLegacy) {
        // Create new completed transaction for legacy
        await WalletTransaction.create([{
          walletId: clientWallet._id,
          userId: clientWallet.userId,
          type: "bonus_charge",
          amount: -amount,
          balanceAfter: clientWallet.balance,
          escrowBalanceAfter: clientWallet.escrowBalance,
          status: "completed",
          referenceId: milestoneId,
          referenceModel: "Milestone",
          description: description,
          performedBy: req.user.userId
        }], { session });
      } else {
        // Update existing transaction to completed
        transactionToUpdate.status = "completed";
        transactionToUpdate.balanceAfter = clientWallet.balance;
        transactionToUpdate.escrowBalanceAfter = clientWallet.escrowBalance;
        transactionToUpdate.description = description;
        transactionToUpdate.performedBy = req.user.userId;
        await transactionToUpdate.save({ session });
      }

      await session.commitTransaction();
      res.json({ message: "Deficit successfully resolved. Funds deducted from client's wallet." });

    } catch (err) {
      await session.abortTransaction();
      console.error("Resolve Deficit Error:", err);
      res.status(500).json({ message: err.message || "Error resolving deficit" });
    } finally {
      session.endSession();
    }
  }
);

module.exports = router;
