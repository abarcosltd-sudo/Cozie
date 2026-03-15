// routes/postRoutes.js
import express from "express";
import { shareMusic } from "../controllers/musicPostController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/share-music", shareMusic);

export default router;
