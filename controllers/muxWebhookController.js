import { asyncHandler } from "../utils/asyncHandler.js";
import { logger } from "../utils/logger.js";
import { muxService } from "../services/muxService.js";
import { reelRepository } from "../repositories/reelRepository.js";
import { REEL_STATUS } from "../utils/collections.js";

/**
 * Mux webhook receiver.
 *
 * The HMAC signature in `Mux-Signature` is computed over the raw request
 * bytes. The global `express.json({ verify })` middleware in `server.js`
 * captures those bytes onto `req.rawBody` before parsing so we can
 * verify here without re-stringifying.
 *
 * On signature failure we return 401 (Mux will not retry — the signature
 * is deterministic). On any other failure, including lookup misses, we
 * return 200 so Mux doesn't retry indefinitely. Misses are logged at
 * `warn` for observability (a missing reel doc usually means the reel
 * was deleted between PUT and webhook delivery — expected, not an
 * error).
 *
 * Idempotency: every handler is a Firestore patch using last-write-wins
 * semantics on the fields it owns. Re-delivery of the same event is
 * safe.
 */

const READY_THUMB_TIME_SEC = 1;

/**
 * Machine-readable error reasons surfaced on the reel doc and in the
 * public reel API response. Kept stable so the frontend can branch on
 * them without parsing English. Mirrors spec section 7.1.
 */
const ERROR_REASONS = Object.freeze({
  UPLOAD_CANCELLED: "upload_cancelled",
  UPLOAD_ERRORED: "upload_errored",
  PROCESSING_FAILED: "processing_failed",
  EXCEEDS_MAX_DURATION: "exceeds_max_duration",
  NO_PLAYBACK_ID: "no_playback_id",
});

/**
 * Resolve the reel id from the webhook payload. We set `passthrough` to
 * the reel id at upload-create time, so the primary lookup is O(1) and
 * needs no index. Fall back to muxAssetId / muxUploadId queries for
 * events that don't carry passthrough or for older docs.
 */
async function resolveReel(event) {
  const data = event.data || {};
  const passthrough =
    data.passthrough || data.new_asset_settings?.passthrough || null;

  if (passthrough) {
    const reel = await reelRepository.findById(passthrough);
    if (reel) return reel;
  }

  if (data.asset_id) {
    const reel = await reelRepository.findByMuxAssetId(data.asset_id);
    if (reel) return reel;
  }
  if (data.id && event.type?.startsWith("video.asset")) {
    const reel = await reelRepository.findByMuxAssetId(data.id);
    if (reel) return reel;
  }
  if (data.upload_id) {
    const reel = await reelRepository.findByMuxUploadId(data.upload_id);
    if (reel) return reel;
  }
  if (data.id && event.type?.startsWith("video.upload")) {
    const reel = await reelRepository.findByMuxUploadId(data.id);
    if (reel) return reel;
  }

  return null;
}

function buildThumbnailUrl(playbackId, timeSec = READY_THUMB_TIME_SEC) {
  return `https://image.mux.com/${playbackId}/thumbnail.jpg?time=${timeSec}`;
}

async function handleUploadAssetCreated(reel, event) {
  const assetId = event.data?.asset_id;
  if (!assetId) return { ignored: true, reason: "missing asset_id" };
  await reelRepository.update(reel.id, {
    muxAssetId: assetId,
    status: REEL_STATUS.PROCESSING,
    updatedAt: new Date(),
  });
  return { ok: true, transition: "processing" };
}

async function handleAssetReady(reel, event) {
  const data = event.data || {};
  const publicPlaybackId =
    (data.playback_ids || []).find((p) => p.policy === "public")?.id ||
    data.playback_ids?.[0]?.id ||
    null;
  const durationMs = data.duration ? Math.round(data.duration * 1000) : null;

  if (!publicPlaybackId) {
    await reelRepository.update(reel.id, {
      status: REEL_STATUS.ERRORED,
      errorReason: ERROR_REASONS.NO_PLAYBACK_ID,
      errorMessage: "Asset ready without a playback id",
      updatedAt: new Date(),
    });
    return { ok: true, transition: "errored", reason: ERROR_REASONS.NO_PLAYBACK_ID };
  }

  // Post-upload duration enforcement. Mux can't enforce upload-time
  // duration; we delete the asset to stop racking up storage charges
  // and surface the failure to the author.
  if (durationMs && durationMs > 60_000) {
    const assetId = reel.muxAssetId || data.id;
    if (assetId) {
      await muxService.deleteAsset(assetId);
    }
    await reelRepository.update(reel.id, {
      status: REEL_STATUS.ERRORED,
      errorReason: ERROR_REASONS.EXCEEDS_MAX_DURATION,
      errorMessage: "Reel exceeds the 60 second limit",
      durationMs,
      updatedAt: new Date(),
    });
    return {
      ok: true,
      transition: "errored",
      reason: ERROR_REASONS.EXCEEDS_MAX_DURATION,
    };
  }

  await reelRepository.update(reel.id, {
    muxPlaybackId: publicPlaybackId,
    durationMs: durationMs || null,
    aspectRatio: data.aspect_ratio || null,
    thumbnailUrl: buildThumbnailUrl(publicPlaybackId),
    status: REEL_STATUS.READY,
    errorReason: null,
    errorMessage: null,
    updatedAt: new Date(),
  });
  return { ok: true, transition: "ready" };
}

async function handleErrored(reel, event, { reason, fallbackMessage }) {
  const messages = event.data?.errors?.messages || [];
  await reelRepository.update(reel.id, {
    status: REEL_STATUS.ERRORED,
    errorReason: reason,
    errorMessage: messages[0] || fallbackMessage,
    updatedAt: new Date(),
  });
  return { ok: true, transition: "errored", reason };
}

export const handleMuxWebhook = asyncHandler(async (req, res) => {
  // Signature verification — throws AppError.unauthorized on failure,
  // which the global error handler turns into a 401 response. We use
  // req.rawBody (captured by the verify callback on express.json) so the
  // HMAC sees the exact bytes Mux signed.
  const event = muxService.unwrapWebhook(req.rawBody, req.headers);
  const requestLogger = req.log || logger;

  const reel = await resolveReel(event);
  if (!reel) {
    // Reel was deleted between upload PUT and webhook delivery, or the
    // webhook is for an unrelated asset. Acknowledge 200 so Mux stops
    // retrying.
    requestLogger.warn(
      { eventType: event.type, eventId: event.id },
      "Mux webhook for unknown reel — acknowledging"
    );
    return res.status(200).json({ success: true, ignored: true });
  }

  let result;
  switch (event.type) {
    case "video.upload.asset_created":
      result = await handleUploadAssetCreated(reel, event);
      break;

    case "video.asset.ready":
      result = await handleAssetReady(reel, event);
      break;

    case "video.asset.errored":
      result = await handleErrored(reel, event, {
        reason: ERROR_REASONS.PROCESSING_FAILED,
        fallbackMessage: "Mux processing failed",
      });
      break;

    case "video.upload.cancelled":
      result = await handleErrored(reel, event, {
        reason: ERROR_REASONS.UPLOAD_CANCELLED,
        fallbackMessage: "Upload cancelled",
      });
      break;

    case "video.upload.errored":
      result = await handleErrored(reel, event, {
        reason: ERROR_REASONS.UPLOAD_ERRORED,
        fallbackMessage: "Upload failed",
      });
      break;

    default:
      // Mux ships dozens of event types; we only react to the ones above.
      // Returning 200 prevents the retry storm.
      result = { ok: true, ignored: true };
      break;
  }

  requestLogger.info(
    { eventType: event.type, eventId: event.id, reelId: reel.id, result },
    "Mux webhook handled"
  );

  return res.status(200).json({ success: true, ...result });
});
