const mongoose = require("mongoose");

const SiteSettingsSchema = new mongoose.Schema(
  {
    // === Platform Commission & Budget ===
    platformCommissionPercent: {
      type: Number,
      default: 10,
      min: 0,
      max: 100,
    },
    minimumProjectBudget: {
      type: Number,
      default: 500,
      min: 0,
    },
    maximumProjectBudget: {
      type: Number,
      default: 1000000,
      min: 0,
    },

    // === Site Identity ===
    siteName: {
      type: String,
      default: "FreelancerHub",
      trim: true,
    },
    logoUrl: {
      type: String,
      default: "",
    },
    supportEmail: {
      type: String,
      default: "support@freelancerhub.com",
      trim: true,
      lowercase: true,
    },

    // === Maintenance ===
    maintenanceMode: {
      type: Boolean,
      default: false,
    },
    maintenanceMessage: {
      type: String,
      default: "We are currently under maintenance. Please check back later.",
    },
  },
  { timestamps: true }
);

// Ensure only one settings document exists (singleton pattern)
SiteSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

module.exports = mongoose.model("SiteSettings", SiteSettingsSchema);
