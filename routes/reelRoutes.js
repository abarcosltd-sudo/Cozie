import express from "express";
import { protect, loadUser } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import {
  reelCreateLimiter,
  reelLikeLimiter,
  reelCommentLimiter,
  reelViewLimiter,
  reelShareLimiter,
  reelReconcileLimiter,
  reelDeleteLimiter,
  commentLikeLimiter,
} from "../middleware/rateLimiters.js";
import {
  createReelSchema,
  reelIdParamSchema,
  reelCommentIdParamSchema,
  userIdParamSchema,
  listReelsQuerySchema,
  listUserReelsQuerySchema,
  listCommentsQuerySchema,
  addCommentSchema,
  shareReelSchema,
} from "../validators/reelValidators.js";
import {
  createReel,
  getReel,
  getDiscover,
  getFeed,
  getByUser,
  likeReel,
  getComments,
  getReelCommentReplies,
  addReelComment,
  toggleReelCommentLike,
  registerView,
  shareReel,
  reconcileReel,
  deleteReel,
} from "../controllers/reelController.js";
import { handleMuxWebhook } from "../controllers/muxWebhookController.js";

const router = express.Router();

/* -------------------------------------------------------------------------
 * Mux webhook
 *
 * No auth middleware — the HMAC signature in `Mux-Signature` IS the auth.
 * The signature is computed over the raw request bytes, which the global
 * `express.json({ verify })` setup in `server.js` captures onto
 * `req.rawBody` before parsing. The webhook controller reads from there
 * for verification, then operates on the parsed `event` returned by
 * `mux.webhooks.unwrap`.
 *
 * Path mounts to `/api/reels/webhooks/mux`.
 * ----------------------------------------------------------------------- */
router.post("/webhooks/mux", handleMuxWebhook);

/* -------------------------------------------------------------------------
 * Authoring + read paths
 * ----------------------------------------------------------------------- */

router.post(
  "/",
  protect,
  reelCreateLimiter,
  validate({ body: createReelSchema }),
  createReel
);

router.get(
  "/discover",
  protect,
  validate({ query: listReelsQuerySchema }),
  getDiscover
);

router.get(
  "/feed",
  protect,
  validate({ query: listReelsQuerySchema }),
  getFeed
);

router.get(
  "/user/:userId",
  protect,
  validate({ params: userIdParamSchema, query: listUserReelsQuerySchema }),
  getByUser
);

/* -------------------------------------------------------------------------
 * Per-reel actions
 *
 * NOTE: order matters with /:reelId — declare the specific subpaths first
 * (none here are ambiguous since they're all /:reelId/<verb>, but listing
 * the get-single route AFTER subpaths is the conventional ordering).
 * ----------------------------------------------------------------------- */

router.post(
  "/:reelId/like",
  protect,
  reelLikeLimiter,
  loadUser,
  validate({ params: reelIdParamSchema }),
  likeReel
);

router.get(
  "/:reelId/comments",
  protect,
  validate({ params: reelIdParamSchema, query: listCommentsQuerySchema }),
  getComments
);

router.post(
  "/:reelId/comments",
  protect,
  reelCommentLimiter,
  validate({ params: reelIdParamSchema, body: addCommentSchema }),
  addReelComment
);

// Replies under a single top-level reel comment.
router.get(
  "/:reelId/comments/:commentId/replies",
  protect,
  validate({
    params: reelCommentIdParamSchema,
    query: listCommentsQuerySchema,
  }),
  getReelCommentReplies
);

// Toggle a like on a reel comment. `loadUser` provides the denormalized
// actor profile that the comment-like notification fan-out needs.
router.post(
  "/:reelId/comments/:commentId/like",
  protect,
  loadUser,
  commentLikeLimiter,
  validate({ params: reelCommentIdParamSchema }),
  toggleReelCommentLike
);

router.post(
  "/:reelId/view",
  protect,
  reelViewLimiter,
  validate({ params: reelIdParamSchema }),
  registerView
);

router.post(
  "/:reelId/share",
  protect,
  reelShareLimiter,
  validate({ params: reelIdParamSchema, body: shareReelSchema }),
  shareReel
);

/* Reconcile from Mux — backstop for stuck reels when the webhook didn't
 * deliver. Author-only (enforced in the service); rate-limited because
 * each call costs Mux API quota. */
router.post(
  "/:reelId/reconcile",
  protect,
  reelReconcileLimiter,
  validate({ params: reelIdParamSchema }),
  reconcileReel
);

router.get(
  "/:reelId",
  protect,
  validate({ params: reelIdParamSchema }),
  getReel
);

/* Destructive: author-only delete. Service enforces ownership and
 * orchestrates Mux + Firestore cleanup. Tight per-user rate limit so a
 * compromised token can't wipe a library. */
router.delete(
  "/:reelId",
  protect,
  reelDeleteLimiter,
  validate({ params: reelIdParamSchema }),
  deleteReel
);

export default router;
