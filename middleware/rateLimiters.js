import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";

export const authLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_AUTH_WINDOW_MS,
  max: env.RATE_LIMIT_AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many auth attempts, please try again later" },
});

export const apiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_API_WINDOW_MS,
  max: env.RATE_LIMIT_API_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, please slow down" },
});

/**
 * Per-user rate limiter factory. Keys on `req.auth.id` when present
 * (so different users on the same IP get independent buckets — important
 * for shared NAT / mobile carriers) and falls back to `req.ip` otherwise.
 *
 * The IP fallback is only exercised in pathological cases (auth-middleware
 * misordering, dev tools hitting protected routes without a token); the
 * global `apiLimiter` provides the primary IP-based bucket for traffic
 * shaping. Per-user limits are deliberately layered ON TOP of the global
 * IP limiter, not as a replacement.
 *
 * Must be registered AFTER `protect` so `req.auth.id` is populated.
 */
function perUserLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.auth?.id || req.ip,
    message: { success: false, message },
  });
}

// Reels-specific limits — see REELS_FEATURE_SPEC.md section 9.13.
// Defaults are conservative; tune via product feedback once usage is observed.

export const reelCreateLimiter = perUserLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: "You've created too many reels recently. Please wait a bit.",
});

export const reelLikeLimiter = perUserLimiter({
  windowMs: 60_000,
  max: 60,
  message: "Slow down — too many likes in too short a time.",
});

export const reelCommentLimiter = perUserLimiter({
  windowMs: 60_000,
  max: 20,
  message: "Too many comments — give it a moment.",
});

// View pings are emitted by the client on a 3-second-watch threshold, so
// the limit is intentionally generous to accommodate fast-scrolling
// sessions and idempotent retries.
export const reelViewLimiter = perUserLimiter({
  windowMs: 60_000,
  max: 600,
  message: "Too many view pings.",
});

export const reelShareLimiter = perUserLimiter({
  windowMs: 60_000,
  max: 30,
  message: "Too many shares — try again shortly.",
});

// Reconcile-from-Mux is a backstop for stuck reels (webhook didn't deliver).
// Each call costs up to two Mux API requests, so cap it tight — the
// frontend only invokes it once per stuck reel after several polls, and
// the bulk-backfill script runs out-of-band with its own throttling.
export const reelReconcileLimiter = perUserLimiter({
  windowMs: 60_000,
  max: 20,
  message: "Too many reconcile attempts — give Mux a moment.",
});
