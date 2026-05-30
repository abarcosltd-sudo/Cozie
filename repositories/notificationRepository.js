import { userRepository } from "./userRepository.js";

export const notificationRepository = {
  ref(userId, notificationId) {
    return userRepository.notificationRef(userId, notificationId);
  },

  col(userId) {
    return userRepository.notificationsCol(userId);
  },

  async get(userId, notificationId) {
    const doc = await this.ref(userId, notificationId).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  },

  /**
   * Cursor-paginated list, newest first. Same shape as the follow lists:
   * peeks one extra doc to compute `nextCursor`, silent-fallback on stale
   * cursors.
   */
  async list(userId, { cursor, limit = 20, unreadOnly = false } = {}) {
    let q = this.col(userId).orderBy("createdAt", "desc");
    if (unreadOnly) q = q.where("read", "==", false);
    q = q.limit(limit + 1);

    if (cursor) {
      const cursorDoc = await this.ref(userId, cursor).get();
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
   * Page over every unread doc — used by `markAll`. Caller is responsible
   * for batching the actual updates (Firestore limits 500 writes per batch).
   *
   * IMPORTANT: we deliberately don't `orderBy("createdAt")` here. That
   * combined with the `where("read","==",false)` filter would need a
   * composite `(read asc, createdAt desc)` index on the `notifications`
   * subcollection — which isn't declared in `firestore.indexes.json`
   * (and adding it would make `firebase deploy --only firestore:indexes`
   * a hard prereq for "Mark all as read" to work). For markAll we don't
   * care about order at all — we just want every unread doc. Firestore
   * falls back to `__name__` order when no explicit orderBy is given,
   * and `startAfter(docSnap)` walks that order using the auto-built
   * single-field index for `read`.
   */
  async listUnreadDocs(userId, pageSize = 400) {
    const out = [];
    let last = null;
    while (true) {
      let q = this.col(userId)
        .where("read", "==", false)
        .limit(pageSize);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      if (snap.empty) break;
      out.push(...snap.docs);
      if (snap.docs.length < pageSize) break;
      last = snap.docs[snap.docs.length - 1];
    }
    return out;
  },
};
