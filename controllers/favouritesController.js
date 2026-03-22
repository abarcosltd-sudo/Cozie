import { db } from '../config/firebase.js';
import Cors from 'cors';
import jwt from 'jsonwebtoken';

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
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
});

// JWT secret from environment
const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Middleware to verify JWT and attach user to request
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
    req.user = decoded;
    return req.user;
  } catch (error) {
    res.status(401).json({ success: false, message: "Invalid or expired token" });
    return null;
  }
}

/**
 * GET /api/users/favorites/:songId
 * Check if a song is in user's favorites
 */
export const checkFavorite = async (req, res, next) => {
  await runMiddleware(req, res, cors);

  const user = await authenticate(req, res);
  if (!user) return;

  const { songId } = req.params;

  try {
    if (!songId) {
      return res.status(400).json({ success: false, message: "songId is required" });
    }

    // Check if the song exists in user's favorites subcollection
    const favoriteRef = db
      .collection('users')
      .doc(user.id)
      .collection('favorites')
      .doc(songId);
    
    const favoriteDoc = await favoriteRef.get();
    const isFavorited = favoriteDoc.exists;

    return res.status(200).json({
      success: true,
      isFavorited,
      songId
    });
  } catch (error) {
    console.error('Error checking favorite:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * POST /api/users/favorites/:songId
 * Add a song to user's favorites
 */
export const addFavorite = async (req, res, next) => {
  await runMiddleware(req, res, cors);

  const user = await authenticate(req, res);
  if (!user) return;

  const { songId } = req.params;
  const { title, artist, albumArtUrl, fileUrl, duration } = req.body;

  try {
    if (!songId) {
      return res.status(400).json({ success: false, message: "songId is required" });
    }

    // First, verify the song exists in the music collection
    const songDoc = await db.collection('music').doc(songId).get();
    if (!songDoc.exists) {
      return res.status(404).json({ success: false, message: 'Song not found' });
    }

    const songData = songDoc.data();

    // Add to user's favorites subcollection
    const favoriteRef = db
      .collection('users')
      .doc(user.id)
      .collection('favorites')
      .doc(songId);

    await favoriteRef.set({
      songId,
      title: title || songData.title,
      artist: artist || songData.artist,
      albumArtUrl: albumArtUrl || songData.albumArtUrl || null,
      fileUrl: fileUrl || songData.fileUrl,
      duration: duration || songData.duration,
      addedAt: new Date(),
      updatedAt: new Date()
    });

    // Also increment the favorite count on the music document
    await db.collection('music').doc(songId).update({
      favoriteCount: admin.firestore.FieldValue.increment(1)
    });

    return res.status(200).json({
      success: true,
      message: 'Song added to favorites',
      isFavorited: true
    });
  } catch (error) {
    console.error('Error adding favorite:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * DELETE /api/users/favorites/:songId
 * Remove a song from user's favorites
 */
export const removeFavorite = async (req, res, next) => {
  await runMiddleware(req, res, cors);

  const user = await authenticate(req, res);
  if (!user) return;

  const { songId } = req.params;

  try {
    if (!songId) {
      return res.status(400).json({ success: false, message: "songId is required" });
    }

    // Remove from user's favorites subcollection
    const favoriteRef = db
      .collection('users')
      .doc(user.id)
      .collection('favorites')
      .doc(songId);

    const favoriteDoc = await favoriteRef.get();
    if (!favoriteDoc.exists) {
      return res.status(404).json({ success: false, message: 'Song not in favorites' });
    }

    await favoriteRef.delete();

    // Decrement the favorite count on the music document
    await db.collection('music').doc(songId).update({
      favoriteCount: admin.firestore.FieldValue.increment(-1)
    });

    return res.status(200).json({
      success: true,
      message: 'Song removed from favorites',
      isFavorited: false
    });
  } catch (error) {
    console.error('Error removing favorite:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * GET /api/users/favorites
 * Get all favorited songs for the current user
 */
export const getFavorites = async (req, res, next) => {
  await runMiddleware(req, res, cors);

  const user = await authenticate(req, res);
  if (!user) return;

  try {
    const favoritesSnapshot = await db
      .collection('users')
      .doc(user.id)
      .collection('favorites')
      .orderBy('addedAt', 'desc')
      .get();

    const favorites = favoritesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return res.status(200).json({
      success: true,
      favorites,
      count: favorites.length
    });
  } catch (error) {
    console.error('Error fetching favorites:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
