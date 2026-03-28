// routes/musicRoutes.js
import express from "express";
import { generateUploadURL, generateAlbumArtURL, addMusic, searchMusic, getTrendingMusic, getTopCharts } from "../controllers/musicController.js";
import { likeSong, getSongLikes, getUserLikedSongs } from '../controllers/musicLikeController.js';
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/generate-upload-url", generateUploadURL);
router.post("/generate-album-art-url", generateAlbumArtURL);
router.post("/add-music", addMusic);
router.get("/search", searchMusic);
router.get('/trending', getTrendingMusic);
router.get('/charts', getTopCharts);
router.post('/:songId/like', likeSong);
router.get('/:songId/likes', getSongLikes);
router.get('/liked', getUserLikedSongs);
router.get('/:songId', protect, getSongById);

export default router;
