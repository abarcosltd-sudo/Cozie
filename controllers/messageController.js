import { asyncHandler } from "../utils/asyncHandler.js";
import { ok, created } from "../utils/response.js";
import { messageService } from "../services/messageService.js";
import { userService } from "../services/userService.js";

export const getConversations = asyncHandler(async (req, res) => {
  const result = await messageService.listConversations(req.auth.id);
  return ok(res, result);
});

export const getMessages = asyncHandler(async (req, res) => {
  const result = await messageService.listMessages(
    req.params.conversationId,
    req.auth.id
  );
  return ok(res, result);
});

export const sendMessage = asyncHandler(async (req, res) => {
  const result = await messageService.sendMessage({
    senderId: req.auth.id,
    recipientId: req.params.userId,
    ...req.body,
  });
  return created(res, result);
});

export const deleteMessage = asyncHandler(async (req, res) => {
  const result = await messageService.deleteMessage({
    conversationId: req.body.conversationId,
    messageId: req.params.messageId,
    userId: req.auth.id,
  });
  return ok(res, result);
});

export const getAvailableUsers = asyncHandler(async (req, res) => {
  const users = await userService.listAvailable(req.auth.id);
  return ok(res, { users, count: users.length });
});
