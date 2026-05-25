import { asyncHandler } from "../utils/asyncHandler.js";
import { ok } from "../utils/response.js";
import { musicService } from "../services/musicService.js";

export const likeSong = asyncHandler(async (req, res) => {
  const result = await musicService.toggleSongLike(req.params.songId, req.user);
  return ok(res, { ...result, message: result.liked ? "Song liked" : "Song unliked" });
});

export const getSongLikes = asyncHandler(async (req, res) => {
  const result = await musicService.listSongLikes(req.params.songId, req.auth.id);
  return ok(res, result);
});

export const getUserLikedSongs = asyncHandler(async (req, res) => {
  const result = await musicService.listUserLikedSongs(req.auth.id);
  return ok(res, result);
});
