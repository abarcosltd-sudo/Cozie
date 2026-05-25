import { asyncHandler } from "../utils/asyncHandler.js";
import { ok, created } from "../utils/response.js";
import { followService } from "../services/followService.js";

export const followUser = asyncHandler(async (req, res) => {
  const result = await followService.follow(req.auth.id, req.params.userId);
  if (result.status === "created") {
    return created(res, {
      following: result.following,
      followerCount: result.followerCount,
      message: "Now following",
    });
  }
  return ok(res, {
    following: result.following,
    alreadyFollowing: true,
    followerCount: result.followerCount,
    message: "Already following",
  });
});

export const unfollowUser = asyncHandler(async (req, res) => {
  const result = await followService.unfollow(req.auth.id, req.params.userId);
  return ok(res, {
    following: result.following,
    ...(result.alreadyAbsent ? { alreadyAbsent: true } : {}),
    followerCount: result.followerCount,
    message: result.alreadyAbsent ? "Was not following" : "Unfollowed",
  });
});

export const getFollowers = asyncHandler(async (req, res) => {
  const { cursor, limit } = req.validatedQuery ?? {};
  const result = await followService.listFollowers(req.params.userId, {
    cursor,
    limit,
  });
  return ok(res, result);
});

export const getFollowing = asyncHandler(async (req, res) => {
  const { cursor, limit } = req.validatedQuery ?? {};
  const result = await followService.listFollowing(req.params.userId, {
    cursor,
    limit,
  });
  return ok(res, result);
});

export const getFollowStatus = asyncHandler(async (req, res) => {
  const result = await followService.status(req.auth.id, req.params.userId);
  return ok(res, result);
});
