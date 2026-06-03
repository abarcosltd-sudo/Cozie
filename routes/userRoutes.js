import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import { authLimiter } from "../middleware/rateLimiters.js";
import {
  signupSchema,
  loginSchema,
  verifyOtpSchema,
  resendOtpSchema,
  googleSignupSchema,
  googleLoginSchema,
  preferencesSchema,
  updateProfileSchema,
  generateUploadUrlSchema,
  songIdParamSchema,
  userResourceListQuerySchema,
} from "../validators/userValidators.js";
import {
  signupUser,
  loginUser,
  getProfile,
  verifyOTP,
  resendOTP,
  signupWithGoogle,
  loginWithGoogle,
  savePreferences,
  getCurrentUser,
  updateProfile,
  generateUploadURL,
  getAvailableUsers,
  getAvailableArtists,
  getPublicProfile,
  getUserPosts,
  getUserLikedSongs,
  forgotPassword,
  resetPassword,
} from "../controllers/userController.js";
import {
  checkFavorite,
  addFavorite,
  removeFavorite,
  getFavorites,
} from "../controllers/favouritesController.js";
import {
  followUser,
  unfollowUser,
  getFollowers,
  getFollowing,
  getFollowStatus,
} from "../controllers/followController.js";
import {
  userIdParamSchema as followUserIdParamSchema,
  followListQuerySchema,
} from "../validators/followValidators.js";
import { availableArtistsQuerySchema } from "../validators/bubbleValidators.js";

const router = express.Router();

router.post("/signup", authLimiter, validate({ body: signupSchema }), signupUser);
router.post("/login", authLimiter, validate({ body: loginSchema }), loginUser);
router.post(
  "/verify-otp",
  authLimiter,
  validate({ body: verifyOtpSchema }),
  verifyOTP
);
router.post(
  "/resend-otp",
  authLimiter,
  validate({ body: resendOtpSchema }),
  resendOTP
);

// --- Google OAuth -----------------------------------------------------------
// Sit alongside `/signup` and `/login` and reuse the same rate limiter.
// New accounts created via Google bypass `/verify-otp` because Google's
// `email_verified` claim is proof of ownership; OTP routes above remain
// the only path for email+password signups.
router.post(
  "/google/signup",
  authLimiter,
  validate({ body: googleSignupSchema }),
  signupWithGoogle
);
router.post(
  "/google/login",
  authLimiter,
  validate({ body: googleLoginSchema }),
  loginWithGoogle
);

router.get("/profile", protect, getProfile);
router.get("/me", protect, getCurrentUser);
router.get("/available", protect, getAvailableUsers);
router.get(
  "/available-artists",
  protect,
  validate({ query: availableArtistsQuerySchema }),
  getAvailableArtists
);

router.post(
  "/preferences",
  protect,
  validate({ body: preferencesSchema }),
  savePreferences
);
router.put(
  "/profile",
  protect,
  validate({ body: updateProfileSchema }),
  updateProfile
);
router.post(
  "/generate-upload-url",
  protect,
  validate({ body: generateUploadUrlSchema }),
  generateUploadURL
);

router.get(
  "/favorites",
  protect,
  getFavorites
);
router.get(
  "/favorites/:songId",
  protect,
  validate({ params: songIdParamSchema }),
  checkFavorite
);
router.post(
  "/favorites/:songId",
  protect,
  validate({ params: songIdParamSchema }),
  addFavorite
);
router.delete(
  "/favorites/:songId",
  protect,
  validate({ params: songIdParamSchema }),
  removeFavorite
);

// --- Follow / social graph ------------------------------------------------
// Mounted after every literal-path route above so `/me`, `/profile`,
// `/available`, `/favorites/*` retain precedence over `/:userId/*`.

router.post(
  "/:userId/follow",
  protect,
  validate({ params: followUserIdParamSchema }),
  followUser
);
router.delete(
  "/:userId/follow",
  protect,
  validate({ params: followUserIdParamSchema }),
  unfollowUser
);
router.get(
  "/:userId/follow-status",
  protect,
  validate({ params: followUserIdParamSchema }),
  getFollowStatus
);
router.get(
  "/:userId/followers",
  protect,
  validate({
    params: followUserIdParamSchema,
    query: followListQuerySchema,
  }),
  getFollowers
);
router.get(
  "/:userId/following",
  protect,
  validate({
    params: followUserIdParamSchema,
    query: followListQuerySchema,
  }),
  getFollowing
);

// --- Public user resources -----------------------------------------------
// Profile-by-id, a user's posts, a user's liked songs. These keep the
// frontend's "view another user" surfaces functional.

router.get(
  "/:userId/profile",
  protect,
  validate({ params: followUserIdParamSchema }),
  getPublicProfile
);
router.get(
  "/:userId/posts",
  protect,
  validate({
    params: followUserIdParamSchema,
    query: userResourceListQuerySchema,
  }),
  getUserPosts
);
router.get(
  "/:userId/liked-songs",
  protect,
  validate({ params: followUserIdParamSchema }),
  getUserLikedSongs
);

// --- Password reset (BUG-006 fix) ----------------------------------------
router.post("/forgot-password", authLimiter, forgotPassword);
router.post("/reset-password", authLimiter, resetPassword);

export default router;
