import express from "express";
import { protect, loadUser } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import {
  addMusicSchema,
  searchMusicQuerySchema,
  songIdParamSchema,
} from "../validators/musicValidators.js";
import { generateUploadUrlSchema } from "../validators/userValidators.js";
import {
  generateUploadURL,
  generateAlbumArtURL,
  addMusic,
  searchMusic,
  getTrendingMusic,
  getTopCharts,
  getSongById,
} from "../controllers/musicController.js";
import {
  likeSong,
  getSongLikes,
  getSongLikeStatus,
  getUserLikedSongs,
} from "../controllers/musicLikeController.js";

const router = express.Router();

router.post(
  "/generate-upload-url",
  protect,
  validate({ body: generateUploadUrlSchema }),
  generateUploadURL
);
router.post(
  "/generate-album-art-url",
  protect,
  validate({ body: generateUploadUrlSchema }),
  generateAlbumArtURL
);
router.post("/add-music", protect, validate({ body: addMusicSchema }), addMusic);

router.get("/search", protect, validate({ query: searchMusicQuerySchema }), searchMusic);
router.get("/trending", getTrendingMusic);
router.get("/charts", getTopCharts);
router.get("/liked", protect, getUserLikedSongs);

router.get("/:songId", validate({ params: songIdParamSchema }), getSongById);
router.post(
  "/:songId/like",
  protect,
  loadUser,
  validate({ params: songIdParamSchema }),
  likeSong
);
router.get(
  "/:songId/likes",
  protect,
  validate({ params: songIdParamSchema }),
  getSongLikes
);
// Viewer-perspective like state for a single song. Lean — returns only
// `{ liked, likeCount }` so the music player can paint the heart icon
// without hydrating the full likes list.
router.get(
  "/:songId/like-status",
  protect,
  validate({ params: songIdParamSchema }),
  getSongLikeStatus
);

export default router;
