import Mux from "@mux/mux-node";
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import { logger } from "../utils/logger.js";

/**
 * Thin wrapper around the Mux Node SDK.
 *
 * Everything that talks to Mux goes through this module. The rest of the
 * codebase never imports `@mux/mux-node` directly — that way a future
 * provider swap (Cloudflare Stream, bunny.net, in-house pipeline) lands as
 * a one-file change instead of a refactor.
 *
 * Credentials (`MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_WEBHOOK_SECRET`) are
 * declared optional in `config/env.js` so the server can boot in
 * environments where reels aren't enabled. The client is constructed
 * lazily on first use; if creds are missing we throw a 500 instead of
 * crashing at import time.
 */

let cachedClient = null;

// Mux direct-upload URLs are valid for this many seconds before Mux
// rejects the PUT. We surface the absolute expiry to clients via the
// create-reel response so they know how long they have to upload.
const UPLOAD_TTL_SEC = 3600;

function getClient() {
  if (cachedClient) return cachedClient;

  if (!env.MUX_TOKEN_ID || !env.MUX_TOKEN_SECRET) {
    throw AppError.internal(
      "Mux credentials missing — set MUX_TOKEN_ID and MUX_TOKEN_SECRET to enable reels"
    );
  }

  cachedClient = new Mux({
    tokenId: env.MUX_TOKEN_ID,
    tokenSecret: env.MUX_TOKEN_SECRET,
    // Passing the webhook secret here lets `webhooks.unwrap()` work without
    // a third argument. We still pass it explicitly at call sites for
    // clarity.
    webhookSecret: env.MUX_WEBHOOK_SECRET || undefined,
  });

  return cachedClient;
}

export const muxService = {
  /**
   * Create a one-time signed PUT URL that the client uses to upload the
   * raw video bytes directly to Mux. The `passthrough` field is the
   * reel's Firestore id; we read it back from every related webhook to
   * resolve the event to the right reel doc without an index query.
   *
   * `cors_origin` restricts which web origins are allowed to PUT to the
   * URL — Mux enforces this at the edge. Pass the calling site's origin
   * (e.g. https://app.cozie.com); fall back to "*" only in dev.
   *
   * Returns the SDK's Upload object's `id` (uploadId) and `url`
   * (the signed PUT URL).
   */
  async createDirectUpload({ reelId, corsOrigin }) {
    if (!reelId) {
      throw AppError.internal("reelId is required for createDirectUpload");
    }

    try {
      const upload = await getClient().video.uploads.create({
        cors_origin: corsOrigin || "*",
        new_asset_settings: {
          playback_policy: ["public"],
          passthrough: reelId,
          video_quality: "basic",
          max_resolution_tier: "1080p",
        },
        // Client has 1 hour to complete the PUT before the URL expires.
        timeout: UPLOAD_TTL_SEC,
      });

      return {
        uploadId: upload.id,
        uploadUrl: upload.url,
        uploadExpiresAt: new Date(
          Date.now() + UPLOAD_TTL_SEC * 1000
        ).toISOString(),
      };
    } catch (err) {
      logger.error(
        { err: err.message, reelId },
        "Mux createDirectUpload failed"
      );
      throw AppError.internal(
        "Failed to initiate video upload — please try again"
      );
    }
  },

  /**
   * Verify the `Mux-Signature` HMAC and parse the webhook payload in one
   * call. Throws on bad signature, malformed body, or stale timestamp.
   *
   * IMPORTANT: `body` must be the raw request body (string or Buffer
   * stringified) — express.raw() captures this. Do not parse the JSON
   * before calling this; the signature is computed over the raw bytes.
   */
  unwrapWebhook(rawBody, headers) {
    if (!env.MUX_WEBHOOK_SECRET) {
      throw AppError.internal(
        "MUX_WEBHOOK_SECRET not configured — webhook verification disabled"
      );
    }

    const bodyString =
      typeof rawBody === "string" ? rawBody : rawBody?.toString?.("utf8");

    if (!bodyString) {
      throw AppError.badRequest("Empty webhook body");
    }

    try {
      return getClient().webhooks.unwrap(
        bodyString,
        headers,
        env.MUX_WEBHOOK_SECRET
      );
    } catch (err) {
      // SDK throws a generic Error on signature failure. Map to a 401 so
      // the route returns the right status to Mux (Mux retries non-2xx
      // for transient errors but a 401 signals "don't bother retrying").
      throw AppError.unauthorized(
        `Invalid Mux webhook signature: ${err.message}`
      );
    }
  },

  /**
   * Hard-delete an asset on Mux. Used when:
   *   - the over-duration enforcement path rejects a clip
   *   - (future) the author deletes their own reel
   *
   * Idempotent at the API level: deleting an already-deleted asset
   * returns 404 from Mux, which we swallow.
   */
  async deleteAsset(assetId) {
    if (!assetId) return;
    try {
      await getClient().video.assets.delete(assetId);
    } catch (err) {
      // 404 means it's already gone — that's fine for idempotency.
      // Other failures get logged but not re-thrown; webhook callers
      // should not be blocked on cleanup.
      if (err?.status === 404) return;
      logger.warn(
        { err: err.message, assetId },
        "Mux deleteAsset failed (non-fatal)"
      );
    }
  },
};
