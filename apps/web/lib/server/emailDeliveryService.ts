export class EmailDeliveryService {
  async sendVerificationEmail(email: string, token: string) {
    if (process.env.NODE_ENV !== "production" && process.env.EMAIL_DELIVERY_MODE !== "resend") {
      console.info(`Slate verification code for ${email}: ${token}`);
      return { developmentCode: token };
    }

    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;
    if (!apiKey || !from) throw new Error("Email delivery is not configured");
    const response = await fetch("https://api.resend.com/emails", {
      body: JSON.stringify({ from, html: `<p>Use this code to verify your Slate email address:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${token}</p><p>This code expires in 24 hours.</p>`, subject: "Your Slate verification code", to: [email] }),
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      method: "POST"
    });
    if (!response.ok) throw new Error("Email delivery failed");
    return { developmentCode: null };
  }
}

export const emailDeliveryService = new EmailDeliveryService();
