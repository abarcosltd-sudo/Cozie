import { db, frontendBucket } from "../config/firebase.js";
import jwt from "jsonwebtoken";
import Cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { FieldValue } from 'firebase-admin/firestore'

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

//======================================
// Share music
//======================================
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

    // Save directly to Firestore in a "musicPosts" collection
    const postRef = await db.collection("musicPosts").add(postData);

    return res.status(201).json({
      success: true,
      message: "Music shared successfully",
      postId: postRef.id,
    });
  } catch (error) {
    console.error("Error sharing music post:", error);
    // Use next(error) if you have error-handling middleware, else return 500
    if (next) {
      next(error);
    } else {
      return res.status(500).json({ success: false, message: "Server error" });
    }
  }
};


//================================
// Get posts
//================================
export const getMusicPosts = async (req, res, next) => {
  await runMiddleware(req, res, cors);

  const user = await authenticate(req, res);
  if (!user) return;

  try {
    // Fetch music posts, newest first
    const postsSnapshot = await db
      .collection('musicPosts')
      .orderBy('createdAt', 'desc')
      .limit(50) // pagination can be added later
      .get();

    const posts = [];

    for (const doc of postsSnapshot.docs) {
      const postData = doc.data();

      // Get user info
      const userDoc = await db.collection('users').doc(postData.userId).get();
      const userData = userDoc.exists
        ? userDoc.data()
        : { fullname: 'Unknown User', displayName: 'User' };
      
      const userAvatarUrl = userData.photoURL || null;
      
      // Check if current user liked this post
      const likeDoc = await db
        .collection('musicPosts')
        .doc(doc.id)
        .collection('likes')
        .doc(user.id)
        .get();
      const likedByUser = likeDoc.exists;

      // Count likes (could be cached as a field for efficiency)
      const likesSnapshot = await db
        .collection('musicPosts')
        .doc(doc.id)
        .collection('likes')
        .count()
        .get();
      const likesCount = likesSnapshot.data().count;

      // Count comments (assuming a 'comments' subcollection)
      const commentsSnapshot = await db
        .collection('musicPosts')
        .doc(doc.id)
        .collection('comments')
        .count()
        .get();
      const commentsCount = commentsSnapshot.data().count;

      posts.push({
        id: doc.id,
        userName: userData.fullname || userData.displayName || 'User',
        userAvatarUrl: userAvatarUrl,
        createdAt: postData.createdAt ? postData.createdAt.toDate().toISOString() : new Date().toISOString(),
        caption: postData.caption || '',
        songSnapshot: postData.songSnapshot || {
          title: 'Untitled',
          artist: 'Unknown Artist',
          albumArtUrl: null,
        },
        likes: likesCount,
        comments: commentsCount,
        likedByUser,
      });
    }

    // Set headers to prevent caching
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    return res.status(200).json({ success: true, posts });
  } catch (error) {
    console.error('Error fetching music posts:', error);
    next(error);
  }
};

//============================
// Like Post
//============================
export const likePost = async (req, res, next) => {
  await runMiddleware(req, res, cors);

  const user = await authenticate(req, res);
  if (!user) return;

  const { postId } = req.params;

  try {
    const postRef = db.collection('musicPosts').doc(postId);
    const postDoc = await postRef.get();
    if (!postDoc.exists) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const likeRef = postRef.collection('likes').doc(user.id);
    const likeDoc = await likeRef.get();

    let liked;
    let likeCountChange = 0;

    if (likeDoc.exists) {
      await likeRef.delete();
      liked = false;
      likeCountChange = -1;
    } else {
      await likeRef.set({ userId: user.id, createdAt: new Date() });
      liked = true;
      likeCountChange = 1;
    }

    const likesSnapshot = await postRef.collection('likes').count().get();
    const likeCount = likesSnapshot.data().count;

    // Update the likeCount on the corresponding music document
    const postData = postDoc.data();
    if (postData.songId) {
      const musicRef = db.collection('music').doc(postData.songId);
      await musicRef.update({
        likeCount: FieldValue.increment(likeCountChange),
      });
    }

    return res.status(200).json({
      success: true,
      liked,
      likeCount,
      message: liked ? 'Post liked' : 'Post unliked',
    });
  } catch (error) {
    console.error('Error toggling like:', error);
    next(error);
  }
};
//===============================
// Add comment
//===============================
export const addComment = async (req, res, next) => {
  await runMiddleware(req, res, cors);
  const user = await authenticate(req, res);
  if (!user) return;

  const { postId } = req.params;
  const { text } = req.body;
  if (!text || text.trim() === '') {
    return res.status(400).json({ success: false, message: 'Comment text is required' });
  }

  try {
    const postRef = db.collection('musicPosts').doc(postId);
    const postDoc = await postRef.get();
    if (!postDoc.exists) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    // Fetch user's name (optional, for denormalization)
    const userDoc = await db.collection('users').doc(user.id).get();
    const userName = userDoc.exists ? (userDoc.data().fullname || userDoc.data().displayName || 'User') : 'User';

    // Add comment to subcollection
    const commentRef = postRef.collection('comments').doc();
    await commentRef.set({
      userId: user.id,
      userName: userName,
      text: text.trim(),
      createdAt: new Date(),
    });

    // Increment comment count on the post
    await postRef.update({
      commentCount: FieldValue.increment(1)
    });

    // Get the updated comment count
    const newCountSnapshot = await postRef.collection('comments').count().get();
    const newCount = newCountSnapshot.data().count;

    return res.status(201).json({
      success: true,
      commentId: commentRef.id,
      commentCount: newCount
    });
  } catch (error) {
    console.error('Error adding comment:', error);
    next(error);
  }
};
