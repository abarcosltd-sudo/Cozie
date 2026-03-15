// routes/musicRoutes.js
import express from "express";
import { generateUploadURL, generateAlbumArtURL, addMusic } from "../controllers/musicController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/generate-upload-url", generateUploadURL);
router.post("/generate-album-art-url", generateAlbumArtURL);
router.post("/add-music", addMusic);

export default router;
