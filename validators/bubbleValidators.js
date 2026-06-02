import { z } from "zod";

export const artistIdParamSchema = z.object({
  artistId: z.string().min(1),
});

export const bubblePostIdParamSchema = z.object({
  postId: z.string().min(1),
});

export const bubblePostsQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export const availableArtistsQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});
