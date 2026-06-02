import { db } from "../config/firebase.js";
import { COLLECTIONS, SUBCOLLECTIONS } from "../utils/collections.js";

const postsCol = () => db().collection(COLLECTIONS.MUSIC_POSTS);

export const musicPostRepository = {
  ref(postId) {
    return postsCol().doc(postId);
  },

  async findById(postId) {
    const doc = await postsCol().doc(postId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  },

  async create(data) {
    const ref = await postsCol().add(data);
    return { id: ref.id };
  },

  async update(postId, updates) {
    await postsCol().doc(postId).update({ ...updates, updatedAt: new Date() });
  },

  async listRecent(limit = 50) {
    const snap = await postsCol()
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  /**
   * Cursor-paginated list of posts authored by `userId`, newest first.
   * Uses the doc id of the last item returned as the cursor — same shape
   * the follow endpoints expose so frontend pagination code stays uniform.
   */
  async listByUserId(userId, { cursor, limit = 30 } = {}) {
    let q = postsCol()
      .where("userId", "==", userId)
      .orderBy("createdAt", "desc")
      .limit(limit + 1);
    if (cursor) {
      const cursorDoc = await postsCol().doc(cursor).get();
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
   * Cursor-paginated bubble posts (every post belonging to a given
   * artist's bubble, both unreleased and released, newest first). Used
   * by /api/bubbles/:artistId/posts for the bubble profile view.
   *
   * We filter by `bubbleId == artistId` rather than `userId == artistId`
   * because a post is bubble-only only when it has an explicit bubbleId.
   * Released posts also retain their bubbleId so the bubble profile
   * keeps showing the artist's history.
   */
  async listBubblePosts(artistId, { cursor, limit = 20 } = {}) {
    let q = postsCol()
      .where("bubbleId", "==", artistId)
      .orderBy("createdAt", "desc")
      .limit(limit + 1);
    if (cursor) {
      const cursorDoc = await postsCol().doc(cursor).get();
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
   * Fan-out query for the personalized feed. Firestore caps `where in` at
   * 30 values, so for users following more authors we run the query in
   * parallel chunks and merge. The caller is responsible for trimming the
   * union back to the requested limit.
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
        postsCol()
          .where("userId", "in", chunk)
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

  likesCol(postId) {
    return postsCol().doc(postId).collection(SUBCOLLECTIONS.LIKES);
  },

  likeRef(postId, userId) {
    return this.likesCol(postId).doc(userId);
  },

  commentsCol(postId) {
    return postsCol().doc(postId).collection(SUBCOLLECTIONS.COMMENTS);
  },

  async getLikeDoc(postId, userId) {
    const doc = await this.likesCol(postId).doc(userId).get();
    return doc.exists ? { ...doc.data() } : null;
  },

  async countLikes(postId) {
    const snap = await this.likesCol(postId).count().get();
    return snap.data().count;
  },

  async countComments(postId) {
    const snap = await this.commentsCol(postId).count().get();
    return snap.data().count;
  },

  /**
   * Top-level comments only (replies are returned separately by
   * `listReplies`).
   *
   * Important: we *don't* push the `parentCommentId == null` predicate
   * down to Firestore, even though we have an index for it. Two reasons:
   *   1. Firestore's `== null` does NOT match docs where the field is
   *      missing, so any comment written before this feature shipped
   *      would silently disappear from the list.
   *   2. Avoiding the composite index makes the API work without a
   *      `firebase deploy --only firestore:indexes` step.
   *
   * Instead we paginate over the raw `orderBy createdAt desc` stream
   * (auto-indexed) and filter in-app. We over-fetch (`limit * RAW_FACTOR`)
   * so a single page typically lands enough top-level docs to satisfy
   * the request; `nextCursor` is the last RAW doc we scanned so the
   * caller can keep walking even if all of this page was replies.
   */
  async listTopLevelComments(postId, { cursor, limit = 20 } = {}) {
    const RAW_FACTOR = 3;
    const rawLimit = limit * RAW_FACTOR;

    let q = this.commentsCol(postId)
      .orderBy("createdAt", "desc")
      .limit(rawLimit + 1);

    if (cursor) {
      const cursorDoc = await this.commentsCol(postId).doc(cursor).get();
      if (cursorDoc.exists) q = q.startAfter(cursorDoc);
    }

    const snap = await q.get();
    const overflow = snap.docs.length > rawLimit;
    const rawDocs = overflow ? snap.docs.slice(0, rawLimit) : snap.docs;

    const filtered = rawDocs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((c) => !c.parentCommentId)
      .slice(0, limit);

    const nextCursor = overflow ? rawDocs[rawDocs.length - 1].id : null;
    return { items: filtered, nextCursor };
  },

  /**
   * Replies under a single top-level comment. Same app-level filter
   * approach as `listTopLevelComments` — see that jsdoc for the
   * rationale around skipping the Firestore predicate.
   */
  async listReplies(postId, parentCommentId, { cursor, limit = 20 } = {}) {
    const RAW_FACTOR = 3;
    const rawLimit = limit * RAW_FACTOR;

    let q = this.commentsCol(postId)
      .orderBy("createdAt", "desc")
      .limit(rawLimit + 1);

    if (cursor) {
      const cursorDoc = await this.commentsCol(postId).doc(cursor).get();
      if (cursorDoc.exists) q = q.startAfter(cursorDoc);
    }

    const snap = await q.get();
    const overflow = snap.docs.length > rawLimit;
    const rawDocs = overflow ? snap.docs.slice(0, rawLimit) : snap.docs;

    const filtered = rawDocs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((c) => c.parentCommentId === parentCommentId)
      .slice(0, limit);

    const nextCursor = overflow ? rawDocs[rawDocs.length - 1].id : null;
    return { items: filtered, nextCursor };
  },

  commentRef(postId, commentId) {
    return this.commentsCol(postId).doc(commentId);
  },

  async findCommentById(postId, commentId) {
    const doc = await this.commentRef(postId, commentId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  },

  commentLikesCol(postId, commentId) {
    return this.commentRef(postId, commentId).collection(SUBCOLLECTIONS.LIKES);
  },

  commentLikeRef(postId, commentId, userId) {
    return this.commentLikesCol(postId, commentId).doc(userId);
  },

  async addComment(postId, commentData) {
    const ref = await this.commentsCol(postId).add(commentData);
    return { id: ref.id };
  },
};
