import { asyncHandler } from "../utils/asyncHandler.js";
import { ok } from "../utils/response.js";
import { bubbleService } from "../services/bubbleService.js";
import { musicPostService } from "../services/musicPostService.js";

export const getMyBubble = asyncHandler(async (req, res) => {
  const result = await bubbleService.getMyBubble(req.user);
  return ok(res, result);
});

export const getBubble = asyncHandler(async (req, res) => {
  const result = await bubbleService.getBubble(
    req.params.artistId,
    req.auth.id
  );
  return ok(res, result);
});

export const joinBubble = asyncHandler(async (req, res) => {
  const result = await bubbleService.joinBubble(
    req.params.artistId,
    req.auth.id
  );
  return ok(res, result);
});

export const leaveBubble = asyncHandler(async (req, res) => {
  const result = await bubbleService.leaveBubble(
    req.params.artistId,
    req.auth.id
  );
  return ok(res, result);
});

export const getBubblePosts = asyncHandler(async (req, res) => {
  const { cursor, limit } = req.validatedQuery || {};
  const result = await bubbleService.listBubblePosts(
    req.params.artistId,
    req.auth.id,
    { cursor, limit }
  );
  return ok(res, result);
});

export const releaseBubblePost = asyncHandler(async (req, res) => {
  const result = await musicPostService.releasePost(
    req.params.postId,
    req.auth.id
  );
  return ok(res, result);
});
