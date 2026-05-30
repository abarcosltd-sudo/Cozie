import { FieldValue } from "firebase-admin/firestore";
import { AppError } from "../utils/AppError.js";
import { db } from "../config/firebase.js";
import { logger } from "../utils/logger.js";
import { NOTIFICATION_TYPES } from "../utils/collections.js";
import { notificationRepository } from "../repositories/notificationRepository.js";
import { userRepository } from "../repositories/userRepository.js";

function actorDisplayName(actor) {
  if (!actor) return "Someone";
  return actor.fullname || actor.displayName || actor.username || "Someone";
}

/**
 * Stable, dedupable IDs for toggle-style events so rapid like/unlike spam
 * doesn't bloat the notification list. Comments get auto-IDs because each
 * comment is a unique event.
 */
function dedupId(type, actorId, targetId) {
  return `${type}__${actorId}__${targetId}`;
}

/**
 * Core emit primitive. Upserts a notification doc and reconciles the
 * recipient's denormalized `unreadNotificationCount` inside a single
 * Firestore transaction so the badge can never drift from the underlying
 * data.
 *
 * Behaviour:
 *   - new doc                  -> create + counter +1
 *   - existing unread doc      -> refresh updatedAt, counter unchanged (idempotent)
 *   - existing previously-read -> resurrect as unread + counter +1
 *
 * Self-emit is skipped silently (the actor and recipient are the same
 * person, e.g. liking your own post).
 */
async function emit({ recipientUserId, id, payload }) {
  if (!recipientUserId) return null;
  if (payload.actorId && payload.actorId === recipientUserId) return null;

  const ref = notificationRepository.ref(recipientUserId, id);
  const userRef = userRepository.ref(recipientUserId);

  try {
    return await db().runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      const now = new Date();
      const wasUnreadAlready = existing.exists && existing.data().read === false;

      // `createdAt` position policy:
      //   - already-unread doc (no-op re-emit): keep original timestamp
      //     so a visible notif doesn't "jump" to the top on every spam
      //     re-trigger.
      //   - brand new OR resurrected-from-read: stamp NOW. This is
      //     critical for the resurrect path — without it, the badge
      //     ticks up but the notif stays buried at its old chronological
      //     position and reads as "no new notification" to the user.
      const createdAt = wasUnreadAlready
        ? existing.data().createdAt || now
        : now;

      tx.set(ref, {
        ...payload,
        read: false,
        readAt: null,
        createdAt,
        updatedAt: now,
      });

      if (!wasUnreadAlready) {
        tx.update(userRef, {
          unreadNotificationCount: FieldValue.increment(1),
        });
      }
      return { id, created: !existing.exists };
    });
  } catch (err) {
    // Emit is best-effort: a transient Firestore blip here must not roll
    // back the originating like/follow/comment. Log and swallow.
    logger.warn(
      { err: err.message, recipientUserId, id, type: payload.type },
      "Notification emit failed"
    );
    return null;
  }
}

/**
 * Withdraw a toggle-style notification (e.g. on unlike / unfollow). Deletes
 * the doc and decrements unread counter only if the doc was still unread,
 * so undoing a like the recipient already saw doesn't make their badge go
 * negative.
 */
async function withdraw({ recipientUserId, id }) {
  if (!recipientUserId) return null;
  const ref = notificationRepository.ref(recipientUserId, id);
  const userRef = userRepository.ref(recipientUserId);

  try {
    return await db().runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (!existing.exists) return { removed: false };
      const wasUnread = existing.data().read === false;
      tx.delete(ref);
      if (wasUnread) {
        tx.update(userRef, {
          unreadNotificationCount: FieldValue.increment(-1),
        });
      }
      return { removed: true };
    });
  } catch (err) {
    logger.warn(
      { err: err.message, recipientUserId, id },
      "Notification withdraw failed"
    );
    return null;
  }
}

export const notificationService = {
  // ---- Typed emitters (keep call sites in services minimal & readable) ----

  async emitFollow({ followerUser, followedUserId }) {
    if (!followerUser?.id) return null;
    return emit({
      recipientUserId: followedUserId,
      id: dedupId(NOTIFICATION_TYPES.FOLLOW, followerUser.id, followedUserId),
      payload: {
        type: NOTIFICATION_TYPES.FOLLOW,
        actorId: followerUser.id,
        actorName: actorDisplayName(followerUser),
        actorAvatarUrl: followerUser.photoURL || null,
        targetType: "user",
        targetId: followedUserId,
      },
    });
  },

  async withdrawFollow({ followerUserId, followedUserId }) {
    return withdraw({
      recipientUserId: followedUserId,
      id: dedupId(NOTIFICATION_TYPES.FOLLOW, followerUserId, followedUserId),
    });
  },

  async emitPostLike({ actorUser, post }) {
    if (!actorUser?.id || !post?.userId) return null;
    return emit({
      recipientUserId: post.userId,
      id: dedupId(NOTIFICATION_TYPES.POST_LIKE, actorUser.id, post.id),
      payload: {
        type: NOTIFICATION_TYPES.POST_LIKE,
        actorId: actorUser.id,
        actorName: actorDisplayName(actorUser),
        actorAvatarUrl: actorUser.photoURL || null,
        targetType: "post",
        targetId: post.id,
        snapshot: {
          songTitle: post.songSnapshot?.title || null,
          albumArtUrl: post.songSnapshot?.albumArtUrl || null,
        },
      },
    });
  },

  async withdrawPostLike({ actorUserId, post }) {
    if (!post?.userId) return null;
    return withdraw({
      recipientUserId: post.userId,
      id: dedupId(NOTIFICATION_TYPES.POST_LIKE, actorUserId, post.id),
    });
  },

  async emitPostComment({ actorUser, post, commentId, commentText }) {
    if (!actorUser?.id || !post?.userId) return null;
    // Comments are unique events — auto-id, no dedup.
    return emit({
      recipientUserId: post.userId,
      id: `${NOTIFICATION_TYPES.POST_COMMENT}__${commentId}`,
      payload: {
        type: NOTIFICATION_TYPES.POST_COMMENT,
        actorId: actorUser.id,
        actorName: actorDisplayName(actorUser),
        actorAvatarUrl: actorUser.photoURL || null,
        targetType: "post",
        targetId: post.id,
        snapshot: {
          commentId,
          commentText: (commentText || "").slice(0, 240),
          songTitle: post.songSnapshot?.title || null,
        },
      },
    });
  },

  async emitSongLike({ actorUser, song }) {
    if (!actorUser?.id || !song?.userId) return null;
    return emit({
      recipientUserId: song.userId,
      id: dedupId(NOTIFICATION_TYPES.SONG_LIKE, actorUser.id, song.id),
      payload: {
        type: NOTIFICATION_TYPES.SONG_LIKE,
        actorId: actorUser.id,
        actorName: actorDisplayName(actorUser),
        actorAvatarUrl: actorUser.photoURL || null,
        targetType: "song",
        targetId: song.id,
        snapshot: {
          songTitle: song.title || null,
          songArtist: song.artist || null,
          albumArtUrl: song.albumArtUrl || null,
        },
      },
    });
  },

  async withdrawSongLike({ actorUserId, song }) {
    if (!song?.userId) return null;
    return withdraw({
      recipientUserId: song.userId,
      id: dedupId(NOTIFICATION_TYPES.SONG_LIKE, actorUserId, song.id),
    });
  },

  // --- Reel notifications --------------------------------------------------
  // Mirror the post-like / post-comment shape. Reel likes dedup on toggle so
  // rapid like/unlike doesn't bloat the inbox; reel comments are unique
  // events (one notif per comment, auto-id).

  async emitReelLike({ actorUser, reel }) {
    if (!actorUser?.id || !reel?.userId) return null;
    return emit({
      recipientUserId: reel.userId,
      id: dedupId(NOTIFICATION_TYPES.REEL_LIKE, actorUser.id, reel.id),
      payload: {
        type: NOTIFICATION_TYPES.REEL_LIKE,
        actorId: actorUser.id,
        actorName: actorDisplayName(actorUser),
        actorAvatarUrl: actorUser.photoURL || null,
        targetType: "reel",
        targetId: reel.id,
        snapshot: {
          thumbnailUrl: reel.thumbnailUrl || null,
          songTitle: reel.songSnapshot?.title || null,
        },
      },
    });
  },

  async withdrawReelLike({ actorUserId, reel }) {
    if (!reel?.userId) return null;
    return withdraw({
      recipientUserId: reel.userId,
      id: dedupId(NOTIFICATION_TYPES.REEL_LIKE, actorUserId, reel.id),
    });
  },

  async emitReelComment({ actorUser, reel, commentId, commentText }) {
    if (!actorUser?.id || !reel?.userId) return null;
    return emit({
      recipientUserId: reel.userId,
      id: `${NOTIFICATION_TYPES.REEL_COMMENT}__${commentId}`,
      payload: {
        type: NOTIFICATION_TYPES.REEL_COMMENT,
        actorId: actorUser.id,
        actorName: actorDisplayName(actorUser),
        actorAvatarUrl: actorUser.photoURL || null,
        targetType: "reel",
        targetId: reel.id,
        snapshot: {
          commentId,
          commentText: (commentText || "").slice(0, 240),
          thumbnailUrl: reel.thumbnailUrl || null,
        },
      },
    });
  },

  // --- Comment-level notifications -----------------------------------------
  // Recipients are the COMMENT author (not the post/reel author):
  //   - comment_like: notify whoever wrote the comment that someone liked it.
  //   - comment_reply: notify the comment author that someone replied to them.
  // Self-actions are skipped by the `emit` primitive (you can't notif yourself
  // for liking / replying to your own comment).
  //
  // `targetType` reflects the surface ("post" | "reel") so the existing
  // notification routing logic keeps working — extra metadata (commentId,
  // parentCommentId, replyId, etc.) lives in `snapshot`.

  async emitCommentLike({
    actorUser,
    commentAuthorId,
    surface, // "post" | "reel"
    surfaceId, // postId | reelId
    commentId,
    commentText,
  }) {
    if (!actorUser?.id || !commentAuthorId) return null;
    return emit({
      recipientUserId: commentAuthorId,
      id: dedupId(NOTIFICATION_TYPES.COMMENT_LIKE, actorUser.id, commentId),
      payload: {
        type: NOTIFICATION_TYPES.COMMENT_LIKE,
        actorId: actorUser.id,
        actorName: actorDisplayName(actorUser),
        actorAvatarUrl: actorUser.photoURL || null,
        targetType: surface,
        targetId: surfaceId,
        snapshot: {
          commentId,
          commentText: (commentText || "").slice(0, 240),
        },
      },
    });
  },

  async withdrawCommentLike({ actorUserId, commentAuthorId, commentId }) {
    if (!commentAuthorId) return null;
    return withdraw({
      recipientUserId: commentAuthorId,
      id: dedupId(NOTIFICATION_TYPES.COMMENT_LIKE, actorUserId, commentId),
    });
  },

  async emitCommentReply({
    actorUser,
    parentCommentAuthorId,
    surface, // "post" | "reel"
    surfaceId,
    parentCommentId,
    replyId,
    replyText,
  }) {
    if (!actorUser?.id || !parentCommentAuthorId) return null;
    // Each reply is a unique event; auto-id keyed on the reply doc id so
    // the recipient gets one notif per reply (matches the comment pattern).
    return emit({
      recipientUserId: parentCommentAuthorId,
      id: `${NOTIFICATION_TYPES.COMMENT_REPLY}__${replyId}`,
      payload: {
        type: NOTIFICATION_TYPES.COMMENT_REPLY,
        actorId: actorUser.id,
        actorName: actorDisplayName(actorUser),
        actorAvatarUrl: actorUser.photoURL || null,
        targetType: surface,
        targetId: surfaceId,
        snapshot: {
          parentCommentId,
          replyId,
          replyText: (replyText || "").slice(0, 240),
        },
      },
    });
  },

  // ---- Read-side ---------------------------------------------------------

  async list(userId, { cursor, limit, unreadOnly } = {}) {
    const { items, nextCursor } = await notificationRepository.list(userId, {
      cursor,
      limit,
      unreadOnly,
    });
    return {
      notifications: items.map((n) => ({
        ...n,
        createdAt: toIso(n.createdAt),
        updatedAt: toIso(n.updatedAt),
        readAt: n.readAt ? toIso(n.readAt) : null,
      })),
      nextCursor,
      count: items.length,
    };
  },

  async unreadCount(userId) {
    const user = await userRepository.findById(userId);
    if (!user) throw AppError.notFound("User not found");
    return { unreadCount: user.unreadNotificationCount || 0 };
  },

  /**
   * Mark a list of IDs (or every unread doc) as read. Counter is decremented
   * by the actual number of state transitions, so concurrent marks can't
   * push the badge negative.
   */
  async markRead(userId, { ids, markAll }) {
    if (markAll) {
      const docs = await notificationRepository.listUnreadDocs(userId);
      return markDocsRead(userId, docs);
    }
    if (!ids || ids.length === 0) {
      return { markedRead: 0, unreadCount: await readUnread(userId) };
    }
    const refs = ids.map((id) => notificationRepository.ref(userId, id));
    const snaps = await db().getAll(...refs);
    const unreadDocs = snaps.filter(
      (s) => s.exists && s.data().read === false
    );
    return markDocsRead(userId, unreadDocs);
  },

  async dismiss(userId, id) {
    const existing = await notificationRepository.get(userId, id);
    if (!existing) throw AppError.notFound("Notification not found");

    await db().runTransaction(async (tx) => {
      const snap = await tx.get(notificationRepository.ref(userId, id));
      if (!snap.exists) return;
      const wasUnread = snap.data().read === false;
      tx.delete(snap.ref);
      if (wasUnread) {
        tx.update(userRepository.ref(userId), {
          unreadNotificationCount: FieldValue.increment(-1),
        });
      }
    });
    return { dismissed: true };
  },
};

async function readUnread(userId) {
  const user = await userRepository.findById(userId);
  return user?.unreadNotificationCount || 0;
}

async function markDocsRead(userId, docs) {
  if (docs.length === 0) {
    return { markedRead: 0, unreadCount: await readUnread(userId) };
  }
  const now = new Date();
  const BATCH = 450;
  for (let i = 0; i < docs.length; i += BATCH) {
    const slice = docs.slice(i, i + BATCH);
    const batch = db().batch();
    for (const d of slice) {
      batch.update(d.ref, { read: true, readAt: now });
    }
    await batch.commit();
  }
  await userRepository
    .ref(userId)
    .update({ unreadNotificationCount: FieldValue.increment(-docs.length) });
  return {
    markedRead: docs.length,
    unreadCount: Math.max(0, (await readUnread(userId)) - 0),
  };
}

function toIso(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value === "string") return value;
  return new Date(value).toISOString();
}
