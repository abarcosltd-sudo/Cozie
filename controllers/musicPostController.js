const MusicPost = require("../models/MusicPost");
import { db, frontendBucket } from "../config/firebase.js";
import jwt from "jsonwebtoken";
import Cors from "cors";
import { v4 as uuidv4 } from "uuid";

// Helper to run CORS middleware
function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) return reject(result);
      return resolve(result);
    });
  });
}

// CORS configuration (same as before)
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

// JWT secret from environment
const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Middleware to verify JWT and attach user to request.
 * For serverless, we call it inside each endpoint.
 */
async function authenticate(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ success: false, message: "No token provided" });
    return null;
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // contains id, etc.
    return req.user;
  } catch (error) {
    res.status(401).json({ success: false, message: "Invalid or expired token" });
    return null;
  }
}

// CREATE
export const createMusicPost = async (req, res) => {
  await runMiddleWare(req, res, cors);
  try {
    const newPost = await MusicPost.create({
      ...req.body,
      userId: req.user.id
    });

    res.status(201).json({
      success: true,
      data: newPost
    });
  } catch (error) {
    next(error);
  }
};

// READ
export const getMusicPosts = async (req, res) => {
  await runMiddleWare(req, res, cors);
  try {
    const posts = await MusicPost.getByGenres(
      req.user.selectedGenres
    );

    res.json(posts);
  } catch (error) {
    next(error);
  }
};

export const shareMusicPost = async (req, res) => {
  await runMiddleWare(req, res, cors);
}
