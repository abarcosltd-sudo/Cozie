import { db } from "../config/firebase.js";
import {
  COLLECTIONS,
  SUBCOLLECTIONS,
  REEL_STATUS,
} from "../utils/collections.js";

/**
 * Persistence layer for reels. Mirrors `musicPostRepository` conventions:
 *   - top-level `reels` collection
 *   - `likes` / `comments` / `views` subcollections
 *   - denormalized counters maintained at the parent doc by callers
 *   - cursor-paginated list methods returning `{ items, nextCursor }`
 *
 * All read methods that hydrate feeds enforce `status == READY` so the
 * client never sees a half-processed reel. The single-doc `findById`
 * intentionally does NOT filter — the controller layer decides whether
 * the viewer is allowed to see non-ready states (author sees their own
 * processing/errored reels).
 */

const reelsCol = () => db().collection(COLLECTIONS.REELS);

export const reelRepository = {
  ref(reelId) {
    return reelsCol().doc(reelId);
  },

  async findById(reelId) {
    const doc = await reelsCol().doc(reelId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  },

  /**
   * Lookup by Mux upload id. Webhook handler falls back to this when the
   * payload's `passthrough` (which we set to the reel id) is missing on
   * older event types. Returns null if no reel matches.
   */
  async findByMuxUploadId(muxUploadId) {
    if (!muxUploadId) return null;
    const snap = await reelsCol()
      .where("muxUploadId", "==", muxUploadId)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() };
  },

  async findByMuxAssetId(muxAssetId) {
    if (!muxAssetId) return null;
    const snap = await reelsCol()
      .where("muxAssetId", "==", muxAssetId)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() };
  },

  /**
   * Pre-allocates a doc id so `reelService.create` can pass it as the
   * Mux `passthrough` BEFORE writing the doc. This avoids a "create doc
   * → read id → create Mux upload → update doc with passthrough" dance
   * where the Mux upload could land before the doc exists.
   */
  newId() {
    return reelsCol().doc().id;
  },

  /**
   * Write a reel doc with a caller-provided id (from `newId()` above) so
   * the Mux upload's passthrough can match the doc id deterministically.
   */
  async createWithId(reelId, data) {
    await reelsCol().doc(reelId).set(data);
    return { id: reelId };
  },

  async update(reelId, updates) {
    await reelsCol().doc(reelId).update(updates);
  },

  /**
   * Discover-feed query: every ready reel, newest first. Cursor is the
   * doc id of the last item returned (same shape as `listByUserId`).
   * Peeks `limit + 1` so we can populate `nextCursor` in one round trip.
   *
   * Requires a composite index on (status asc, createdAt desc) — created
   * the first time this runs in a given environment.
   */
  async listRecent({ cursor, limit = 10 } = {}) {
    let q = reelsCol()
      .where("status", "==", REEL_STATUS.READY)
      .orderBy("createdAt", "desc")
      .limit(limit + 1);

    if (cursor) {
      const cursorDoc = await reelsCol().doc(cursor).get();
      if (cursorDoc.exists) q = q.startAfter(cursorDoc);
    }

    const snap = await q.get();
    const overflow = snap.docs.length > limit;
    const docs = (overflow ? snap.docs.slice(0, limit) : snap.docs).map((d) => ({
      id: d.id,
      ...d.data(),
    }));
    const nextCursor = overflow ? docs[docs.length - 1].id : null;
    return { items: docs, nextCursor };
  },

  /**
   * Cursor-paginated list of reels by a single author. When `viewerIsAuthor`
   * is true (set by the controller), processing and errored reels are
   * included too so the author can see their own in-flight uploads.
   *
   * Requires a composite index on (userId asc, status asc, createdAt desc)
   * for the public view and (userId asc, createdAt desc) for the author
   * view.
   */
  async listByUserId(
    userId,
    { cursor, limit = 30, viewerIsAuthor = false } = {}
  ) {
    let q = reelsCol().where("userId", "==", userId);
    if (!viewerIsAuthor) {
      q = q.where("status", "==", REEL_STATUS.READY);
    }
    q = q.orderBy("createdAt", "desc").limit(limit + 1);

    if (cursor) {
      const cursorDoc = await reelsCol().doc(cursor).get();
      if (cursorDoc.exists) q = q.startAfter(cursorDoc);
    }

    const snap = await q.get();
    const overflow = snap.docs.length > limit;
    const docs = (overflow ? snap.docs.slice(0, limit) : snap.docs).map((d) => ({
      id: d.id,
      ...d.data(),
    }));
    const nextCursor = overflow ? docs[docs.length - 1].id : null;
    return { items: docs, nextCursor };
  },

  /**
   * Following-feed fan-out: query for the most-recent ready reels from a
   * set of author ids. Firestore caps `where in` at 30 values, so for
   * users following more authors we run the query in parallel chunks and
   * merge in memory. The caller is responsible for trimming the union
   * back to the requested limit.
   *
   * Mirrors `musicPostRepository.listRecentByUserIds` but with the
   * status filter added inside each chunk.
   */
  async listRecentByUserIds(userIds, limit = 50) {
    if (!userIds || userIds.length === 0) return [];
    const CHUNK = 30;
    const chunks = [];
    for (let i = 0; i < userIds.length; i += CHUNK) {
      chunks.push(userIds.slice(i, i + CHUNK));
    }

    const snaps = await Promise.all(
      chunks.map((chunk) =>
        reelsCol()
          .where("userId", "in", chunk)
          .where("status", "==", REEL_STATUS.READY)
          .orderBy("createdAt", "desc")
          .limit(limit)
          .get()
      )
    );

    const merged = snaps.flatMap((snap) =>
      snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    );

    merged.sort((a, b) => {
      const aTs =
        a.createdAt?.toDate?.()?.getTime?.() ?? new Date(a.createdAt).getTime();
      const bTs =
        b.createdAt?.toDate?.()?.getTime?.() ?? new Date(b.createdAt).getTime();
      return bTs - aTs;
    });

    return merged.slice(0, limit);
  },

  // --- Likes ---------------------------------------------------------------

  likesCol(reelId) {
    return reelsCol().doc(reelId).collection(SUBCOLLECTIONS.LIKES);
  },

  likeRef(reelId, userId) {
    return this.likesCol(reelId).doc(userId);
  },

  // --- Comments ------------------------------------------------------------

  commentsCol(reelId) {
    return reelsCol().doc(reelId).collection(SUBCOLLECTIONS.COMMENTS);
  },

  async listComments(reelId, { cursor, limit = 20 } = {}) {
    let q = this.commentsCol(reelId)
      .orderBy("createdAt", "desc")
      .limit(limit + 1);

    if (cursor) {
      const cursorDoc = await this.commentsCol(reelId).doc(cursor).get();
      if (cursorDoc.exists) q = q.startAfter(cursorDoc);
    }

    const snap = await q.get();
    const overflow = snap.docs.length > limit;
    const docs = (overflow ? snap.docs.slice(0, limit) : snap.docs).map((d) => ({
      id: d.id,
      ...d.data(),
    }));
    const nextCursor = overflow ? docs[docs.length - 1].id : null;
    return { items: docs, nextCursor };
  },

  async addComment(reelId, commentData) {
    const ref = await this.commentsCol(reelId).add(commentData);
    return { id: ref.id };
  },

  // --- Views ---------------------------------------------------------------

  viewsCol(reelId) {
    return reelsCol().doc(reelId).collection(SUBCOLLECTIONS.VIEWS);
  },

  viewRef(reelId, userId) {
    return this.viewsCol(reelId).doc(userId);
  },
};
