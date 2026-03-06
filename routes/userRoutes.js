// routes/userRoutes.js
import express from "express";
import { signupUser, getProfile, loginUser, verifyOTP, savePreferences } from "../controllers/userController.js";

const router = express.Router();

router.post("/signup", signupUser);
router.post("/login", loginUser);
router.get("/profile", getProfile);
router.post("/verify-otp", verifyOTP);
router.post("/preferences", savePrefences);

export default router;





