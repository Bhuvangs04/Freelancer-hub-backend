const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const ReviewSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },
  reviewerId: { type: String, required: true, ref: "User" }, // User who gives the review
  reviewedId: { type: String, required: true, ref: "User" }, // User who receives the review
  projectId: { type: String, required: true, ref: "Project" }, // Associated project
  rating: { type: Number, required: true, min: 1, max: 5 }, // Rating from 1 to 5
  comments: { type: String, required: true, trim: true }, // Review text
  createdAt: { type: Date, default: Date.now }, // Timestamp
});

module.exports = mongoose.model("Review", ReviewSchema);
