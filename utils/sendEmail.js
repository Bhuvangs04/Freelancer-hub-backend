const nodemailer = require("nodemailer");

async function sendEmail(to, subject, html) {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      secure: process.env.EMAIL_PORT === "465", // Use `true` for SSL (465), `false` for TLS (587)
      port: process.env.EMAIL_PORT || 587, // Default to 587 (TLS)
    });

    const mailOptions = {
      from: `"FreelancerHub" <${process.env.EMAIL_USER}>`, // More professional
      to,
      subject,
      html,
      replyTo: process.env.EMAIL_USER, // Allows users to reply
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent: ", info.messageId);
    return info;
  } catch (error) {
    console.error("Email sending error:", error);
    throw new Error("Failed to send email");
  }
}

module.exports = sendEmail;
