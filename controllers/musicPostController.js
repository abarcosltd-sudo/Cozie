import { asyncHandler } from "../utils/asyncHandler.js";
import { ok, created } from "../utils/response.js";
import { musicPostService } from "../services/musicPostService.js";

export const shareMusicPost = asyncHandler(async (req, res) => {
  const result = await musicPostService.shareMusic(req.auth.id, req.body);
  return created(res, { message: "Music shared successfully", ...result });
});

export const getMusicPosts = asyncHandler(async (req, res) => {
  const result = await musicPostService.listFeed(req.auth.id);
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  return ok(res, result);
});

export const getExploreFeed = asyncHandler(async (req, res) => {
  const result = await musicPostService.listExploreFeed(req.auth.id);
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  return ok(res, result);
});

export const likePost = asyncHandler(async (req, res) => {
  const result = await musicPostService.togglePostLike(
    req.params.postId,
    req.user
  );
  return ok(res, result);
});

export const getComments = asyncHandler(async (req, res) => {
  const result = await musicPostService.listComments(req.params.postId);
  return ok(res, result);
});

export const addComment = asyncHandler(async (req, res) => {
  const result = await musicPostService.addComment(
    req.params.postId,
    req.auth.id,
    req.body.text
  );
  return created(res, result);
});
