import { z } from "zod";

const emailField = z.string().email().transform((v) => v.toLowerCase());
const usernameField = z
  .string()
  .min(3)
  .max(30)
  .regex(/^[a-z0-9_.]+$/i, "Username may contain letters, digits, underscore or dot");

export const signupSchema = z.object({
  fullname: z.string().trim().min(1).max(100),
  username: usernameField,
  email: emailField,
  password: z.string().min(8).max(72),
});

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1),
});

export const verifyOtpSchema = z.object({
  email: emailField,
  otp: z.string().regex(/^\d{6}$/, "OTP must be 6 digits"),
});

export const preferencesSchema = z.object({
  genres: z.array(z.string().trim().min(1)).min(1),
});

export const updateProfileSchema = z
  .object({
    displayName: z.string().trim().max(100).optional(),
    username: usernameField.optional(),
    bio: z.string().max(500).optional(),
    photoURL: z.string().url().nullable().optional(),
    removePhoto: z.boolean().optional(),
  })
  .refine(
    (v) => Object.keys(v).length > 0,
    { message: "No fields provided to update" }
  );

export const generateUploadUrlSchema = z.object({
  fileName: z.string().min(1).max(255),
  fileType: z.string().min(1).max(100),
});

export const songIdParamSchema = z.object({
  songId: z.string().min(1),
});

// Shared cursor-pagination query shape for `:userId/posts`, `:userId/liked-songs`,
// etc. Matches the followers/following pagination shape so frontend pagination
// helpers stay uniform.
export const userResourceListQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
});
