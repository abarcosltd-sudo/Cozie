// routes/postRoutes.js
import express from "express";
import { shareMusicPost, getMusicPosts, likePost, addComment, getComments } from "../controllers/musicPostController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/share-music", protect, shareMusicPost);
router.get("/feed", getMusicPosts);
router.post("/:postId/like", protect, likePost);
router.get('/:postId/comments', protect, getComments);
router.post('/:postId/comments', protect, addComment);

export default router;
