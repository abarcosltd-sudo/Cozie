// config/email.js
import sgMail from '@sendgrid/mail';

// Set API Key
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Generate 6-digit OTP
export const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send OTP email
export const sendOTPEmail = async (email, otp, fullname) => {
  const msg = {
    to: email,
    from: process.env.EMAIL_FROM, // Must be a verified sender in SendGrid
    subject: 'Your Cozie Verification Code',
    text: `Hello ${fullname || 'there'}!\n\nThank you for signing up for Coozie. Your verification code is: ${otp}\n\nThis code will expire in 10 minutes.\n\nIf you didn't request this code, please ignore this email.\n\n© 2024 Coozie`,
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
          }
          .content {
            padding: 30px;
            border-radius: 0 0 12px 12px;
          }
          .otp-code {
            font-size: 48px;
            font-weight: bold;
            color: #a855f7;
            letter-spacing: 8px;
            text-align: center;
            margin: 20px 0;
          }
          .footer {
            text-align: center;
            margin-top: 20px;
            font-size: 12px;
            color: #999;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎵 Coozie</h1>
          </div>
          <div class="content">
            <p><strong>Hello ${fullname || 'there'}!</strong></p>
            <p>Use the code below to complete your registration:</p>
            <div class="otp-code">${otp}</div>
            <p>This code will expire in <strong>10 minutes</strong>.</p>
            <p>If you didn't request this, ignore this email.</p>
          </div>
          <div class="footer">
            <p>© 2024 Coozie</p>
          </div>
        </div>
      </body>
      </html>
    `,
  };

  try {
    const response = await sgMail.send(msg);
    console.log('Email sent:', response[0].statusCode);
    return { success: true };
  } catch (error) {
    console.error('SendGrid error:', error.response?.body || error.message);
    throw error;
  }
};

// Test SendGrid configuration
export const testEmailConfig = async () => {
  try {
    await sgMail.send({
      to: process.env.EMAIL_USER, // send to yourself
      from: process.env.EMAIL_FROM,
      subject: 'SendGrid Test Email',
      text: 'Your SendGrid setup is working!',
    });

    console.log('SendGrid configuration is valid');
    return true;
  } catch (error) {
    console.error('SendGrid configuration error:', error.response?.body || error.message);
    return false;
  }
};
