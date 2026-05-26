import { z } from "zod";

export const userIdParamSchema = z.object({
  userId: z.string().min(1),
});

export const followListQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});
