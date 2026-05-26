import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import {
  listNotifications,
  getUnreadCount,
  markRead,
  dismissNotification,
} from "../controllers/notificationController.js";
import {
  listNotificationsQuerySchema,
  markReadBodySchema,
  notificationIdParamSchema,
} from "../validators/notificationValidators.js";

const router = express.Router();

router.get(
  "/",
  protect,
  validate({ query: listNotificationsQuerySchema }),
  listNotifications
);
router.get("/unread-count", protect, getUnreadCount);
router.post(
  "/mark-read",
  protect,
  validate({ body: markReadBodySchema }),
  markRead
);
router.delete(
  "/:id",
  protect,
  validate({ params: notificationIdParamSchema }),
  dismissNotification
);

export default router;
