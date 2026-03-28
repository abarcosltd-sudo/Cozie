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

// -------------------------------------------------------------------
// 1. Generate signed URL for audio file upload
// -------------------------------------------------------------------
export const generateUploadURL = async (req, res) => {
  await runMiddleware(req, res, cors);

  // Authenticate
  const user = await authenticate(req, res);
  if (!user) return; // response already sent

  try {
    const { fileName, fileType } = req.body;
    if (!fileName || !fileType) {
      return res.status(400).json({ success: false, message: "fileName and fileType are required" });
    }

    // Validate file type (optional – restrict to audio)
    if (!fileType.startsWith("audio/")) {
      return res.status(400).json({ success: false, message: "Only audio files are allowed" });
    }

    // Sanitize filename and create unique path
    const safeName = fileName.replace(/[^a-zA-Z0-9.]/g, "_");
    const timestamp = Date.now();
    const uniqueId = uuidv4().split("-")[0];
    const blobPath = `music/${user.id}/${timestamp}_${uniqueId}_${safeName}`;
    const file = frontendBucket.file(blobPath);

    const options = {
      version: "v4",
      action: "write",
      expires: Date.now() + 30 * 60 * 1000, // 30 minutes
      contentType: fileType,
    };

    const [signedUrl] = await file.getSignedUrl(options);
    const publicUrl = `https://storage.googleapis.com/${frontendBucket.name}/${blobPath}`;

    return res.status(200).json({
      success: true,
      signedUrl,
      publicUrl,
    });
  } catch (error) {
    console.error("Error generating audio upload URL:", error);
    return res.status(500).json({ success: false, message: "Failed to generate upload URL" });
  }
};

// -------------------------------------------------------------------
// 2. Generate signed URL for album art upload
// -------------------------------------------------------------------
export const generateAlbumArtURL = async (req, res) => {
  await runMiddleware(req, res, cors);

  const user = await authenticate(req, res);
  if (!user) return;

  try {
    const { fileName, fileType } = req.body;
    if (!fileName || !fileType) {
      return res.status(400).json({ success: false, message: "fileName and fileType are required" });
    }

    // Optional: restrict to images
    if (!fileType.startsWith("image/")) {
      return res.status(400).json({ success: false, message: "Only image files are allowed for album art" });
    }

    const safeName = fileName.replace(/[^a-zA-Z0-9.]/g, "_");
    const timestamp = Date.now();
    const uniqueId = uuidv4().split("-")[0];
    const blobPath = `album-art/${user.id}/${timestamp}_${uniqueId}_${safeName}`;
    const file = frontendBucket.file(blobPath);

    const options = {
      version: "v4",
      action: "write",
      expires: Date.now() + 30 * 60 * 1000, // 30 minutes
      contentType: fileType,
    };

    const [signedUrl] = await file.getSignedUrl(options);
    const publicUrl = `https://storage.googleapis.com/${frontendBucket.name}/${blobPath}`;

    return res.status(200).json({
      success: true,
      signedUrl,
      publicUrl,
    });
  } catch (error) {
    console.error("Error generating album art URL:", error);
    return res.status(500).json({ success: false, message: "Failed to generate upload URL" });
  }
};

// -------------------------------------------------------------------
// 3. Save music metadata to Firestore
// -------------------------------------------------------------------
export const addMusic = async (req, res) => {
  await runMiddleware(req, res, cors);

  const user = await authenticate(req, res);
  if (!user) return;

  try {
    const {
      fileUrl,
      albumArtUrl = null,
      title,
      artist,
      featuredArtists = "",
      album,
      genre = null,
      subgenre = "",
      mood = "",
      producer = "",
      songwriter = "",
      composer = "",
      recordLabel = "",
      releaseDate = "",
      releaseYear = "",
      country = "",
      language = "",
      duration = "",
      bpm = "",
      musicalKey = "",
      isrc = "",
      explicit = "",
      copyright = "",
      publishingRights = "",
      originalWork = false,
      description = "",
      lyrics = "",
      tags = "",
      favoriteCount = 0,
      likeCount = 0
    } = req.body;

    // Basic validation
    if (!fileUrl || !title || !artist || !album) {
      return res.status(400).json({ success: false, message: "Missing required fields: fileUrl, title, artist, album" });
    }

    // Create music document in Firestore (using your Music model or direct collection)
    const musicData = {
      userId: user.id,
      fileUrl,
      albumArtUrl,
      title,
      artist,
      featuredArtists,
      album,
      genre,
      subgenre,
      mood,
      producer,
      songwriter,
      composer,
      recordLabel,
      releaseDate,
      releaseYear,
      country,
      language,
      duration,
      bpm,
      musicalKey,
      isrc,
      explicit,
      copyright,
      publishingRights,
      originalWork,
      description,
      lyrics,
      tags,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const docRef = await db.collection("music").add(musicData);

    return res.status(201).json({
      success: true,
      message: "Music added successfully",
      musicId: docRef.id,
    });
  } catch (error) {
    console.error("Error saving music metadata:", error);
    return res.status(500).json({ success: false, message: "Failed to save music metadata" });
  }
};


// -------------------------------------------------------------------
// 4. Search music metadata to Firestore
// -------------------------------------------------------------------
export const searchMusic = async (req, res) => {
  await runMiddleware(req, res, cors);

  // Authenticate user (optional – you can remove if public search is desired)
  const user = await authenticate(req, res);
  if (!user) return;

  try {
    const query = req.query.q;
    if (!query || query.trim() === '') {
      return res.status(200).json({ songs: [] });
    }

    const searchTerm = query.trim();
    // Create upper bound for prefix search (Firestore trick)
    const end = searchTerm.replace(/.$/, c => String.fromCharCode(c.charCodeAt(0) + 1));

    // Search by title
    const titleQuery = db
      .collection('music')
      .where('title', '>=', searchTerm)
      .where('title', '<', end)
      .limit(20);

    // Search by artist
    const artistQuery = db
      .collection('music')
      .where('artist', '>=', searchTerm)
      .where('artist', '<', end)
      .limit(20);

    // Execute both queries in parallel
    const [titleSnapshot, artistSnapshot] = await Promise.all([
      titleQuery.get(),
      artistQuery.get(),
    ]);

    // Merge results, using a Map to deduplicate by document ID
    const songsMap = new Map();

    titleSnapshot.docs.forEach(doc => {
      songsMap.set(doc.id, { id: doc.id, ...doc.data() });
    });

    artistSnapshot.docs.forEach(doc => {
      if (!songsMap.has(doc.id)) {
        songsMap.set(doc.id, { id: doc.id, ...doc.data() });
      }
    });

    // Convert map values to array and format response
    const songs = Array.from(songsMap.values()).map(doc => ({
      id: doc.id,
      title: doc.title || '',
      artist: doc.artist || '',
      albumArtUrl: doc.albumArtUrl || null, // if stored
    }));

    return res.status(200).json({ songs });
  } catch (error) {
    console.error('Error searching music:', error);
    return res.status(500).json({ success: false, message: 'Search failed' });
  }
};

//======================================================
// GET – new releases (most recent)
//======================================================
// In your music controller (controllers/musicController.js)
export const getTrendingMusic = async (req, res, next) => {
  await runMiddleware(req, res, cors);

  try {
    const snapshot = await db.collection('music')
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();

    const trending = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        title: data.title || 'Untitled',
        artist: data.artist || 'Unknown Artist',
        albumArtUrl: data.albumArtUrl || null,
        fileUrl: data.fileUrl || null, 
        duration: data.duration || 0,   
        genre: data.genre || null,     
        releaseYear: data.releaseYear || null, 
        likeCount: data.likeCount || 0,  
        favoriteCount: data.favoriteCount || 0 
      };
    });

    res.json({ success: true, trending });
  } catch (error) {
    console.error('Error fetching trending music:', error);
    next(error);
  }
};

//=======================================================================
// GET most liked (requires likeCount field on music)
//=======================================================================
export const getTopCharts = async (req, res, next) => {
  await runMiddleware(req, res, cors);

  try {
    const snapshot = await db.collection('music')
      .orderBy('likeCount', 'desc')
      .limit(10)
      .get();

    const charts = snapshot.docs.map((doc, index) => {
      const data = doc.data();
      return {
        id: doc.id,
        number: index + 1,
        title: data.title || 'Untitled',
        artist: data.artist || 'Unknown Artist',
        albumArtUrl: data.albumArtUrl || null,
        fileUrl: data.fileUrl || null,  
        duration: data.duration || 0,
        genre: data.genre || null,
        releaseYear: data.releaseYear || null,
        likeCount: data.likeCount || 0
      };
    });

    res.json({ success: true, charts });
  } catch (error) {
    console.error('Error fetching top charts:', error);
    next(error);
  }
};

//=========================================
// get song by ID
//=========================================
export const getSongById = async (req, res, next) => {
  await runMiddleware(req, res, cors);
  try {
    const { songId } = req.params;
    
    if (!songId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Song ID is required' 
      });
    }
    
    // Fetch song from Firestore
    const songDoc = await db.collection('music').doc(songId).get();
    
    if (!songDoc.exists) {
      return res.status(404).json({ 
        success: false, 
        message: 'Song not found' 
      });
    }
    
    const songData = songDoc.data();
    
    // Get user info if you want to include uploader details
    let uploaderName = 'Unknown Artist';
    let uploaderAvatar = null;
    
    if (songData.userId) {
      const userDoc = await db.collection('users').doc(songData.userId).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        uploaderName = userData.fullname || userData.displayName || userData.username || 'Unknown Artist';
        uploaderAvatar = userData.photoURL || null;
      }
    }
    
    // Get like count (if not already stored)
    const likesSnapshot = await db
      .collection('music')
      .doc(songId)
      .collection('likes')
      .count()
      .get();
    const likeCount = likesSnapshot.data().count;
    
    // Check if current user has liked this song
    let likedByUser = false;
    if (req.user && req.user.id) {
      const userLikeDoc = await db
        .collection('music')
        .doc(songId)
        .collection('likes')
        .doc(req.user.id)
        .get();
      likedByUser = userLikeDoc.exists;
    }
    
    // Format response
    const song = {
      id: songDoc.id,
      title: songData.title || 'Untitled',
      artist: songData.artist || 'Unknown Artist',
      albumArtUrl: songData.albumArtUrl || null,
      fileUrl: songData.fileUrl || null,
      duration: songData.duration || 0,
      genre: songData.genre || null,
      releaseYear: songData.releaseYear || null,
      language: songData.language || null,
      mood: songData.mood || null,
      bpm: songData.bpm || null,
      musicalKey: songData.musicalKey || null,
      description: songData.description || '',
      lyrics: songData.lyrics || '',
      uploaderId: songData.userId || null,
      uploaderName: uploaderName,
      uploaderAvatar: uploaderAvatar,
      likeCount: likeCount,
      likedByUser: likedByUser,
      createdAt: songData.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
    };
    
    return res.status(200).json({
      success: true,
      song
    });
    
  } catch (error) {
    console.error('Error fetching song by ID:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch song',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
