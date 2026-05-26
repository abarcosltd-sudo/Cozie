import { asyncHandler } from "../utils/asyncHandler.js";
import { ok } from "../utils/response.js";
import { favoriteService } from "../services/favoriteService.js";

export const checkFavorite = asyncHandler(async (req, res) => {
  const result = await favoriteService.check(req.auth.id, req.params.songId);
  return ok(res, result);
});

export const addFavorite = asyncHandler(async (req, res) => {
  const result = await favoriteService.add(req.auth.id, req.params.songId, req.body);
  return ok(res, { message: "Song added to favorites", ...result });
});

export const removeFavorite = asyncHandler(async (req, res) => {
  const result = await favoriteService.remove(req.auth.id, req.params.songId);
  return ok(res, { message: "Song removed from favorites", ...result });
});

export const getFavorites = asyncHandler(async (req, res) => {
  const result = await favoriteService.list(req.auth.id);
  return ok(res, result);
});
