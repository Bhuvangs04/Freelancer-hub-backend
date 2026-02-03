const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { verifyToken, authorize } = require("../middleware/Auth");
const Transaction = require("../models/Transaction");
const FreelancerEscrow = require("../models/FreelancerEscrow");
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
 * Get date range for a specific period
 */
const getDateRange = (period) => {
  const now = new Date();
  let start, end;

  switch (period) {
    case "today":
      start = new Date(now.setHours(0, 0, 0, 0));
      end = new Date();
      break;
    case "week":
      start = new Date(now.setDate(now.getDate() - 7));
      end = new Date();
      break;
    case "month":
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date();
      break;
    case "year":
      start = new Date(now.getFullYear(), 0, 1);
      end = new Date();
      break;
    default:
      start = new Date(0);
      end = new Date();
  }

  return { start, end };
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
 * Get comprehensive income dashboard
 */
router.get(
  "/dashboard",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const freelancerId = req.user.userId;

      // Get all escrow payments
      const payments = await FreelancerEscrow.find({
        freelancerId,
        status: "paid",
      }).populate("projectId", "title clientId");

      // Calculate totals
      const totalEarnings = payments.reduce((sum, p) => sum + p.amount, 0);

      // This month
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const thisMonthPayments = payments.filter(p => new Date(p.createdAt) >= monthStart);
      const thisMonthEarnings = thisMonthPayments.reduce((sum, p) => sum + p.amount, 0);

      // This year
      const yearStart = new Date(new Date().getFullYear(), 0, 1);
      const thisYearPayments = payments.filter(p => new Date(p.createdAt) >= yearStart);
      const thisYearEarnings = thisYearPayments.reduce((sum, p) => sum + p.amount, 0);

      // Pending payments
      const pendingMilestones = await Milestone.find({
        freelancerId,
        status: { $in: ["submitted", "confirmed"] },
      });
      const pendingAmount = pendingMilestones.reduce((sum, m) => sum + (m.finalAmount || m.amount), 0);

      // Project stats
      const completedProjects = await Agreement.countDocuments({
        freelancerId,
        status: "completed",
      });

      const activeProjects = await Agreement.countDocuments({
        freelancerId,
        status: "active",
      });

      // Average per project
      const avgPerProject = completedProjects > 0 ? totalEarnings / completedProjects : 0;

      // Top clients
      const clientMap = {};
      for (const payment of payments) {
        const clientId = payment.projectId?.clientId?.toString();
        if (clientId) {
          clientMap[clientId] = (clientMap[clientId] || 0) + payment.amount;
        }
      }

      const topClientIds = Object.entries(clientMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id]) => id);

      const topClients = await User.find({ _id: { $in: topClientIds } })
        .select("username companyName");

      const topClientsData = topClients.map(client => ({
        name: client.companyName || client.username,
        totalPaid: clientMap[client._id.toString()],
      }));

      // Monthly breakdown (last 12 months)
      const monthlyBreakdown = [];
      for (let i = 11; i >= 0; i--) {
        const monthDate = new Date();
        monthDate.setMonth(monthDate.getMonth() - i);
        const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
        const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);

        const monthPayments = payments.filter(p => {
          const paymentDate = new Date(p.createdAt);
          return paymentDate >= monthStart && paymentDate <= monthEnd;
        });

        monthlyBreakdown.push({
          month: monthStart.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
          earnings: monthPayments.reduce((sum, p) => sum + p.amount, 0),
          projects: new Set(monthPayments.map(p => p.projectId?._id?.toString())).size,
        });
      }

      res.json({
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
        recentPayments: payments.slice(0, 10).map(p => ({
          amount: p.amount,
          projectTitle: p.projectId?.title || "Unknown",
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
 * Get tax-ready earnings summary
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

      // Get all payments for the year
      const payments = await FreelancerEscrow.find({
        freelancerId,
        status: "paid",
        createdAt: { $gte: yearStart, $lte: yearEnd },
      }).populate("projectId", "title clientId");

      // Get user details
      const user = await User.findById(freelancerId).select("username email");

      // Calculate totals
      const grossEarnings = payments.reduce((sum, p) => sum + p.amount, 0);

      // Platform fee (estimate 10%)
      const platformFeeRate = 0.1;
      const estimatedPlatformFee = Math.round(grossEarnings * platformFeeRate);
      const netEarnings = grossEarnings - estimatedPlatformFee;

      // Quarterly breakdown
      const quarters = [
        { name: "Q1 (Jan-Mar)", start: new Date(year, 0, 1), end: new Date(year, 2, 31) },
        { name: "Q2 (Apr-Jun)", start: new Date(year, 3, 1), end: new Date(year, 5, 30) },
        { name: "Q3 (Jul-Sep)", start: new Date(year, 6, 1), end: new Date(year, 8, 30) },
        { name: "Q4 (Oct-Dec)", start: new Date(year, 9, 1), end: new Date(year, 11, 31) },
      ];

      const quarterlyBreakdown = quarters.map(q => {
        const qPayments = payments.filter(p => {
          const date = new Date(p.createdAt);
          return date >= q.start && date <= q.end;
        });
        return {
          quarter: q.name,
          gross: qPayments.reduce((sum, p) => sum + p.amount, 0),
          projectCount: new Set(qPayments.map(p => p.projectId?._id?.toString())).size,
        };
      });

      // Client breakdown for TDS purposes
      const clientBreakdown = {};
      for (const payment of payments) {
        const projectId = payment.projectId?._id?.toString();
        const clientId = payment.projectId?.clientId?.toString();
        if (clientId) {
          if (!clientBreakdown[clientId]) {
            clientBreakdown[clientId] = { total: 0, projects: new Set() };
          }
          clientBreakdown[clientId].total += payment.amount;
          clientBreakdown[clientId].projects.add(projectId);
        }
      }

      const clientIds = Object.keys(clientBreakdown);
      const clients = await User.find({ _id: { $in: clientIds } })
        .select("username companyName email");

      const clientSummary = clients.map(c => ({
        name: c.companyName || c.username,
        email: c.email,
        totalPaid: clientBreakdown[c._id.toString()].total,
        projectCount: clientBreakdown[c._id.toString()].projects.size,
      }));

      res.json({
        taxYear: year,
        freelancer: {
          name: user.username,
          email: user.email,
        },
        earnings: {
          gross: grossEarnings,
          estimatedPlatformFee,
          net: netEarnings,
        },
        quarterlyBreakdown,
        clientSummary: clientSummary.sort((a, b) => b.totalPaid - a.totalPaid),
        totalProjects: new Set(payments.map(p => p.projectId?._id?.toString())).size,
        paymentCount: payments.length,
        disclaimer: "This is an estimated summary. Please consult a tax professional for accurate filing.",
      });
    } catch (err) {
      console.error("Tax Summary Error:", err);
      res.status(500).json({ message: "Error generating tax summary" });
    }
  }
);

/**
 * POST /finance/invoice/generate
 * Generate a simple invoice
 */
router.post(
  "/invoice/generate",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const freelancerId = req.user.userId;
      const { projectId, milestoneId, customItems } = req.body;

      // Get freelancer details
      const freelancer = await User.findById(freelancerId)
        .select("username email location");

      let invoiceItems = [];
      let client = null;
      let projectTitle = "";

      if (projectId && isValidObjectId(projectId)) {
        // Generate from project/milestone
        const project = await Project.findById(projectId)
          .populate("clientId", "username email companyName");
        
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
          // All completed milestones
          const milestones = await Milestone.find({
            projectId,
            freelancerId,
            status: "released",
          });

          invoiceItems = milestones.map(m => ({
            description: `Milestone ${m.milestoneNumber}: ${m.title}`,
            amount: m.finalAmount || m.amount,
          }));
        }
      } else if (Array.isArray(customItems)) {
        // Custom invoice
        invoiceItems = customItems.filter(item => item.description && item.amount);
      } else {
        return res.status(400).json({ message: "Project ID or custom items required" });
      }

      if (invoiceItems.length === 0) {
        return res.status(400).json({ message: "No items for invoice" });
      }

      // Calculate totals
      const subtotal = invoiceItems.reduce((sum, item) => sum + item.amount, 0);
      const platformFee = Math.round(subtotal * 0.1);
      const total = subtotal;

      // Generate invoice number
      const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

      // Generate HTML invoice
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
      ${client ? `
        <strong>${client.companyName || client.username}</strong><br>
        ${client.email}
      ` : "Custom Invoice"}
    </div>
  </div>
  
  ${projectTitle ? `<p><strong>Project:</strong> ${projectTitle}</p>` : ""}
  
  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th class="amount">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${invoiceItems.map(item => `
        <tr>
          <td>${item.description}</td>
          <td class="amount">${formatCurrency(item.amount)}</td>
        </tr>
      `).join("")}
      <tr class="total-row">
        <td>TOTAL</td>
        <td class="amount">${formatCurrency(total)}</td>
      </tr>
    </tbody>
  </table>
  
  <p><strong>Platform Fee (deducted):</strong> ${formatCurrency(platformFee)}</p>
  <p><strong>Net Payable to Freelancer:</strong> ${formatCurrency(total - platformFee)}</p>
  
  <div class="footer">
    <p>Generated by FreelancerHub | This is a computer-generated invoice</p>
  </div>
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
 * Get earnings predictions
 */
router.get(
  "/predictions",
  verifyToken,
  authorize(["freelancer"]),
  async (req, res) => {
    try {
      const freelancerId = req.user.userId;

      // Get historical data (last 6 months)
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      const payments = await FreelancerEscrow.find({
        freelancerId,
        status: "paid",
        createdAt: { $gte: sixMonthsAgo },
      });

      const monthlyEarnings = [];
      for (let i = 5; i >= 0; i--) {
        const monthDate = new Date();
        monthDate.setMonth(monthDate.getMonth() - i);
        const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
        const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);

        const monthPayments = payments.filter(p => {
          const date = new Date(p.createdAt);
          return date >= monthStart && date <= monthEnd;
        });

        monthlyEarnings.push(monthPayments.reduce((sum, p) => sum + p.amount, 0));
      }

      // Calculate average and trend
      const avgMonthly = monthlyEarnings.reduce((a, b) => a + b, 0) / 6;
      const recentAvg = (monthlyEarnings[4] + monthlyEarnings[5]) / 2;
      const trend = avgMonthly > 0 ? ((recentAvg - avgMonthly) / avgMonthly) * 100 : 0;

      // Pending income
      const pendingMilestones = await Milestone.find({
        freelancerId,
        status: { $in: ["in_progress", "submitted", "confirmed"] },
      });
      const pendingIncome = pendingMilestones.reduce((sum, m) => sum + (m.finalAmount || m.amount), 0);

      // Active agreements value
      const activeAgreements = await Agreement.find({
        freelancerId,
        status: "active",
      });
      const activeProjectsValue = activeAgreements.reduce((sum, a) => sum + a.agreedAmount, 0);

      // Predictions
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
          confidence: monthlyEarnings.filter(e => e > 0).length >= 3 ? "medium" : "low",
        },
        disclaimer: "Predictions are based on historical data and may vary.",
      });
    } catch (err) {
      console.error("Predictions Error:", err);
      res.status(500).json({ message: "Error generating predictions" });
    }
  }
);

module.exports = router;
