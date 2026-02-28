const mongoose = require("mongoose");

// ============================================================================
// SKILL CHALLENGE QUESTION BANK
// ============================================================================

const SkillQuestionSchema = new mongoose.Schema(
  {
    skillName: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    question: {
      type: String,
      required: true,
    },
    options: [
      {
        text: { type: String, required: true },
        isCorrect: { type: Boolean, default: false },
      },
    ],
    difficulty: {
      type: String,
      enum: ["beginner", "intermediate", "advanced"],
      default: "intermediate",
    },
    explanation: {
      type: String,
      default: "",
    },
    category: {
      type: String,
      enum: ["programming", "design", "writing", "marketing", "video", "audio", "other"],
      default: "programming",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

SkillQuestionSchema.index({ skillName: 1, difficulty: 1, isActive: 1 });

/**
 * Get random questions for a skill challenge
 * @param {string} skillName - The skill to test
 * @param {number} count - Number of questions to return
 * @param {string} difficulty - Optional difficulty filter
 */
SkillQuestionSchema.statics.getRandomQuestions = async function (
  skillName,
  count = 10,
  difficulty = null
) {
  const filter = {
    skillName: skillName.toLowerCase(),
    isActive: true,
  };
  if (difficulty) {
    filter.difficulty = difficulty;
  }

  // Use MongoDB's $sample to get random questions
  const questions = await this.aggregate([
    { $match: filter },
    { $sample: { size: count } },
    {
      $project: {
        question: 1,
        options: {
          $map: {
            input: "$options",
            as: "opt",
            in: { text: "$$opt.text", _id: "$$opt._id" },
          },
        },
        difficulty: 1,
        skillName: 1,
      },
    },
  ]);

  return questions;
};

/**
 * Grade submitted answers
 * @param {Array} questionIds - Array of question IDs
 * @param {Object} answers - Map of questionId -> selectedOptionId
 */
SkillQuestionSchema.statics.gradeAnswers = async function (questionIds, answers) {
  const questions = await this.find({ _id: { $in: questionIds } });

  let correct = 0;
  const results = [];

  for (const question of questions) {
    const selectedOptionId = answers[question._id.toString()];
    const correctOption = question.options.find((opt) => opt.isCorrect);
    const isCorrect =
      correctOption && selectedOptionId === correctOption._id.toString();

    if (isCorrect) correct++;

    results.push({
      questionId: question._id,
      question: question.question,
      selectedOptionId,
      correctOptionId: correctOption ? correctOption._id.toString() : null,
      isCorrect,
      explanation: question.explanation,
    });
  }

  const score = Math.round((correct / questions.length) * 100);

  return {
    totalQuestions: questions.length,
    correctAnswers: correct,
    score,
    passed: score >= 70,
    results,
  };
};

module.exports = mongoose.model("SkillQuestion", SkillQuestionSchema);
