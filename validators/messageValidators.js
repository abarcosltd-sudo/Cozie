import { z } from "zod";

export const conversationIdParamSchema = z.object({
  conversationId: z.string().min(1),
});

export const recipientUserIdParamSchema = z.object({
  userId: z.string().min(1),
});

export const messageIdParamSchema = z.object({
  messageId: z.string().min(1),
});

export const sendMessageSchema = z
  .object({
    text: z.string().trim().max(5000).optional(),
    isMusic: z.boolean().optional(),
    musicTitle: z.string().max(200).nullable().optional(),
    musicArtist: z.string().max(200).nullable().optional(),
    musicUrl: z.string().url().nullable().optional(),
  })
  .refine(
    (v) => (v.text && v.text.length > 0) || v.isMusic === true,
    { message: "Message text or music is required" }
  );

export const deleteMessageBodySchema = z.object({
  conversationId: z.string().min(1),
});
