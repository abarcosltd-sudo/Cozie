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
    // Check if the post exists
    const postRef = db.collection('musicPosts').doc(postId);
    const postDoc = await postRef.get();
    if (!postDoc.exists) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    // Reference to the user's like document in the post's likes subcollection
    const likeRef = postRef.collection('likes').doc(user.id);
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
        createdAt: new Date(),
      });
      liked = true;
      likeCountChange = 1;
    }

    // Optionally update a denormalized likeCount field on the post document
    // (if you decide to maintain it for efficient counting)
    // await postRef.update({
    //   likeCount: admin.firestore.FieldValue.increment(likeCountChange)
    // });

    // For now, we'll just return the new like status.
    // To get the updated like count, we could either:
    // - Read it from the subcollection (costly) or
    // - Use the field above and return it.
    // We'll keep it simple: return only the new status.
    // If you want the count, you can query it after update or return it from here.

    // For a complete response, you might want to return the new like count.
    // Let's fetch the updated count using an aggregation (Firestore count()).
    const likesSnapshot = await postRef.collection('likes').count().get();
    const likeCount = likesSnapshot.data().count;

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
