import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import {
  conversationIdParamSchema,
  recipientUserIdParamSchema,
  messageIdParamSchema,
  sendMessageSchema,
  deleteMessageBodySchema,
} from "../validators/messageValidators.js";
import {
  getConversations,
  getMessages,
  sendMessage,
  deleteMessage,
} from "../controllers/messageController.js";

const router = express.Router();

router.get("/conversations", protect, getConversations);
router.get(
  "/:conversationId",
  protect,
  validate({ params: conversationIdParamSchema }),
  getMessages
);
router.post(
  "/:userId",
  protect,
  validate({ params: recipientUserIdParamSchema, body: sendMessageSchema }),
  sendMessage
);
router.delete(
  "/:messageId",
  protect,
  validate({ params: messageIdParamSchema, body: deleteMessageBodySchema }),
  deleteMessage
);

export default router;
