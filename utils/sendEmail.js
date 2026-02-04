const Brevo = require("@getbrevo/brevo");

const transactionalApi = new Brevo.TransactionalEmailsApi();

// 🔑 Set API key correctly
transactionalApi.setApiKey(
  Brevo.TransactionalEmailsApiApiKeys.apiKey,
  process.env.BREVO_API_KEY
);

async function sendEmail(to, subject, html) {
  try {
    await transactionalApi.sendTransacEmail({
      sender: {
        email: process.env.BREVO_SENDER_EMAIL,
        name: process.env.BREVO_SENDER_NAME,
      },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    });
  } catch (error) {
    console.error(
      "Brevo email error:",
      error?.response?.text || error.message || error
    );
    throw new Error("Failed to send email");
  }
}

module.exports = sendEmail;
