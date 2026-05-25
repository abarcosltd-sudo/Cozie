import { z } from "zod";

export const listNotificationsQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  unreadOnly: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "true"),
});

export const markReadBodySchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1).max(100).optional(),
    markAll: z.boolean().optional(),
  })
  .refine(
    (v) => (v.ids && v.ids.length > 0) || v.markAll === true,
    { message: "Either `ids` or `markAll: true` is required" }
  );

export const notificationIdParamSchema = z.object({
  id: z.string().min(1),
});
