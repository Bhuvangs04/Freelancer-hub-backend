const mongoose = require("mongoose");

const AdminActivityLogSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
    action: {
      type: String,
      required: true,
      enum: [
        "LOGIN",
        "LOGOUT",
        "PASSWORD_CHANGE",
        "USER_BLOCK",
        "USER_UNBLOCK",
        "PROJECT_DELETE",
        "ESCROW_EDIT",
        "ESCROW_RELEASE",
        "ESCROW_REFUND",
        "ESCROW_BLOCK",
        "REVIEW_DELETE",
        "SETTINGS_UPDATE",
        "CONTENT_UPDATE",
        "CATEGORY_CREATE",
        "CATEGORY_UPDATE",
        "CATEGORY_DELETE",
        "PROFILE_UPDATE",
        "2FA_ENABLED",
        "2FA_DISABLED",
        "BACKUP_CODES_REGENERATED",
        "ADMIN_CREATE",
        "ADMIN_DELETE",
        "ADMIN_BLOCK",
        "ADMIN_UNBLOCK",
        "ADMIN_PASSWORD_RESET",
        "ADMIN_MFA_RESET",
        "OTHER",
      ],
    },
    targetType: {
      type: String,
      enum: ["user", "project", "escrow", "review", "settings", "content", "category", "admin"],
    },
    targetId: {
      type: mongoose.Schema.Types.Mixed,
    },
    reason: {
      type: String,
      default: "",
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    ipAddress: {
      type: String,
    },
  },
  { timestamps: true }
);

// Index for efficient querying
AdminActivityLogSchema.index({ adminId: 1, createdAt: -1 });
AdminActivityLogSchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.model("AdminActivityLog", AdminActivityLogSchema);
