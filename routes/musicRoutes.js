// routes/musicRoutes.js
import express from "express";
import { generateUploadURL, generateAlbumArtURL, addMusic, searchMusic, getTrendingMusic, getTopCharts, getSongById } from "../controllers/musicController.js";
import { likeSong, getSongLikes, getUserLikedSongs } from '../controllers/musicLikeController.js';
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/generate-upload-url", protect, generateUploadURL);
router.post("/generate-album-art-url", protect, generateAlbumArtURL);
router.post("/add-music", protect, addMusic);
router.get("/search", protect, searchMusic);
router.get('/trending', protect, getTrendingMusic);
router.get('/charts', protect, getTopCharts);
router.post('/:songId/like', protect, likeSong);
router.get('/:songId/likes', protect, getSongLikes);
router.get('/liked', protect, getUserLikedSongs);
router.get('/:songId', protect, getSongById);

export default router;
