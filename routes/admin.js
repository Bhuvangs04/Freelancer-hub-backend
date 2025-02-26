const express = require("express");
const { verifyToken, authorize } = require("../middleware/Auth");
const Transaction = require("../models/Transaction");
const AccountDetails = require("../models/AccountDetail")
const Escrow = require("../models/Escrow")
const Razorpay = require("razorpay");
const router = express.Router();
const User = require("../models/User")
const FundAccount = require("../models/FundAccount");
const axios = require("axios") // Model for storing Fund Account details


const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});


// Example: Get all users
router.get("/users", verifyToken, authorize(["admin"]), async (req, res) => {
  try {
    const users = await User.find().select(
      "-password -__v -isBanned -banExpiresAt -bio -resumeUrl"
    );
    res.json({ users });
  } catch (err) {
    res.status(500).send("Error fetching users");
  }
});

// Example: Ban user temporarily
router.post(
  "/ban-user/:userId/ban-temporary",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    const { userId } = req.params;
    try {
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      user.isBanned = true;
      user.banExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await user.save();
       res.json({ message: "User banned successfully for 7 days" });
    } catch (err) {
      res.status(500).send("Error banning user");
    }
  }
);

router.post("/ban-user/:userId/ban-permanent", verifyToken, authorize(["admin"]), async (req, res) => {
  const { userId } = req.params;
  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    user.isBanned = true;
    await user.save();
    res.json({ message: "User banned successfully" });
  } catch (err) {
    res.status(500).send("Error banning user");
  }
});

router.post("/relase-ban-user/:userId/realsed",verifyToken,authorize(["admin"]),async (req,res)=>{
  const {userId} = req.params;
  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    user.isBanned = false;
    user.banExpiresAt = null;
    await user.save();
    res.json({ message: "User ban released successfully" });
  } catch (error) {
    res.status(500).send({message:"Error while activating account"})
  }
})

router.get(
  "/pay-out/freelancers",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    try {
      const releasedPayments = await Escrow.find({
        status: "released",
      }).populate("freelancerId");

      if (!releasedPayments.length) {
        return res.status(404).json({ message: "No released payments found" });
      }

      res.json({ releasedPayments });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Server error" });
    }
  }
);



router.post(
  "/create-fund-account/:userId",
  verifyToken,
  async (req, res) => {
    try {
      const { userId } = req.params;

      // Get user details from DB
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      // Step 1: Create a Razorpay Contact (Required before creating a Fund Account)
      const contactResponse = await axios.post(
        "https://api.razorpay.com/v1/contacts",
        {
          name: user.username || "Test Freelancer",
          email: user.email || "test@freelancer.com",
          contact: user.phone || "9999999999",
          type: "employee",
          reference_id: `${userId}`,
        },
        {
          auth: {
            username: process.env.RAZORPAY_KEY_ID,
            password: process.env.RAZORPAY_KEY_SECRET,
          },
        }
      );

      const contactId = contactResponse.data.id; 
      

     const accountDetails = await AccountDetails.findOne({ userId });
       if (!accountDetails) {
          return res.status(404).json({ message: "Account details not found" });
        }


      const fundAccountResponse = await axios.post(
        "https://api.razorpay.com/v1/fund_accounts",
        {
          contact_id: contactId,
          account_type: accountDetails.accountType,
          bank_account: {
            name: user.username || "Test Account",
            ifsc: accountDetails.ifscCode,
            account_number: accountDetails.accountNumber,
          },
        },
        {
          auth: {
            username: process.env.RAZORPAY_KEY_ID,
            password: process.env.RAZORPAY_KEY_SECRET,
          },
        }
      );

      const fundAccountId = fundAccountResponse.data.id;


      // Step 3: Store Fund Account Details in MongoDB
      const fundAccount = new FundAccount({
        userId,
        fundAccountId,
        contactId,
        bankDetails: {
          accountNumber: accountDetails.accountNumber,
          ifsc: accountDetails.ifscCode || "KARB0007104",
          name: user.username || "Test Account",
        },
      });

      await fundAccount.save();

      res.json({
        message: "Fund account created successfully",
        fundAccountId,
        contactId,
      });
    } catch (error) {
      console.error(error)
      console.error(
        "Error creating fund account:",
        error.response?.data || error
      );
      res.status(500).json({ message: "Failed to create fund account" });
    }
  }
);


router.post(
  "/pay-out/freelancers/bulk",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    try {
      const releasedPayments = await Escrow.find({ status: "released" });

      if (!releasedPayments.length) {
        return res.status(404).json({ message: "No released payments found" });
      }

      let payouts = [];
      for (const payment of releasedPayments) {
        const freelancer = await FundAccount.findOne({
          userId: payment.freelancerId,
        });

        if (!freelancer || !freelancer.fundAccountId) {
          console.warn(
            `No Razorpay fund account found for freelancer ${payment.freelancerId}`
          );
          continue;
        }

        const amountAfterCommission = Math.floor(payment.amount * 0.9 * 100); // Deduct 10% commission

        const payout = await razorpay.payouts.create({
          fund_account_id: freelancer.fundAccountId,
          amount: amountAfterCommission,
          currency: "INR",
          mode: "IMPS",
          purpose: "payout",
          queue_if_low_balance: true,
          reference_id: `payout_${payment._id}`,
          narration: "Freelancer Payout",
        });

        payouts.push(payout);

        // Update Escrow status to "paid"
        payment.status = "paid";
        await payment.save();

        // Save transaction record
        await new Transaction({
          userId: payment.freelancerId,
          escrowId: payment._id,
          type: "withdrawal",
          amount: amountAfterCommission / 100,
          status: "completed",
        }).save();
      }

      res.json({ message: "Payouts processed successfully", payouts });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Payout processing failed" });
    }
  }
);

// Process individual payout
router.post(
  "/pay-out/freelancers/:freelancerId",
  verifyToken,
  authorize(["admin"]),
  async (req, res) => {
    try {
      const { freelancerId } = req.params;
      const payment = await Escrow.findOne({
        freelancerId,
        status: "released",
      });

      if (!payment) {
        return res
          .status(404)
          .json({ message: "No released funds for this freelancer" });
      }

      const freelancer = await FundAccount.findOne({ userId: freelancerId });

      if (!freelancer || !freelancer.fundAccountId) {
        return res
          .status(400)
          .json({ message: "Freelancer fund account not found" });
      }

      const amountAfterCommission = Math.floor(payment.amount * 0.9 * 100); // Deduct 10% commission

      const payout = await razorpay.payouts.create({
        fund_account_id: freelancer.fundAccountId,
        amount: amountAfterCommission,
        currency: "INR",
        mode: "IMPS",
        purpose: "payout",
        queue_if_low_balance: true,
        reference_id: `payout_${payment._id}`,
        narration: "Freelancer Payout",
      });

      // Update Escrow status to "paid"
      payment.status = "paid";
      await payment.save();

      // Save transaction record
      await new Transaction({
        userId: freelancerId,
        escrowId: payment._id,
        type: "withdrawal",
        amount: amountAfterCommission / 100,
        status: "completed",
      }).save();

      res.json({ message: "Payout successful", payout });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Payout processing failed" });
    }
  }
);

module.exports = router;
