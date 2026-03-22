// routes/userRoutes.js
import express from "express";
import { signupUser, getProfile, loginUser, verifyOTP, savePreferences, getCurrentUser, updateProfile, generateUploadURL } from "../controllers/userController.js";
import { getAvailableUsers } from "../controllers/messageController.js";
import { checkFavorite, addFavorite, removeFavorite, getFavorites } from '../controllers/favouritesController.js';
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/signup", signupUser);
router.post("/login", loginUser);
router.get("/profile", getProfile);
router.post("/verify-otp", verifyOTP);
router.get('/available', protect, getAvailableUsers);
router.post("/preferences", protect, savePreferences);
router.get("/me", protect, getCurrentUser);
router.put("/profile", protect, updateProfile); 
router.post("/generate-upload-url", protect, generateUploadURL)
router.get('/favorites', protect, getFavorites);
router.get('/favorites/:songId', protect, checkFavorite);
router.post('/favorites/:songId', protect, addFavorite);
router.delete('/favorites/:songId', protect, removeFavorite);

export default router;












