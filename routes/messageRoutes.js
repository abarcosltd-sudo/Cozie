import express from 'express';
import {
  getAvailableUsers,
  getConversations,
  getMessages,
  sendMessage,
  deleteMessage
} from '../controllers/messageController.js';

const router = express.Router();

// Conversations
router.get('/', getConversations);
router.get('/:conversationId', getMessages);
router.post('/:userId', sendMessage);
router.delete('/:messageId', deleteMessage);

export default router;
