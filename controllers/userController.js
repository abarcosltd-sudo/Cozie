import { db } from "../config/firebase.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Cors from "cors";
import nodemailer from 'nodemailer'; // or use your preferred email service
import crypto from 'crypto'; // for generating OTP

// Setup CORS middleware
const cors = Cors({
  origin: function (origin, callback) {
    if (!origin || origin.includes("vercel.app") || origin.includes("localhost")) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
});

// Helper to run middleware in serverless
function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) return reject(result);
      return resolve(result);
    });
  });
}

// Helper to generate JWT
const generateToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "7d" });

// Configure email transporter (use environment variables)
const transporter = nodemailer.createTransport({
  service: 'gmail', // or your email service
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Helper to generate 6-digit OTP
const generateOTP = () => {
  return crypto.randomInt(100000, 999999).toString(); // ensures 6 digits
};

// Helper to send OTP email
const sendOTPEmail = async (email, otp) => {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Your COZIE Verification Code',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #a855f7;">Welcome to COZIE!</h2>
        <p>Your verification code is:</p>
        <h1 style="background: #f3f4f6; padding: 20px; text-align: center; letter-spacing: 5px; font-size: 36px; border-radius: 8px;">${otp}</h1>
        <p>This code expires in 10 minutes.</p>
        <p>If you didn't request this, please ignore this email.</p>
        <br>
        <p>– The COZIE Team</p>
      </div>
    `,
  };
  await transporter.sendMail(mailOptions);
};


// =======================
// Signup user
// =======================
export const signupUser = async (req, res) => {
  await runMiddleware(req, res, cors);

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const { fullname, username, email, password } = req.body;

    if (!fullname || !username || !email || !password) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    const normalizedEmail = email.toLowerCase();

    // Check if user exists
    const snapshot = await db
      .collection("users")
      .where("email", "==", normalizedEmail)
      .limit(1)
      .get();

    if (!snapshot.empty) {
      return res.status(400).json({ success: false, message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const newUserRef = db.collection("users").doc();

    // Generate OTP and expiry (10 minutes from now)
    const otp = generateOTP();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const newUser = {
      id: newUserRef.id,
      fullname,
      username,
      email: normalizedEmail,
      password: hashedPassword,
      createdAt: new Date(),
      isVerified: false,           // user starts unverified
      otp: {
        code: otp,                 // store OTP (consider hashing for production)
        expiresAt: otpExpiresAt,
      },
    };

    await newUserRef.set(newUser);

    // Send OTP email
    await sendOTPEmail(normalizedEmail, otp);

    // Return success WITHOUT token (user not verified)
    return res.status(201).json({
      success: true,
      message: "User registered successfully. Please check your email for verification code.",
      // Optionally return user info (without token)
      user: { id: newUserRef.id, fullname, username, email: normalizedEmail },
    });
  } catch (err) {
    console.error("Signup error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// =======================
// Login user
// =======================
export const loginUser = async (req, res) => {
  await runMiddleware(req, res, cors);

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    const normalizedEmail = email.toLowerCase();

    const snapshot = await db
      .collection("users")
      .where("email", "==", normalizedEmail)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const userDoc = snapshot.docs[0];
    const user = userDoc.data();

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const token = generateToken(user.id);

    return res.status(200).json({
      success: true,
      token,
      user: { id: user.id, fullname: user.fullname, username: user.username, email: user.email },
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// =======================
// Get user profile
// =======================
export const getProfile = async (req, res) => {
  await runMiddleware(req, res, cors);

  if (req.method !== "GET") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const token = authHeader.split(" ")[1];

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ success: false, message: "Invalid token" });
    }

    const userDoc = await db.collection("users").doc(decoded.id).get();

    if (!userDoc.exists) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const user = userDoc.data();

    return res.status(200).json({
      success: true,
      user: { id: userDoc.id, fullname: user.fullname, username: user.username, email: user.email },
    });
  } catch (err) {
    console.error("Profile error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};




