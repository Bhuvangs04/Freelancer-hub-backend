const mongoose = require("mongoose");

const TaskSchema = new mongoose.Schema({
  title: String,
  completed: Boolean,
  createdAt: { type: Date, default: Date.now }, // ✅ Corrected
});

const FileSchema = new mongoose.Schema({
  name: String,
  size: String,
  url: String,
  uploadedAt: { type: Date, default: Date.now }, // ✅ Corrected
});



const OnGoingSchema = new mongoose.Schema(
  {
    projectId: {
      type: String,
      ref: "Project",
    },
    title: { type: String, required: true },
    clientId: { type: String, required: true },
    freelancer: { type: String, required: true },
    freelancerId: { type: String, required: true },
    status: { type: String, enum: ["in-progress", "on-hold", "completed"] },
    progress: Number,
    dueDate: { type: String, required: true },
    budget: { type: Number, required: true },
    description: { type: String, required: true },
    freelancerBidPrice: { type: Number, required: true },
    tasks: { type: [TaskSchema], default: [] },
    files: { type: [FileSchema], default: [] },
  },
  { timestamps: true }
);

const Ongoing = mongoose.model("OnGoingProjects", OnGoingSchema);

module.exports = Ongoing;
