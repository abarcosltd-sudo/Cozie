import { db } from '../config/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';
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
 * POST /api/music/:songId/like
 * Like or unlike a song (toggle)
 */
export const likeSong = async (req, res, next) => {
  await runMiddleware(req, res, cors);

  const user = await authenticate(req, res);
  if (!user) return;

  const { songId } = req.params;

  try {
    if (!songId) {
      return res.status(400).json({ success: false, message: "songId is required" });
    }

    // Check if the song exists
    const songRef = db.collection('music').doc(songId);
    const songDoc = await songRef.get();
    
    if (!songDoc.exists) {
      return res.status(404).json({ success: false, message: 'Song not found' });
    }

    const songData = songDoc.data();

    // Reference to the user's like document in the song's likes subcollection
    const likeRef = songRef.collection('likes').doc(user.id);
    const likeDoc = await likeRef.get();

    let liked;
    let likeCountChange = 0;

    if (likeDoc.exists) {
      // Unlike: delete the like document
      await likeRef.delete();
      liked = false;
      likeCountChange = -1;
    } else {
      // Like: create a like document with timestamp
      await likeRef.set({
        userId: user.id,
        userName: user.displayName || user.fullname || 'User',
        userAvatarUrl: user.photoURL || null,
        createdAt: new Date()
      });
      liked = true;
      likeCountChange = 1;
    }

    // Update the likeCount on the song document
    await songRef.update({
      likeCount: FieldValue.increment(likeCountChange),
      updatedAt: new Date()
    });

    // Get the updated like count
    const updatedSongDoc = await songRef.get();
    const updatedLikeCount = updatedSongDoc.data().likeCount || 0;

    return res.status(200).json({
      success: true,
      liked,
      likeCount: updatedLikeCount,
      message: liked ? 'Song liked' : 'Song unliked'
    });
  } catch (error) {
    console.error('Error toggling like:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * GET /api/music/:songId/likes
 * Get all users who liked a specific song
 */
export const getSongLikes = async (req, res, next) => {
  await runMiddleware(req, res, cors);

  const user = await authenticate(req, res);
  if (!user) return;

  const { songId } = req.params;

  try {
    if (!songId) {
      return res.status(400).json({ success: false, message: "songId is required" });
    }

    // Check if the song exists
    const songDoc = await db.collection('music').doc(songId).get();
    if (!songDoc.exists) {
      return res.status(404).json({ success: false, message: 'Song not found' });
    }

    // Get all likes for this song
    const likesSnapshot = await db
      .collection('music')
      .doc(songId)
      .collection('likes')
      .orderBy('createdAt', 'desc')
      .get();

    const likes = likesSnapshot.docs.map(doc => ({
      userId: doc.id,
      ...doc.data()
    }));

    const songData = songDoc.data();

    return res.status(200).json({
      success: true,
      songId,
      songTitle: songData.title,
      songArtist: songData.artist,
      likeCount: songData.likeCount || 0,
      likes,
      userLiked: likes.some(like => like.userId === user.id)
    });
  } catch (error) {
    console.error('Error fetching song likes:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * GET /api/music/liked
 * Get all songs liked by the current user
 */
export const getUserLikedSongs = async (req, res, next) => {
  await runMiddleware(req, res, cors);

  const user = await authenticate(req, res);
  if (!user) return;

  try {
    // Query all music documents and check if the user has liked them
    // This is a more complex query. Alternative: store liked songs in a subcollection under user
    const likedSongs = [];
    
    // Option 1: Query all music and filter (less efficient for large datasets)
    const allMusicSnapshot = await db.collection('music').get();
    
    for (const doc of allMusicSnapshot.docs) {
      const likeDoc = await db
        .collection('music')
        .doc(doc.id)
        .collection('likes')
        .doc(user.id)
        .get();
      
      if (likeDoc.exists) {
        likedSongs.push({
          id: doc.id,
          ...doc.data(),
          likedAt: likeDoc.data().createdAt
        });
      }
    }

    // Sort by liked date (most recent first)
    likedSongs.sort((a, b) => new Date(b.likedAt) - new Date(a.likedAt));

    return res.status(200).json({
      success: true,
      likedSongs,
      count: likedSongs.length
    });
  } catch (error) {
    console.error('Error fetching user liked songs:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * Alternative: Store liked songs in user subcollection for better performance
 * POST /api/music/:songId/like (with user subcollection tracking)
 */
export const likeSongAlternative = async (req, res, next) => {
  await runMiddleware(req, res, cors);

  const user = await authenticate(req, res);
  if (!user) return;

  const { songId } = req.params;

  try {
    if (!songId) {
      return res.status(400).json({ success: false, message: "songId is required" });
    }

    // Check if the song exists
    const songRef = db.collection('music').doc(songId);
    const songDoc = await songRef.get();
    
    if (!songDoc.exists) {
      return res.status(404).json({ success: false, message: 'Song not found' });
    }

    const songData = songDoc.data();

    // Check user's like in their own liked songs subcollection
    const userLikeRef = db
      .collection('users')
      .doc(user.id)
      .collection('likedSongs')
      .doc(songId);
    
    const userLikeDoc = await userLikeRef.get();
    let liked;

    if (userLikeDoc.exists) {
      // Unlike: remove from user's liked songs
      await userLikeRef.delete();
      
      // Also remove from song's likes subcollection
      await songRef.collection('likes').doc(user.id).delete();
      
      liked = false;
      
      // Update like count
      await songRef.update({
        likeCount: FieldValue.increment(-1)
      });
    } else {
      // Like: add to user's liked songs
      await userLikeRef.set({
        songId,
        title: songData.title,
        artist: songData.artist,
        albumArtUrl: songData.albumArtUrl || null,
        fileUrl: songData.fileUrl,
        likedAt: new Date()
      });
      
      // Add to song's likes subcollection
      await songRef.collection('likes').doc(user.id).set({
        userId: user.id,
        userName: user.displayName || user.fullname || 'User',
        likedAt: new Date()
      });
      
      liked = true;
      
      // Update like count
      await songRef.update({
        likeCount: FieldValue.increment(1)
      });
    }

    const updatedSongDoc = await songRef.get();
    const updatedLikeCount = updatedSongDoc.data().likeCount || 0;

    return res.status(200).json({
      success: true,
      liked,
      likeCount: updatedLikeCount,
      message: liked ? 'Song liked' : 'Song unliked'
    });
  } catch (error) {
    console.error('Error toggling like:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
