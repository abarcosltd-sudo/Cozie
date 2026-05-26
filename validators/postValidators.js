import { z } from "zod";

export const shareMusicSchema = z.object({
  songId: z.string().min(1),
  caption: z.string().max(2000).optional().default(""),
  platforms: z.array(z.string().min(1)).min(1),
});

export const postIdParamSchema = z.object({
  postId: z.string().min(1),
});

export const addCommentSchema = z.object({
  text: z.string().trim().min(1).max(1000),
});
