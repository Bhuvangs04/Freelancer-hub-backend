const cron = require("node-cron");
const Project = require("../models/Project");
const User = require("../models/User");
const fs = require("fs");
const path = require("path");
const sendEmail = require("../utils/sendEmail"); // your email utility

// Run every 10 minutes
cron.schedule("*/2 * * * *", async () => {
    try {
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
        const newProjects = await Project.find({ createdAt: { $gte: tenMinutesAgo } });

        if (newProjects.length === 0) return;

        // Read email template
        const templatePath = path.join(__dirname, "../templates/sendprojectNotification.html");
        let emailTemplate = fs.readFileSync(templatePath, "utf8");

        // Build dynamic HTML block for projects
        const projectHTML = newProjects
            .map(
                (proj) => `
        <div class="project">
          <h3>Project: ${proj.title}</h3>
          <p><strong>Skills:</strong> ${proj.skillsRequired.join(", ")}</p>
          <p><strong>Budget:</strong> ${proj.budget}</p>
          <p><strong>Deadline:</strong> ${new Date(proj.deadline).toDateString()}</p>
        </div>
      `
            )
            .join("");

        // Insert the project block into your template
        emailTemplate = emailTemplate.replace("{{projectList}}", projectHTML);

        const freelancers = await User.find({ role: "freelancer" });

        for (const freelancer of freelancers) {
            await sendEmail(
                freelancer.email,
                "New Projects Available",
                emailTemplate.replace("{{freelancerName}}", freelancer.username),
                true
            );
        }

        console.log(`[Email Sent] to ${freelancers.length} freelancers`);
    } catch (err) {
        console.error("[CRON ERROR]:", err);
    }
});
