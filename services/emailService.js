import sgMail from "@sendgrid/mail";
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import { logger } from "../utils/logger.js";

let sendgridInitialised = false;

function ensureSendgrid() {
  if (sendgridInitialised) return;
  if (!env.SENDGRID_API_KEY) {
    throw new AppError(
      503,
      "Email provider is not configured (SENDGRID_API_KEY is missing on the server). Ask the admin to set it in the deployment env vars.",
      { code: "EMAIL_NOT_CONFIGURED", reason: "missing_api_key" }
    );
  }
  sgMail.setApiKey(env.SENDGRID_API_KEY);
  sendgridInitialised = true;
}

function buildOtpEmail(email, otp, fullname) {
  const greeting = fullname || "there";
  return {
    to: email,
    from: env.EMAIL_FROM,
    subject: "Your Cozie Verification Code",
    text: `Hello ${greeting}!\n\nYour Cozie verification code is: ${otp}\n\nThis code will expire in 10 minutes.\n\nIf you didn't request this code, please ignore this email.`,
    html: `
      <!DOCTYPE html>
      <html><body style="font-family:system-ui,sans-serif;background:#f5f5f5;padding:20px;">
        <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;">
          <div style="background:linear-gradient(135deg,#a855f7 0%,#ec4899 100%);padding:30px;text-align:center;color:#fff;">
            <h1 style="margin:0;font-size:28px;">Cozie</h1>
          </div>
          <div style="padding:30px;">
            <p><strong>Hello ${greeting}!</strong></p>
            <p>Use the code below to complete your registration:</p>
            <div style="font-size:48px;font-weight:700;color:#a855f7;letter-spacing:8px;text-align:center;margin:20px 0;">${otp}</div>
            <p>This code will expire in <strong>10 minutes</strong>.</p>
            <p>If you didn't request this, ignore this email.</p>
          </div>
        </div>
      </body></html>
    `,
  };
}

export const emailService = {
  async sendOtpEmail(email, otp, fullname) {
    ensureSendgrid();
    if (!env.EMAIL_FROM) {
      throw new AppError(
        503,
        "Email sender is not configured (EMAIL_FROM is missing on the server). Ask the admin to set it to a verified SendGrid sender.",
        { code: "EMAIL_NOT_CONFIGURED", reason: "missing_from_address" }
      );
    }
    const message = buildOtpEmail(email, otp, fullname);
    try {
      const response = await sgMail.send(message);
      logger.info({ email, statusCode: response[0]?.statusCode }, "OTP email sent");
    } catch (err) {
      // Log the full SendGrid response body so we can see exactly what
      // the provider rejected (unverified sender, sandbox mode, bad
      // template, etc.). The error is re-thrown so the caller (signup /
      // resendOtp) can decide what HTTP status to return.
      logger.error(
        {
          err: err.message,
          statusCode: err.code || err.response?.statusCode,
          body: err.response?.body,
        },
        "Failed to send OTP email"
      );
      throw err;
    }
  },
};
