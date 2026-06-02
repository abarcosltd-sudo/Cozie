import express from "express";
import { protect, requireArtist } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import {
  artistIdParamSchema,
  bubblePostIdParamSchema,
  bubblePostsQuerySchema,
} from "../validators/bubbleValidators.js";
import {
  getMyBubble,
  getBubble,
  joinBubble,
  leaveBubble,
  getBubblePosts,
  releaseBubblePost,
} from "../controllers/bubbleController.js";

const router = express.Router();

// Artist-only: own bubble dashboard data. Returns 403 NOT_ARTIST for
// listener accounts. Mounted before the parametric routes so it isn't
// shadowed by `/:artistId`.
router.get("/my", protect, requireArtist, getMyBubble);

// Release a bubble-only post -> public + sharing-enabled. Caller must
// be an artist AND the owner of the post (ownership enforced inside
// musicPostService.releasePost).
router.post(
  "/posts/:postId/release",
  protect,
  requireArtist,
  validate({ params: bubblePostIdParamSchema }),
  releaseBubblePost
);

// Public bubble metadata + caller membership. Membership state powers
// the locked-preview vs full-profile branching on /bubble/:artistId.
router.get(
  "/:artistId",
  protect,
  validate({ params: artistIdParamSchema }),
  getBubble
);

// Open-bubble instant join / leave. Closed-bubble request approval is
// deferred to Phase 2; for MVP every bubble is open.
router.post(
  "/:artistId/join",
  protect,
  validate({ params: artistIdParamSchema }),
  joinBubble
);
router.delete(
  "/:artistId/join",
  protect,
  validate({ params: artistIdParamSchema }),
  leaveBubble
);

// Member-gated bubble post list. The service returns 403
// NOT_BUBBLE_MEMBER to non-members so the frontend can render the
// locked-preview state.
router.get(
  "/:artistId/posts",
  protect,
  validate({
    params: artistIdParamSchema,
    query: bubblePostsQuerySchema,
  }),
  getBubblePosts
);

export default router;
