// routes/postRoutes.js
import express from "express";
import { shareMusicPost } from "../controllers/musicPostController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/share-music", protect, shareMusicPost);

export default router;
