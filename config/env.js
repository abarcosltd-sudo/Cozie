import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  JWT_EXPIRES_IN: z.string().default("7d"),

  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_PRIVATE_KEY_ID: z.string().min(1),
  FIREBASE_PRIVATE_KEY: z.string().min(1),
  FIREBASE_CLIENT_EMAIL: z.string().email(),
  FIREBASE_CLIENT_ID: z.string().min(1),

  FRONTEND_FIREBASE_SERVICE_ACCOUNT: z.string().optional(),
  FRONTEND_STORAGE_BUCKET: z.string().optional(),

  SENDGRID_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email().optional(),
  EMAIL_USER: z.string().optional(),

  // Google OAuth (used by /api/users/google/* routes). Optional so the
  // server still boots in environments where Google sign-in isn't enabled;
  // googleOAuthVerifier throws at request time when missing.
  // Accepts a comma-separated list to support multiple platforms (web /
  // iOS / Android) sharing the same backend.
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),

  ALLOWED_ORIGINS: z.string().optional(),

  // Mux video pipeline (reels). All optional so the server boots in
  // environments where reels aren't enabled; muxService throws at request
  // time if any are missing when actually invoked.
  MUX_TOKEN_ID: z.string().min(1).optional(),
  MUX_TOKEN_SECRET: z.string().min(1).optional(),
  MUX_WEBHOOK_SECRET: z.string().min(1).optional(),

  RATE_LIMIT_AUTH_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_API_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
  RATE_LIMIT_API_MAX: z.coerce.number().int().positive().default(300),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const flat = parsed.error.flatten().fieldErrors;
  console.error("Invalid environment variables. Please fix and retry:");
  for (const [key, messages] of Object.entries(flat)) {
    console.error(`  - ${key}: ${messages.join(", ")}`);
  }
  process.exit(1);
}

export const env = Object.freeze(parsed.data);

export const isProd = env.NODE_ENV === "production";
export const isDev = env.NODE_ENV === "development";
export const isTest = env.NODE_ENV === "test";
