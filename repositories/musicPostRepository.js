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
   * `listReplies`). Requires the `(parentCommentId asc, createdAt desc)`
   * composite index declared in `firestore.indexes.json`.
   *
   * Cursor + overflow pagination shape matches the reels comments
   * endpoint so the two surfaces feel identical to the client.
   */
  async listTopLevelComments(postId, { cursor, limit = 20 } = {}) {
    let q = this.commentsCol(postId)
      .where("parentCommentId", "==", null)
      .orderBy("createdAt", "desc")
      .limit(limit + 1);

    if (cursor) {
      const cursorDoc = await this.commentsCol(postId).doc(cursor).get();
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

  async listReplies(postId, parentCommentId, { cursor, limit = 20 } = {}) {
    let q = this.commentsCol(postId)
      .where("parentCommentId", "==", parentCommentId)
      .orderBy("createdAt", "desc")
      .limit(limit + 1);

    if (cursor) {
      const cursorDoc = await this.commentsCol(postId).doc(cursor).get();
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
