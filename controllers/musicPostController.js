import MusicPost from "../models/MusicPost";
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

// CORS configuration
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
export const createMusicPost = async (req, res, next) => {
  await runMiddleware(req, res, cors);

  const user = await authenticate(req, res);
  if (!user) return;

  try {
    const newPost = await MusicPost.create({
      ...req.body,
      userId: user.id
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
export const getMusicPosts = async (req, res, next) => {
  await runMiddleware(req, res, cors);

  const user = await authenticate(req, res);
  if (!user) return;

  try {
    const posts = await MusicPost.getByGenres(req.user.selectedGenres);

    res.json(posts);
  } catch (error) {
    next(error);
  }
};

// SHARE MUSIC POST (new endpoint)
export const shareMusicPost = async (req, res, next) => {
  await runMiddleware(req, res, cors);

  const user = await authenticate(req, res);
  if (!user) return;

  try {
    const { songId, caption, platforms } = req.body;

    // Validate required fields
    if (!songId) {
      return res.status(400).json({ success: false, message: "songId is required" });
    }
    if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
      return res.status(400).json({ success: false, message: "platforms array with at least one platform is required" });
    }

    // Verify the song exists in the music collection
    const songDoc = await db.collection("music").doc(songId).get();
    if (!songDoc.exists) {
      return res.status(404).json({ success: false, message: "Song not found" });
    }
    const songData = { id: songDoc.id, ...songDoc.data() };

    // Build post data
    const postData = {
      userId: user.id,
      songId,
      caption: caption || "",
      platforms,
      songSnapshot: {
        title: songData.title,
        artist: songData.artist,
        albumArtUrl: songData.albumArtUrl || null,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      type: "music_share", // optional: for filtering in feed
    };

    // Create the post using the MusicPost model (assumes a create method)
    const newPost = await MusicPost.create(postData);

    return res.status(201).json({
      success: true,
      message: "Music shared successfully",
      postId: newPost.id,
    });
  } catch (error) {
    console.error("Error sharing music post:", error);
    next(error); // or return 500
  }
};
