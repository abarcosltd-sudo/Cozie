import { z } from "zod";

const emailField = z.string().email().transform((v) => v.toLowerCase());
const usernameField = z
  .string()
  .min(3)
  .max(30)
  .regex(/^[a-z0-9_.]+$/i, "Username may contain letters, digits, underscore or dot");

/**
 * Artist profile required at signup when `userType === "artist"`.
 * `bubbleId` is set server-side (== userId) inside `authService.signup`
 * so it is NOT accepted from the client.
 */
export const artistProfileInputSchema = z.object({
  artistName: z.string().trim().min(2).max(60),
  genres: z.array(z.string().trim().min(1).max(40)).min(1).max(5),
  label: z.string().trim().max(60).optional(),
  website: z.string().url().max(200).optional(),
  bio: z.string().max(500).optional(),
});

/**
 * Signup body. Role is chosen here and is immutable thereafter — there
 * is no upgrade endpoint in MVP. The `.superRefine` enforces the
 * userType ↔ artistProfile coupling on both sides.
 */
export const signupSchema = z
  .object({
    fullname: z.string().trim().min(1).max(100),
    username: usernameField,
    email: emailField,
    password: z.string().min(8).max(72),
    userType: z.enum(["user", "artist"]).optional().default("user"),
    artistProfile: artistProfileInputSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.userType === "artist" && !data.artistProfile) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artistProfile"],
        message: "artistProfile is required when registering as an artist",
      });
    }
    if (data.userType === "user" && data.artistProfile) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artistProfile"],
        message: "artistProfile may only be provided when userType is 'artist'",
      });
    }
  });

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1),
});

/**
 * Google sign-up body. Mirrors `signupSchema` but does NOT accept email,
 * fullname, or password — those are derived from the verified Google ID
 * token on the server. We still require `username` because Google profiles
 * don't have one, and we still enforce the `userType <-> artistProfile`
 * coupling so artists can be created in one round-trip without falling
 * back to a second "complete your profile" call.
 */
export const googleSignupSchema = z
  .object({
    idToken: z.string().min(1),
    username: usernameField,
    userType: z.enum(["user", "artist"]).optional().default("user"),
    artistProfile: artistProfileInputSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.userType === "artist" && !data.artistProfile) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artistProfile"],
        message: "artistProfile is required when registering as an artist",
      });
    }
    if (data.userType === "user" && data.artistProfile) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artistProfile"],
        message: "artistProfile may only be provided when userType is 'artist'",
      });
    }
  });

export const googleLoginSchema = z.object({
  idToken: z.string().min(1),
});

export const verifyOtpSchema = z.object({
  email: emailField,
  otp: z.string().regex(/^\d{6}$/, "OTP must be 6 digits"),
});

export const resendOtpSchema = z.object({
  email: emailField,
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
