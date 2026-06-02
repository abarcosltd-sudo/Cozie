import { asyncHandler } from "../utils/asyncHandler.js";
import { ok } from "../utils/response.js";
import { authService } from "../services/authService.js";
import { userService } from "../services/userService.js";
import { uploadService } from "../services/uploadService.js";
import { musicPostService } from "../services/musicPostService.js";
import { musicService } from "../services/musicService.js";

export const signupUser = asyncHandler(async (req, res) => {
  const result = await authService.signup(req.body);
  return ok(res, result);
});

export const loginUser = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body);
  return ok(res, result);
});

export const verifyOTP = asyncHandler(async (req, res) => {
  const result = await authService.verifyOtp(req.body);
  return ok(res, result);
});

export const getProfile = asyncHandler(async (req, res) => {
  const user = await userService.getProfile(req.auth.id);
  return ok(res, { user });
});

export const getCurrentUser = asyncHandler(async (req, res) => {
  const user = await userService.getCurrentUser(req.auth.id);
  return ok(res, { user });
});

export const savePreferences = asyncHandler(async (req, res) => {
  await userService.savePreferences(req.auth.id, req.body.genres);
  return ok(res, { message: "Preferences saved successfully" });
});

export const updateProfile = asyncHandler(async (req, res) => {
  await userService.updateProfile(req.auth.id, req.body);
  return ok(res, { message: "Profile updated successfully" });
});

export const generateUploadURL = asyncHandler(async (req, res) => {
  const result = await uploadService.createProfilePhotoUploadUrl({
    userId: req.auth.id,
    fileName: req.body.fileName,
    fileType: req.body.fileType,
  });
  return ok(res, result);
});

export const getAvailableUsers = asyncHandler(async (req, res) => {
  const users = await userService.listAvailable(req.auth.id);
  return ok(res, { users, count: users.length });
});

/**
 * Artist directory for the Discover → Bubbles tab. Cursor-paginated.
 */
export const getAvailableArtists = asyncHandler(async (req, res) => {
  const { cursor, limit } = req.validatedQuery || {};
  const result = await userService.listAvailableArtists(req.auth.id, {
    cursor,
    limit,
  });
  return ok(res, result);
});

/**
 * Public-by-id profile lookup. Returns the same shape as `/profile`
 * (self) for any user the viewer is allowed to see. Frontend hits this
 * for every user-detail page; before this route existed it 404'd.
 */
export const getPublicProfile = asyncHandler(async (req, res) => {
  const user = await userService.getProfile(req.params.userId);
  return ok(res, { user });
});

/**
 * Posts authored by `:userId`. Backs the profile "Posts" tab. Pagination
 * is cursor-based to match followers/following.
 */
export const getUserPosts = asyncHandler(async (req, res) => {
  const { cursor, limit } = req.validatedQuery ?? {};
  const result = await musicPostService.listByUser(
    req.params.userId,
    req.auth.id,
    { cursor, limit }
  );
  return ok(res, result);
});

/**
 * Liked songs for `:userId`. Service method is already viewer-agnostic
 * because it reads from the canonical `users/{userId}/likedSongs`
 * subcollection. Frontend reuses this for both the self-profile "Liked"
 * tab and other-user profiles.
 */
export const getUserLikedSongs = asyncHandler(async (req, res) => {
  const result = await musicService.listUserLikedSongs(req.params.userId);
  return ok(res, result);
});
