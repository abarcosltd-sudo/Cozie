import express from "express";
import { protect, loadUser } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import {
  shareMusicSchema,
  postIdParamSchema,
  addCommentSchema,
} from "../validators/postValidators.js";
import {
  shareMusicPost,
  getMusicPosts,
  getExploreFeed,
  likePost,
  addComment,
  getComments,
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
  validate({ params: postIdParamSchema }),
  getComments
);
router.post(
  "/:postId/comments",
  protect,
  validate({ params: postIdParamSchema, body: addCommentSchema }),
  addComment
);

export default router;
