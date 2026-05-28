import { asyncHandler } from "../utils/asyncHandler.js";
import { ok, created } from "../utils/response.js";
import { reelService } from "../services/reelService.js";

/**
 * Reel controllers. Thin glue between routes (auth + zod validation
 * upstream) and `reelService`. No business logic lives here — same
 * convention as `musicPostController.js`.
 */

// Browser cache headers for the feed/list responses. Reels are highly
// dynamic (counters bump every few seconds) so we want fresh reads.
function noStore(res) {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

export const createReel = asyncHandler(async (req, res) => {
  const result = await reelService.create(req.auth.id, req.body, {
    corsOrigin: req.headers.origin,
  });
  return created(res, { message: "Reel created — please upload the video", ...result });
});

export const getReel = asyncHandler(async (req, res) => {
  const result = await reelService.get(req.params.reelId, req.auth.id);
  return ok(res, result);
});

export const getDiscover = asyncHandler(async (req, res) => {
  const result = await reelService.listDiscover(req.auth.id, {
    cursor: req.validatedQuery?.cursor,
    limit: req.validatedQuery?.limit,
  });
  noStore(res);
  return ok(res, result);
});

export const getFeed = asyncHandler(async (req, res) => {
  const result = await reelService.listFeed(req.auth.id, {
    limit: req.validatedQuery?.limit,
  });
  noStore(res);
  return ok(res, result);
});

export const getByUser = asyncHandler(async (req, res) => {
  const result = await reelService.listByUser(
    req.params.userId,
    req.auth.id,
    {
      cursor: req.validatedQuery?.cursor,
      limit: req.validatedQuery?.limit,
    }
  );
  noStore(res);
  return ok(res, result);
});

export const likeReel = asyncHandler(async (req, res) => {
  const result = await reelService.toggleReelLike(
    req.params.reelId,
    req.user
  );
  return ok(res, result);
});

export const getComments = asyncHandler(async (req, res) => {
  const result = await reelService.listComments(req.params.reelId, {
    cursor: req.validatedQuery?.cursor,
    limit: req.validatedQuery?.limit,
  });
  return ok(res, result);
});

export const addReelComment = asyncHandler(async (req, res) => {
  const result = await reelService.addComment(
    req.params.reelId,
    req.auth.id,
    req.body.text
  );
  return created(res, result);
});

export const registerView = asyncHandler(async (req, res) => {
  const result = await reelService.registerView(
    req.params.reelId,
    req.auth.id
  );
  return ok(res, result);
});

export const shareReel = asyncHandler(async (req, res) => {
  const result = await reelService.recordShare(
    req.params.reelId,
    req.auth.id,
    { platforms: req.body.platforms }
  );
  return ok(res, result);
});
