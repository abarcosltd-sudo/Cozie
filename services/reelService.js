import { FieldValue } from "firebase-admin/firestore";
import { AppError } from "../utils/AppError.js";
import { db } from "../config/firebase.js";
import { REEL_STATUS } from "../utils/collections.js";
import { reelRepository } from "../repositories/reelRepository.js";
import { musicRepository } from "../repositories/musicRepository.js";
import { userRepository } from "../repositories/userRepository.js";
import { muxService } from "./muxService.js";
import { notificationService } from "./notificationService.js";

// Mirrors the 60s cap enforced post-upload by the Mux webhook handler.
// Defined here so service-layer error messages stay consistent.
const MAX_REEL_DURATION_MS = 60_000;

function toIso(value) {
  if (!value) return new Date().toISOString();
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value === "string") return value;
  return new Date(value).toISOString();
}

function displayName(user) {
  if (!user) return "User";
  return user.fullname || user.displayName || user.username || "User";
}

/**
 * Convert a reel Firestore doc to the over-the-wire shape documented in
 * `REELS_FEATURE_SPEC.md` section 9.2. When the reel isn't ready yet,
 * the playback fields are omitted so the client can rely on `status`
 * alone to gate playback.
 */
function publicReel(reel, { author, likedByUser } = {}) {
  const base = {
    id: reel.id,
    userId: reel.userId,
    userName: author ? displayName(author) : null,
    userAvatarUrl: author?.photoURL || null,
    caption: reel.caption || "",
    songId: reel.songId || null,
    songSnapshot: reel.songSnapshot || null,
    status: reel.status,
    likeCount: reel.likeCount || 0,
    commentCount: reel.commentCount || 0,
    shareCount: reel.shareCount || 0,
    viewCount: reel.viewCount || 0,
    likedByUser: Boolean(likedByUser),
    createdAt: toIso(reel.createdAt),
  };

  if (reel.status === REEL_STATUS.READY && reel.muxPlaybackId) {
    base.playbackId = reel.muxPlaybackId;
    base.playbackUrl = `https://stream.mux.com/${reel.muxPlaybackId}.m3u8`;
    base.thumbnailUrl = reel.thumbnailUrl || null;
    base.durationMs = reel.durationMs || 0;
    base.aspectRatio = reel.aspectRatio || null;
  }

  if (reel.status === REEL_STATUS.ERRORED) {
    if (reel.errorReason) base.errorReason = reel.errorReason;
    if (reel.errorMessage) base.errorMessage = reel.errorMessage;
  }

  return base;
}

/**
 * Feed/list hydration. For a batch of reel docs, fetches author profiles
 * and the viewer's like flags in a single `db().getAll(...refs)` round
 * trip so feed responses cost O(1) Firestore RPCs regardless of page
 * size — same pattern as `musicPostService.hydrateFeedPosts`.
 */
async function hydrateReels(reels, viewerId) {
  if (reels.length === 0) return [];

  const authorIds = [...new Set(reels.map((r) => r.userId).filter(Boolean))];
  const authorRefs = authorIds.map((id) => userRepository.ref(id));
  const likeRefs = reels.map((r) =>
    reelRepository.likeRef(r.id, viewerId)
  );

  const allRefs = [...authorRefs, ...likeRefs];
  const snapshots = allRefs.length > 0 ? await db().getAll(...allRefs) : [];

  const authorMap = new Map();
  for (let i = 0; i < authorRefs.length; i++) {
    const snap = snapshots[i];
    if (snap.exists) authorMap.set(snap.id, { id: snap.id, ...snap.data() });
  }

  const likedByUser = new Map();
  for (let i = 0; i < likeRefs.length; i++) {
    const snap = snapshots[authorRefs.length + i];
    likedByUser.set(reels[i].id, Boolean(snap?.exists));
  }

  return reels.map((reel) =>
    publicReel(reel, {
      author: authorMap.get(reel.userId),
      likedByUser: likedByUser.get(reel.id),
    })
  );
}

export const reelService = {
  /**
   * Create a reel doc in `pending_upload`, request a Mux direct-upload
   * URL using the reel id as `passthrough`, and return everything the
   * client needs to PUT the bytes. The doc exists from the very first
   * call, so orphaned uploads (client closes app before PUT) are easy
   * to GC later.
   *
   * If the Mux call fails, we flip the reel to `errored` so it doesn't
   * sit in `pending_upload` forever waiting for a webhook that will
   * never arrive.
   */
  async create(userId, { caption, songId }, { corsOrigin } = {}) {
    let songSnapshot = null;
    if (songId) {
      const song = await musicRepository.findById(songId);
      if (!song) throw AppError.notFound("Song not found");
      songSnapshot = {
        title: song.title || "Untitled",
        artist: song.artist || "Unknown Artist",
        albumArtUrl: song.albumArtUrl || null,
      };
    }

    // Pre-allocate the id so we can pass it to Mux as `passthrough`
    // before persisting the doc — the webhook lookup then works the
    // very first time, no race window.
    const reelId = reelRepository.newId();
    const now = new Date();

    await reelRepository.createWithId(reelId, {
      userId,
      caption: caption || "",
      songId: songId || null,
      songSnapshot,
      visibility: "public",
      status: REEL_STATUS.PENDING_UPLOAD,
      muxUploadId: null,
      muxAssetId: null,
      muxPlaybackId: null,
      durationMs: null,
      aspectRatio: null,
      thumbnailUrl: null,
      errorReason: null,
      errorMessage: null,
      likeCount: 0,
      commentCount: 0,
      shareCount: 0,
      viewCount: 0,
      type: "reel",
      createdAt: now,
      updatedAt: now,
    });

    let upload;
    try {
      upload = await muxService.createDirectUpload({ reelId, corsOrigin });
    } catch (err) {
      await reelRepository
        .update(reelId, {
          status: REEL_STATUS.ERRORED,
          errorReason: "mux_unavailable",
          errorMessage: "Failed to initiate upload",
          updatedAt: new Date(),
        })
        .catch(() => {
          /* secondary failure: leave for orphan GC */
        });
      throw err;
    }

    await reelRepository.update(reelId, {
      muxUploadId: upload.uploadId,
      updatedAt: new Date(),
    });

    return {
      reelId,
      uploadId: upload.uploadId,
      uploadUrl: upload.uploadUrl,
      uploadExpiresAt: upload.uploadExpiresAt,
    };
  },

  /**
   * Reconcile a stuck reel against Mux's authoritative state.
   *
   * Use when the webhook pipeline didn't deliver — typically a reel that's
   * stuck in `pending_upload` or `processing` even though Mux's dashboard
   * shows the asset as `ready`. We ask Mux for the upload + asset and
   * apply the same field updates the webhook handler would have written.
   *
   * Safety / authorization:
   *   - Only the author may reconcile their own reel. Random viewers can't
   *     force-rewrite someone else's reel even if they know the id.
   *   - Reels that are already `ready` or `errored` are no-ops (we just
   *     return the current state). Mux's data is the source of truth only
   *     while the reel is still in flight.
   *   - Network calls to Mux are wrapped in try/catch — a Mux outage
   *     leaves the doc untouched rather than corrupting it.
   *
   * Returns the (possibly updated) reel doc in the public response shape.
   * The caller-facing API mirrors `get()` so the frontend can swap it in
   * without rewiring downstream code.
   */
  async reconcileFromMux(reelId, viewerId) {
    const reel = await reelRepository.findById(reelId);
    if (!reel) throw AppError.notFound("Reel not found");
    if (reel.userId !== viewerId) {
      throw AppError.forbidden("Only the author can reconcile a reel");
    }

    // Terminal states are already the source of truth; nothing to sync.
    // Returning the public shape keeps the frontend code uniform.
    if (
      reel.status === REEL_STATUS.READY ||
      reel.status === REEL_STATUS.ERRORED
    ) {
      return this.get(reelId, viewerId);
    }

    // Resolve a Mux Asset by walking whichever ids we have. The doc is
    // guaranteed to have `muxUploadId` (set at create-time); `muxAssetId`
    // only appears after `video.upload.asset_created`.
    let asset = null;
    if (reel.muxAssetId) {
      asset = await muxService.getAsset(reel.muxAssetId);
    }

    let upload = null;
    if (!asset && reel.muxUploadId) {
      upload = await muxService.getUpload(reel.muxUploadId);
      if (upload?.asset_id) {
        asset = await muxService.getAsset(upload.asset_id);
      }
    }

    // No asset yet. Look at the upload status — Mux exposes
    // `waiting | asset_created | errored | cancelled | timed_out`.
    if (!asset) {
      if (upload?.status === "cancelled") {
        await reelRepository.update(reelId, {
          status: REEL_STATUS.ERRORED,
          errorReason: "upload_cancelled",
          errorMessage: "Upload was cancelled",
          updatedAt: new Date(),
        });
        return this.get(reelId, viewerId);
      }
      if (upload?.status === "errored" || upload?.status === "timed_out") {
        await reelRepository.update(reelId, {
          status: REEL_STATUS.ERRORED,
          errorReason: "upload_errored",
          errorMessage:
            upload?.error?.message ||
            (upload?.status === "timed_out"
              ? "Upload timed out before bytes arrived"
              : "Upload failed"),
          updatedAt: new Date(),
        });
        return this.get(reelId, viewerId);
      }
      // Still waiting for Mux to ingest. Leave the doc alone; client can
      // poll again. We don't synthesize a transition that Mux hasn't
      // actually made.
      return this.get(reelId, viewerId);
    }

    // We have an asset. Patch in what we can; if it's ready, mirror the
    // webhook's handleAssetReady logic exactly.
    const muxAssetId = asset.id || reel.muxAssetId || null;

    if (asset.status === "errored") {
      await reelRepository.update(reelId, {
        muxAssetId,
        status: REEL_STATUS.ERRORED,
        errorReason: "processing_failed",
        errorMessage:
          asset.errors?.messages?.[0] || "Mux processing failed",
        updatedAt: new Date(),
      });
      return this.get(reelId, viewerId);
    }

    if (asset.status === "ready") {
      const publicPlaybackId =
        (asset.playback_ids || []).find((p) => p.policy === "public")?.id ||
        asset.playback_ids?.[0]?.id ||
        null;
      const durationMs = asset.duration
        ? Math.round(asset.duration * 1000)
        : null;

      if (!publicPlaybackId) {
        await reelRepository.update(reelId, {
          muxAssetId,
          status: REEL_STATUS.ERRORED,
          errorReason: "no_playback_id",
          errorMessage: "Asset ready without a playback id",
          updatedAt: new Date(),
        });
        return this.get(reelId, viewerId);
      }

      // Same post-upload duration enforcement the webhook handler runs.
      // Delete the asset to stop storage charges and surface the error.
      if (durationMs && durationMs > MAX_REEL_DURATION_MS) {
        if (muxAssetId) await muxService.deleteAsset(muxAssetId);
        await reelRepository.update(reelId, {
          muxAssetId,
          status: REEL_STATUS.ERRORED,
          errorReason: "exceeds_max_duration",
          errorMessage: "Reel exceeds the 60 second limit",
          durationMs,
          updatedAt: new Date(),
        });
        return this.get(reelId, viewerId);
      }

      await reelRepository.update(reelId, {
        muxAssetId,
        muxPlaybackId: publicPlaybackId,
        durationMs: durationMs || null,
        aspectRatio: asset.aspect_ratio || null,
        thumbnailUrl: `https://image.mux.com/${publicPlaybackId}/thumbnail.jpg?time=1`,
        status: REEL_STATUS.READY,
        errorReason: null,
        errorMessage: null,
        updatedAt: new Date(),
      });
      return this.get(reelId, viewerId);
    }

    // Asset exists but is still preparing — promote pending → processing
    // if we hadn't recorded the asset id yet. Frontend polling will pick
    // up the `ready` transition on the next reconcile.
    if (!reel.muxAssetId && muxAssetId) {
      await reelRepository.update(reelId, {
        muxAssetId,
        status: REEL_STATUS.PROCESSING,
        updatedAt: new Date(),
      });
    }
    return this.get(reelId, viewerId);
  },

  /**
   * Fetch a single reel. Public reels in `ready` are visible to anyone
   * authenticated. Reels in `pending_upload` / `processing` / `errored`
   * are only visible to the author so they can see their own in-flight
   * uploads (or what failed).
   */
  async get(reelId, viewerId) {
    const reel = await reelRepository.findById(reelId);
    if (!reel) throw AppError.notFound("Reel not found");

    if (reel.status !== REEL_STATUS.READY && reel.userId !== viewerId) {
      throw AppError.forbidden("Reel not available");
    }

    // Hydrate author + viewer-like in one round trip even for a single
    // reel — same shape as the feed responses keeps the client code
    // uniform.
    const [authorSnap, likeSnap] = await db().getAll(
      userRepository.ref(reel.userId),
      reelRepository.likeRef(reelId, viewerId)
    );

    return {
      reel: publicReel(reel, {
        author: authorSnap.exists
          ? { id: authorSnap.id, ...authorSnap.data() }
          : null,
        likedByUser: likeSnap?.exists,
      }),
    };
  },

  /**
   * Discover feed: every ready reel, newest first, cursor-paginated.
   */
  async listDiscover(viewerId, { cursor, limit } = {}) {
    const { items, nextCursor } = await reelRepository.listRecent({
      cursor,
      limit,
    });
    const reels = await hydrateReels(items, viewerId);
    return { reels, nextCursor, count: reels.length };
  },

  /**
   * Reels authored by `authorId`. When the viewer IS the author, the
   * list includes their in-flight (processing) and errored reels so they
   * can see what's happening with their own uploads.
   */
  async listByUser(authorId, viewerId, { cursor, limit } = {}) {
    const { items, nextCursor } = await reelRepository.listByUserId(
      authorId,
      { cursor, limit, viewerIsAuthor: viewerId === authorId }
    );
    const reels = await hydrateReels(items, viewerId);
    return { reels, nextCursor, count: reels.length };
  },

  /**
   * Personalized feed: reels from users the viewer follows, chronological
   * within that subset. Returns an empty array when the viewer follows
   * nobody so the client can route them to /discover.
   *
   * Pagination is not supported on this slice in v1 — the fan-out
   * union doesn't pair cleanly with a single cursor. /discover is the
   * paginated discovery surface; /feed returns a fixed top-N window.
   */
  async listFeed(viewerId, { limit = 50 } = {}) {
    const followingIds = await userRepository.listFollowingIds(viewerId, 200);
    if (followingIds.length === 0) {
      return { reels: [], nextCursor: null, count: 0 };
    }

    const items = await reelRepository.listRecentByUserIds(
      followingIds,
      limit
    );
    const reels = await hydrateReels(items, viewerId);
    return { reels, nextCursor: null, count: reels.length };
  },

  /**
   * Atomic reel-like toggle. Single transaction over:
   *   1. reel doc (denormalized likeCount, clamped at 0)
   *   2. reels/{reelId}/likes/{viewerId}
   *   3. users/{viewerId}/likedReels/{reelId} (reverse index)
   *
   * Mirrors `musicPostService.togglePostLike` exactly. Notification is
   * fired AFTER the tx commits so a notif blip can't roll back the like.
   */
  async toggleReelLike(reelId, user) {
    const reelRef = reelRepository.ref(reelId);
    const likeRef = reelRepository.likeRef(reelId, user.id);
    const reverseRef = userRepository.likedReelRef(user.id, reelId);

    const result = await db().runTransaction(async (tx) => {
      const [reelSnap, likeSnap] = await Promise.all([
        tx.get(reelRef),
        tx.get(likeRef),
      ]);
      if (!reelSnap.exists) throw AppError.notFound("Reel not found");

      const reel = reelSnap.data();
      const current = reel.likeCount || 0;
      const now = new Date();

      let liked;
      let newCount;
      if (likeSnap.exists) {
        tx.delete(likeRef);
        tx.delete(reverseRef);
        newCount = Math.max(0, current - 1);
        liked = false;
      } else {
        tx.set(likeRef, { userId: user.id, createdAt: now });
        tx.set(reverseRef, {
          reelId,
          authorId: reel.userId,
          songSnapshot: reel.songSnapshot || null,
          thumbnailUrl: reel.thumbnailUrl || null,
          likedAt: now,
        });
        newCount = current + 1;
        liked = true;
      }

      tx.update(reelRef, { likeCount: newCount, updatedAt: now });
      return {
        liked,
        likeCount: newCount,
        reelSnapshot: { id: reelId, ...reel },
      };
    });

    if (result.liked) {
      await notificationService.emitReelLike({
        actorUser: user,
        reel: result.reelSnapshot,
      });
    } else {
      await notificationService.withdrawReelLike({
        actorUserId: user.id,
        reel: result.reelSnapshot,
      });
    }

    return {
      liked: result.liked,
      likeCount: result.likeCount,
      message: result.liked ? "Reel liked" : "Reel unliked",
    };
  },

  async listComments(reelId, { cursor, limit } = {}) {
    const reel = await reelRepository.findById(reelId);
    if (!reel) throw AppError.notFound("Reel not found");

    const { items, nextCursor } = await reelRepository.listComments(reelId, {
      cursor,
      limit,
    });

    // Comments carry author snapshots written at post time, so the list
    // path is one query — no per-comment author lookup needed.
    const comments = items.map((c) => ({
      id: c.id,
      userId: c.userId,
      userName: c.userName || "User",
      userAvatarUrl: c.userAvatarUrl || null,
      text: c.text,
      createdAt: toIso(c.createdAt),
    }));

    return { comments, nextCursor, count: comments.length };
  },

  async addComment(reelId, userId, text) {
    const reel = await reelRepository.findById(reelId);
    if (!reel) throw AppError.notFound("Reel not found");

    const author = await userRepository.findById(userId);
    const now = new Date();
    const commentData = {
      userId,
      userName: displayName(author),
      userAvatarUrl: author?.photoURL || null,
      text,
      createdAt: now,
    };

    const { id } = await reelRepository.addComment(reelId, commentData);
    await reelRepository.update(reelId, {
      commentCount: FieldValue.increment(1),
      updatedAt: now,
    });

    await notificationService.emitReelComment({
      actorUser: author ? { id: userId, ...author } : { id: userId },
      reel,
      commentId: id,
      commentText: text,
    });

    return {
      commentId: id,
      comment: {
        id,
        userId,
        userName: commentData.userName,
        userAvatarUrl: commentData.userAvatarUrl,
        text,
        createdAt: now.toISOString(),
      },
    };
  },

  /**
   * Idempotent view registration. First view per (reel, viewer) creates
   * the view doc AND bumps the denormalized `viewCount`. Subsequent
   * calls only refresh `lastViewedAt` and bump the per-user `count` so
   * loop replays and refresh spam can't inflate the public counter.
   */
  async registerView(reelId, viewerId) {
    const reelRef = reelRepository.ref(reelId);
    const viewRef = reelRepository.viewRef(reelId, viewerId);

    return db().runTransaction(async (tx) => {
      const [reelSnap, viewSnap] = await Promise.all([
        tx.get(reelRef),
        tx.get(viewRef),
      ]);
      if (!reelSnap.exists) throw AppError.notFound("Reel not found");

      const reel = reelSnap.data();
      const now = new Date();

      if (viewSnap.exists) {
        const prior = viewSnap.data();
        tx.update(viewRef, {
          lastViewedAt: now,
          count: (prior.count || 1) + 1,
        });
        return {
          viewCount: reel.viewCount || 0,
          firstView: false,
        };
      }

      tx.set(viewRef, {
        userId: viewerId,
        firstViewedAt: now,
        lastViewedAt: now,
        count: 1,
      });
      const newCount = (reel.viewCount || 0) + 1;
      tx.update(reelRef, { viewCount: newCount, updatedAt: now });
      return { viewCount: newCount, firstView: true };
    });
  },

  /**
   * Per-share counter. Wrapped in a transaction so the returned
   * `shareCount` reflects the actual post-increment value — using
   * `FieldValue.increment(1)` plus a pre-read snapshot would race
   * under concurrent shares and return stale numbers to clients (see
   * round-5 audit). The `sharePlatforms` arrayUnion is reserved for
   * future analytics; not yet consumed by any read path.
   */
  async recordShare(reelId, _viewerId, { platforms }) {
    const reelRef = reelRepository.ref(reelId);

    return db().runTransaction(async (tx) => {
      const snap = await tx.get(reelRef);
      if (!snap.exists) throw AppError.notFound("Reel not found");

      const newCount = (snap.data().shareCount || 0) + 1;
      tx.update(reelRef, {
        shareCount: newCount,
        sharePlatforms: FieldValue.arrayUnion(...platforms),
        updatedAt: new Date(),
      });

      return { shareCount: newCount };
    });
  },
};

export const REEL_LIMITS = Object.freeze({
  MAX_DURATION_MS: MAX_REEL_DURATION_MS,
});
