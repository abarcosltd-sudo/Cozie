import express from "express";
import { protect, loadUser } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import {
  shareMusicSchema,
  postIdParamSchema,
  postCommentIdParamSchema,
  addCommentSchema,
  listCommentsQuerySchema,
} from "../validators/postValidators.js";
import {
  postCommentLimiter,
  commentLikeLimiter,
} from "../middleware/rateLimiters.js";
import {
  shareMusicPost,
  getMusicPosts,
  getExploreFeed,
  likePost,
  addComment,
  getComments,
  getCommentReplies,
  toggleCommentLike,
} from "../controllers/musicPostController.js";

const router = express.Router();

router.post(
  "/share-music",
  protect,
  validate({ body: shareMusicSchema }),
  shareMusicPost
);
// `/feed` is now the personalized following-filtered feed.
// `/explore` keeps the prior chronological-all behaviour for discovery.
router.get("/feed", protect, getMusicPosts);
router.get("/explore", protect, getExploreFeed);
router.post(
  "/:postId/like",
  protect,
  loadUser,
  validate({ params: postIdParamSchema }),
  likePost
);
router.get(
  "/:postId/comments",
  protect,
  validate({
    params: postIdParamSchema,
    query: listCommentsQuerySchema,
  }),
  getComments
);
router.post(
  "/:postId/comments",
  protect,
  postCommentLimiter,
  validate({ params: postIdParamSchema, body: addCommentSchema }),
  addComment
);
// Replies under a single top-level comment. Same hydration / page shape
// as the parent endpoint so the client renderer is uniform.
router.get(
  "/:postId/comments/:commentId/replies",
  protect,
  validate({
    params: postCommentIdParamSchema,
    query: listCommentsQuerySchema,
  }),
  getCommentReplies
);
// Toggle a like on a single comment. `loadUser` provides the
// denormalized actor profile that the notification fan-out needs.
router.post(
  "/:postId/comments/:commentId/like",
  protect,
  loadUser,
  commentLikeLimiter,
  validate({ params: postCommentIdParamSchema }),
  toggleCommentLike
);

export default router;
