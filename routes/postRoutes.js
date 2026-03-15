// routes/postRoutes.js
import express from "express";
import { shareMusicPost, getMusicPosts, likePost, addComment } from "../controllers/musicPostController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/share-music", protect, shareMusicPost);
router.get("/feed", getMusicPosts);
router.post("/:postId/like", likePost);
router.post("/:postId/comments", addComment);

export default router;
