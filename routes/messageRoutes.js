import express from 'express';
import {
  getConversations,
  getMessages,
  sendMessage,
  deleteMessage
} from '../controllers/messageController.js';

const router = express.Router();

// Conversations
router.get('/conversations', getConversations);
router.get('/:conversationId', getMessages);
router.post('/:userId', sendMessage);
router.delete('/:messageId', deleteMessage);

export default router;
