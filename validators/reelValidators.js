import { z } from "zod";

/**
 * Reel creation. The client supplies metadata only — the actual video
 * bytes, duration, dimensions and thumbnail are populated by Mux and
 * arrive via webhook. Keep this minimal; growing it adds attack
 * surface without adding value.
 */
export const createReelSchema = z.object({
  caption: z.string().max(2000).optional().default(""),
  songId: z.string().min(1).nullable().optional(),
});

export const reelIdParamSchema = z.object({
  reelId: z.string().min(1),
});

export const userIdParamSchema = z.object({
  userId: z.string().min(1),
});

/**
 * Shared cursor-pagination shape for `/discover`, `/feed`, `/user/:userId`
 * and `/:reelId/comments`. Limit defaults are intentionally small for the
 * vertical feed (10) and slightly larger for comments (20) and profile
 * grids (30). Max is capped to prevent expensive scans.
 */
export const listReelsQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(30).optional().default(10),
});

export const listUserReelsQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(30),
});

export const listCommentsQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export const addCommentSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  /** When set, this comment is a reply attached to `parentCommentId`.
   *  Replies are flat — the service re-parents replies-of-replies up to
   *  the top-level comment, so callers don't need to worry about depth. */
  parentCommentId: z.string().min(1).nullable().optional(),
});

export const reelCommentIdParamSchema = z.object({
  reelId: z.string().min(1),
  commentId: z.string().min(1),
});

export const shareReelSchema = z.object({
  platforms: z.array(z.string().min(1).max(64)).min(1).max(10),
});
