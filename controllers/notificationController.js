import { asyncHandler } from "../utils/asyncHandler.js";
import { ok } from "../utils/response.js";
import { notificationService } from "../services/notificationService.js";

export const listNotifications = asyncHandler(async (req, res) => {
  const { cursor, limit, unreadOnly } = req.validatedQuery || {};
  const result = await notificationService.list(req.auth.id, {
    cursor,
    limit,
    unreadOnly,
  });
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  return ok(res, result);
});

export const getUnreadCount = asyncHandler(async (req, res) => {
  const result = await notificationService.unreadCount(req.auth.id);
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  return ok(res, result);
});

export const markRead = asyncHandler(async (req, res) => {
  const { ids, markAll } = req.body || {};
  const result = await notificationService.markRead(req.auth.id, {
    ids,
    markAll,
  });
  return ok(res, result);
});

export const dismissNotification = asyncHandler(async (req, res) => {
  const result = await notificationService.dismiss(
    req.auth.id,
    req.params.id
  );
  return ok(res, result);
});
