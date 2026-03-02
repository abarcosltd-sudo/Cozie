import { db } from "../config/firebase.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Cors from "cors";

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

    const newUser = {
      id: newUserRef.id,
      fullname,
      username,
      email: normalizedEmail,
      password: hashedPassword,
      createdAt: new Date(),
    };

    await newUserRef.set(newUser);

    const token = generateToken(newUserRef.id);

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      token,
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


