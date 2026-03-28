import { db, frontendBucket } from "../config/firebase.js";
import { sendOTPEmail, generateOTP } from '../config/email.js';
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Cors from "cors";
import crypto from 'crypto'; // for generating OTP

// // Setup CORS middleware
// const cors = Cors({
//   origin: function (origin, callback) {
//     if (!origin || origin.includes("vercel.app") || origin.includes("localhost")) {
//       callback(null, true);
//     } else {
//       callback(new Error("Not allowed by CORS"));
//     }
//   },
//   methods: ["GET", "POST", "OPTIONS"],
//   allowedHeaders: ["Content-Type", "Authorization"],
//   credentials: true,
// });

// In your CORS configuration
const cors = Cors({
  origin: function (origin, callback) {
    const allowedOrigins = [
      'https://cozie-cs.vercel.app',
      'http://localhost:3000',
      'http://localhost:5173',
    ];
    
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
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

//const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// const sendOTPEmail = async (email, otp) => {
//   const transporter = nodemailer.createTransport({
//     host: process.env.EMAIL_HOST,
//     port: process.env.EMAIL_PORT,
//     secure: process.env.EMAIL_PORT === '465', // true for 465, false for other ports
//     auth: {
//       user: process.env.EMAIL_USER,
//       pass: process.env.EMAIL_PASS,
//     },
//   });

//   const mailOptions = {
//     from: process.env.EMAIL_FROM,
//     to: email,
//     subject: 'Your Coozie Verification Code',
//     text: `Your verification code is: ${otp}`,
//     html: `<p>Your verification code is: <strong>${otp}</strong></p>`,
//   };

//   await transporter.sendMail(mailOptions);
// };

// =======================
// Signup user
// =======================
export const signupUser = async (req, res) => {
  await runMiddleware(req, res, cors);

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { fullname, username, email, password } = req.body;
    // ... validation ...

    const normalizedEmail = email.toLowerCase();

    // Check if user exists
    const snapshot = await db
      .collection('users')
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get();
    if (!snapshot.empty) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const newUserRef = db.collection('users').doc();

    // Generate OTP
    const otp = generateOTP();
    const otpExpiresAt = new Date();
    otpExpiresAt.setMinutes(otpExpiresAt.getMinutes() + 10);

    // Create user in Firestore
    const userRef = db.collection('users').doc();
    await userRef.set({
      id: userRef.id,
      fullname,
      username,
      email,
      password: hashedPassword,
      isVerified: false,
      otp: {
        code: otp,
        expiresAt: otpExpiresAt,
      },
      createdAt: new Date(),
    });
    
    // Try to send email, but don't fail the signup if it fails
    let emailSent = false;
    // Send OTP email
    try {
      await sendOTPEmail(email, otp, fullname);
      console.log(`OTP sent to ${email}`);
      
      return res.status(200).json({
        success: true,
        message: 'Verification code sent to your email',
        userId: userRef.id,
      });
    } catch (emailError) {
      console.error('Email sending failed:', emailError.message);
      
      // Account created but email failed
      return res.status(200).json({
        success: true,
        warning: 'Account created but verification email could not be sent. Please check your email settings or contact support.',
        userId: userRef.id,
        emailFailed: true,
      });
    }

    // Always return a 201 success (user is created)
    return res.status(201).json({
      success: true,
      message: emailSent
        ? 'User registered successfully. Please check your email for verification code.'
        : 'User registered, but verification email could not be sent. Please contact support or request a new code.',
      user: { id: newUserRef.id, fullname, username, email: normalizedEmail },
      emailSent, // optional flag for client
    });
  } catch (err) {
    console.error('Signup error:', err);
    // If the error is from Firestore or bcrypt, it will be caught here
    return res.status(500).json({ success: false, message: 'Server error' });
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
      user: { id: userDoc.id, fullname: user.fullname, username: user.username, email: user.email, displayName: user.displayName, photoURL: user.photoURL, bio: user.bio },
    });
  } catch (err) {
    console.error("Profile error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

//===================
// Verify user otp
//===================
export const verifyOTP = async (req, res) => {
  await runMiddleware(req, res, cors);
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and OTP are required' });
    }

    const normalizedEmail = email.toLowerCase();
    const snapshot = await db.collection('users').where('email', '==', normalizedEmail).limit(1).get();
    if (snapshot.empty) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();

    // Check if already verified
    if (userData.isVerified) {
      return res.status(400).json({ success: false, message: 'Email already verified' });
    }

    // Check OTP expiry
    if (new Date() > userData.otp.expiresAt.toDate()) {
      return res.status(400).json({ success: false, message: 'OTP expired' });
    }

    // Compare OTP (in production, compare hashed values)
    if (userData.otp.code !== otp) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }

    // Mark as verified and remove OTP fields (optional)
    await userDoc.ref.update({
      isVerified: true,
      otp: null, // or delete field
    });

    // Generate token (optional)
    const token = generateToken(userDoc.id);

    return res.status(200).json({
      success: true,
      message: 'Email verified successfully',
      token, // if you want to log user in immediately
    });
  } catch (err) {
    console.error('Verify OTP error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

//==========================
// Save preferences
//==========================
export const savePreferences = async (req, res) => {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const { genres } = req.body;

    // Validate input
    if (!genres || !Array.isArray(genres) || genres.length === 0) {
      return res.status(400).json({ success: false, message: "Genres array is required" });
    }

    // `req.user` is attached by the protect middleware
    // It contains the user data from Firestore (including the `id` field)
    const userId = req.user.id;

    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Update the user document with the selected genres
    await userRef.update({
      genres: genres,
      updatedAt: new Date(),
    });

    return res.status(200).json({
      success: true,
      message: "Preferences saved successfully",
    });
  } catch (error) {
    console.error("Error saving preferences:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

//=======================
// Get the current user
//=======================
export const getCurrentUser = async (req, res) => {
  try {
    const userId = req.user.id;
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    const userData = userDoc.data();
    // Remove sensitive fields
    delete userData.password;
    delete userData.otp;
    return res.status(200).json({ success: true, user: userData });
  } catch (error) {
    console.error("Error fetching user:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

//========================
// Update Profile
//========================
export const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { displayName, username, bio, photoURL, removePhoto } = req.body;

    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const updateData = {};

    if (displayName !== undefined) updateData.displayName = displayName;

    // Username uniqueness check
    if (username !== undefined) {
      const existing = await db.collection("users").where("username", "==", username).limit(1).get();
      if (!existing.empty && existing.docs[0].id !== userId) {
        return res.status(400).json({ success: false, message: "Username already taken" });
      }
      updateData.username = username;
    }

    if (bio !== undefined) updateData.bio = bio; // allow empty string

    // Handle photo
    if (removePhoto === true) {
      updateData.photoURL = null;
    } else if (photoURL !== undefined) {
      // If photoURL is provided, store it (frontend already uploaded to Firebase Storage)
      updateData.photoURL = photoURL;
    }
    // If neither removePhoto nor photoURL is provided, photo remains unchanged

    updateData.updatedAt = new Date();

    await userRef.update(updateData);

    return res.status(200).json({ success: true, message: "Profile updated successfully" });
  } catch (error) {
    console.error("Error updating profile:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};


//============================
// Generate upload URL
//============================
export const generateUploadURL = async (req, res) => {
  try {
    const userId = req.user.id; // from your JWT
    const { fileName, fileType } = req.body;

    if (!fileName || !fileType) {
      return res.status(400).json({ success: false, message: 'Missing fileName or fileType' });
    }

    // Sanitize filename and create a unique path
    const safeName = fileName.replace(/[^a-zA-Z0-9.]/g, '_');
    const timestamp = Date.now();
    const uniqueId = uuidv4().split('-')[0]; // optional short id
    const blobPath = `profile-photos/${userId}/${timestamp}_${uniqueId}_${safeName}`;
    const file = frontendBucket.file(blobPath);

    const options = {
      version: 'v4',
      action: 'write',
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
      contentType: fileType,
    };

    const [signedUrl] = await file.getSignedUrl(options);
    const publicUrl = `https://storage.googleapis.com/${frontendBucket.name}/${blobPath}`;

    res.json({
      success: true,
      signedUrl,
      publicUrl,
      path: blobPath // optional, for reference
    });
  } catch (error) {
    console.error('Error generating signed URL:', error);
    res.status(500).json({ success: false, message: 'Failed to generate upload URL' });
  }
};

