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

// Reel deletion is destructive and irreversible (also incurs Mux API
// + Firestore batch traffic per call). The intentional UI is a single
// per-reel button so legitimate usage is very low — cap tight so a
// compromised token or runaway script can't wipe an entire library.
export const reelDeleteLimiter = perUserLimiter({
  windowMs: 60_000,
  max: 10,
  message: "Too many deletions — slow down.",
});

// Comment-level interactions (likes + replies). Liking a comment is a
// toggle, so the limiter mostly catches abuse — legitimate users won't
// hit this. Replies share the same rate budget as adding a top-level
// comment (`reelCommentLimiter` / via service path for posts), so this
// dedicated limiter is just for like toggles.
export const commentLikeLimiter = perUserLimiter({
  windowMs: 60_000,
  max: 60,
  message: "Slow down — too many comment likes in too short a time.",
});

// Music posts previously had no per-user comment limiter (only the
// global apiLimiter). Add one matching `reelCommentLimiter` so the two
// surfaces have parity now that replies multiply comment write volume.
export const postCommentLimiter = perUserLimiter({
  windowMs: 60_000,
  max: 20,
  message: "Too many comments — give it a moment.",
});
