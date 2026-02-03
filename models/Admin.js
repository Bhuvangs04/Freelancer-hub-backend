const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

const AdminSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 12, // Enforce strong password length
    },
    role: {
      type: String,
      default: "admin",
      enum: ["admin", "super_admin"],
    },

    // Secret code (hashed for security)
    secretCodeHash: {
      type: String,
      required: true,
    },

    // TOTP 2FA Settings
    twoFactorSecret: {
      type: String,
      default: null,
    },
    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    twoFactorBackupCodes: [{
      code: String,
      used: { type: Boolean, default: false },
    }],

    // Login Security
    loginAttempts: {
      type: Number,
      default: 0,
    },
    lockUntil: {
      type: Date,
      default: null,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
    lastLoginIp: {
      type: String,
      default: null,
    },

    // Account Status
    isActive: {
      type: Boolean,
      default: true,
    },
    mustChangePassword: {
      type: Boolean,
      default: false,
    },
    passwordChangedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Constants for account lockout
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME = 30 * 60 * 1000; // 30 minutes

// Virtual to check if account is locked
AdminSchema.virtual("isLocked").get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Hash password before saving
AdminSchema.pre("save", async function (next) {
  // Only hash password if it's modified
  if (this.isModified("password")) {
    // Use higher cost factor for admin accounts
    this.password = await bcrypt.hash(this.password, 12);
    this.passwordChangedAt = new Date();
  }
  next();
});

// Compare password method
AdminSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Hash and set secret code
AdminSchema.methods.setSecretCode = async function (secretCode) {
  this.secretCodeHash = await bcrypt.hash(secretCode, 12);
};

// Verify secret code
AdminSchema.methods.verifySecretCode = async function (candidateCode) {
  return bcrypt.compare(candidateCode, this.secretCodeHash);
};

// Increment login attempts
AdminSchema.methods.incLoginAttempts = async function () {
  // Reset if lock has expired
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $set: { loginAttempts: 1 },
      $unset: { lockUntil: 1 },
    });
  }

  const updates = { $inc: { loginAttempts: 1 } };

  // Lock account if max attempts exceeded
  if (this.loginAttempts + 1 >= MAX_LOGIN_ATTEMPTS && !this.isLocked) {
    updates.$set = { lockUntil: Date.now() + LOCK_TIME };
  }

  return this.updateOne(updates);
};

// Reset login attempts on successful login
AdminSchema.methods.resetLoginAttempts = async function () {
  return this.updateOne({
    $set: { loginAttempts: 0, lastLoginAt: new Date() },
    $unset: { lockUntil: 1 },
  });
};

// Generate backup codes for 2FA
AdminSchema.methods.generateBackupCodes = function () {
  const codes = [];
  for (let i = 0; i < 10; i++) {
    codes.push({
      code: crypto.randomBytes(4).toString("hex").toUpperCase(),
      used: false,
    });
  }
  this.twoFactorBackupCodes = codes;
  return codes.map(c => c.code);
};

// Verify and consume backup code
AdminSchema.methods.useBackupCode = async function (code) {
  const backupCode = this.twoFactorBackupCodes.find(
    bc => bc.code === code.toUpperCase() && !bc.used
  );

  if (!backupCode) return false;

  backupCode.used = true;
  await this.save();
  return true;
};

// Static method to find by credentials with lockout check
AdminSchema.statics.findByCredentials = async function (email) {
  const admin = await this.findOne({ email: email.toLowerCase() });

  if (!admin) {
    return { error: "INVALID_CREDENTIALS" };
  }

  if (!admin.isActive) {
    return { error: "ACCOUNT_DISABLED" };
  }

  if (admin.isLocked) {
    const remainingTime = Math.ceil((admin.lockUntil - Date.now()) / 60000);
    return {
      error: "ACCOUNT_LOCKED",
      remainingMinutes: remainingTime,
    };
  }

  return { admin };
};

module.exports = mongoose.model("Admin", AdminSchema);
