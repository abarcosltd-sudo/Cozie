// routes/userRoutes.js
import express from "express";
import { getUsers, signupUser, getProfile, loginUser } from "../controllers/usersController.js";

const router = express.Router();

router.get("/", getUsers);
router.post("/signup", signupUser);
router.post("/login", loginUser);
router.get("/profile", getProfile);

export default router;

