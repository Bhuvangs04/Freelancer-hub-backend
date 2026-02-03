const mongoose = require("mongoose");
const Agreement = require("../models/Agreement");

/**
 * Contact Info Protection Middleware
 * 
 * This middleware filters out sensitive contact information (email, phone)
 * from user data unless there's an active signed agreement between the parties.
 * 
 * Usage: Apply after fetching user data that will be sent to another user
 */

/**
 * Fields considered as contact info
 */
const CONTACT_FIELDS = ["email", "phone", "phoneNumber", "contactEmail"];

/**
 * Check if two users have an active agreement between them
 */
const hasActiveAgreement = async (userId1, userId2) => {
  if (!userId1 || !userId2) return false;

  const agreement = await Agreement.findOne({
    $or: [
      { clientId: userId1, freelancerId: userId2 },
      { clientId: userId2, freelancerId: userId1 },
    ],
    status: "active",
  });

  return !!agreement;
};

/**
 * Filter contact info from a single user object
 */
const filterContactInfo = (userObj, showContact = false) => {
  if (!userObj) return userObj;
  
  // Handle mongoose documents
  const user = userObj.toObject ? userObj.toObject() : { ...userObj };
  
  if (!showContact) {
    for (const field of CONTACT_FIELDS) {
      if (user[field]) {
        user[field] = "[Hidden until agreement signed]";
      }
    }
  }
  
  return user;
};

/**
 * Filter contact info from an array of users
 */
const filterContactInfoArray = (users, showContact = false) => {
  if (!Array.isArray(users)) return users;
  return users.map(user => filterContactInfo(user, showContact));
};

/**
 * Middleware factory for protecting contact info
 * 
 * @param {string} userIdField - Path to the user ID in response data
 * @param {string} viewerIdField - Path to get viewer's user ID (default: req.user.userId)
 */
const contactInfoProtection = (options = {}) => {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res);
    
    res.json = async (data) => {
      try {
        const viewerId = req.user?.userId;
        
        if (!viewerId || !data) {
          return originalJson(data);
        }
        
        // Process common response patterns
        if (data.user && data.user._id) {
          const targetUserId = data.user._id.toString();
          if (targetUserId !== viewerId) {
            const hasAgreement = await hasActiveAgreement(viewerId, targetUserId);
            data.user = filterContactInfo(data.user, hasAgreement);
          }
        }
        
        if (data.freelancer && data.freelancer._id) {
          const targetUserId = data.freelancer._id.toString();
          if (targetUserId !== viewerId) {
            const hasAgreement = await hasActiveAgreement(viewerId, targetUserId);
            data.freelancer = filterContactInfo(data.freelancer, hasAgreement);
          }
        }
        
        if (data.client && data.client._id) {
          const targetUserId = data.client._id.toString();
          if (targetUserId !== viewerId) {
            const hasAgreement = await hasActiveAgreement(viewerId, targetUserId);
            data.client = filterContactInfo(data.client, hasAgreement);
          }
        }
        
        if (Array.isArray(data.users)) {
          data.users = await Promise.all(
            data.users.map(async (user) => {
              if (user._id && user._id.toString() !== viewerId) {
                const hasAgreement = await hasActiveAgreement(viewerId, user._id.toString());
                return filterContactInfo(user, hasAgreement);
              }
              return user;
            })
          );
        }
        
        if (Array.isArray(data.freelancers)) {
          data.freelancers = await Promise.all(
            data.freelancers.map(async (f) => {
              if (f._id && f._id.toString() !== viewerId) {
                const hasAgreement = await hasActiveAgreement(viewerId, f._id.toString());
                return filterContactInfo(f, hasAgreement);
              }
              return f;
            })
          );
        }
        
        return originalJson(data);
      } catch (error) {
        console.error("Contact info protection error:", error);
        return originalJson(data); // Fallback to unfiltered on error
      }
    };
    
    next();
  };
};

/**
 * Check contact visibility for a specific user pair
 * Use this in routes to determine if contact info should be shown
 */
const canViewContactInfo = async (viewerId, targetUserId) => {
  // Users can always see their own info
  if (viewerId === targetUserId) return true;
  
  return hasActiveAgreement(viewerId, targetUserId);
};

/**
 * Platform Protection Status Helper
 * Checks protection level for a user
 */
const getProtectionStatus = async (userId, projectId = null) => {
  const status = {
    escrowProtected: false,
    agreementProtected: false,
    platformGuarantee: false,
    protectionLevel: "none",
  };
  
  if (projectId) {
    // Check if escrow exists
    const Escrow = mongoose.model("Escrow");
    const escrow = await Escrow.findOne({
      projectId,
      status: { $in: ["funded", "released"] },
    });
    status.escrowProtected = !!escrow;
    
    // Check if agreement is signed
    const agreement = await Agreement.findOne({
      projectId,
      status: "active",
    });
    status.agreementProtected = !!agreement;
  }
  
  // Platform guarantee applies when both escrow and agreement exist
  status.platformGuarantee = status.escrowProtected && status.agreementProtected;
  
  // Determine protection level
  if (status.platformGuarantee) {
    status.protectionLevel = "full";
  } else if (status.escrowProtected || status.agreementProtected) {
    status.protectionLevel = "partial";
  }
  
  return status;
};

module.exports = {
  contactInfoProtection,
  canViewContactInfo,
  filterContactInfo,
  filterContactInfoArray,
  hasActiveAgreement,
  getProtectionStatus,
  CONTACT_FIELDS,
};
