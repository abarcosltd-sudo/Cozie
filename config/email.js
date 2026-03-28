// config/email.js
import nodemailer from 'nodemailer';

// Create email transporter
const createTransporter = () => {
  // For Gmail
  if (process.env.EMAIL_HOST === 'smtp.gmail.com') {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS, // App Password (not regular password)
      },
    });
  }
  else {
    // For other SMTP providers (SendGrid, Mailgun, etc.)
    return nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT || '587'),
      secure: process.env.EMAIL_PORT === '465', // true for 465, false for other ports
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      tls: {
        rejectUnauthorized: false, // Only for development
      },
    });
  }
};

// Generate 6-digit OTP
export const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send OTP email
export const sendOTPEmail = async (email, otp, fullname) => {
  const transporter = createTransporter();
  
  const mailOptions = {
    from: `"Cozie" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Your Cozie Verification Code',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            margin: 0;
            padding: 0;
            background-color: #f5f5f5;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #ffffff;
          }
          .header {
            background: linear-gradient(135deg, #a855f7 0%, #ec4899 100%);
            padding: 30px 20px;
            text-align: center;
            border-radius: 12px 12px 0 0;
          }
          .header h1 {
            color: white;
            margin: 0;
            font-size: 28px;
            letter-spacing: 1px;
          }
          .content {
            padding: 30px;
            background: #ffffff;
            border-radius: 0 0 12px 12px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          .greeting {
            font-size: 18px;
            color: #333;
            margin-bottom: 20px;
          }
          .otp-container {
            text-align: center;
            margin: 30px 0;
          }
          .otp-code {
            font-size: 48px;
            font-weight: bold;
            color: #a855f7;
            letter-spacing: 8px;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 12px;
            font-family: monospace;
          }
          .message {
            color: #666;
            margin: 20px 0;
          }
          .footer {
            text-align: center;
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #eee;
            font-size: 12px;
            color: #999;
          }
          .button {
            display: inline-block;
            padding: 12px 24px;
            background: linear-gradient(135deg, #a855f7 0%, #ec4899 100%);
            color: white;
            text-decoration: none;
            border-radius: 8px;
            margin-top: 20px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎵 Cozie</h1>
          </div>
          <div class="content">
            <div class="greeting">
              <strong>Hello ${fullname || 'there'}!</strong>
            </div>
            <p>Thank you for signing up for Cozie. Please use the verification code below to complete your registration:</p>
            <div class="otp-container">
              <div class="otp-code">${otp}</div>
            </div>
            <p class="message">This code will expire in <strong>10 minutes</strong>.</p>
            <p class="message">If you didn't request this code, please ignore this email.</p>
          </div>
          <div class="footer">
            <p>© 2024 Cozie. All rights reserved.</p>
            <p>Your social music platform</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `Hello ${fullname || 'there'}!\n\nThank you for signing up for Cozie. Your verification code is: ${otp}\n\nThis code will expire in 10 minutes.\n\nIf you didn't request this code, please ignore this email.\n\n© 2024 Cozie`,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Email sending failed:', error);
    throw error;
  }
};

// Test email configuration
export const testEmailConfig = async () => {
  try {
    const transporter = createTransporter();
    await transporter.verify();
    console.log('Email configuration is valid');
    return true;
  } catch (error) {
    console.error('Email configuration error:', error.message);
    return false;
  }
};
