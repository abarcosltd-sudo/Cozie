import { db } from "../config/firebase.js";
import { COLLECTIONS, SUBCOLLECTIONS } from "../utils/collections.js";

const usersCol = () => db().collection(COLLECTIONS.USERS);

export const userRepository = {
  ref(id) {
    return usersCol().doc(id);
  },

  async findById(id) {
    const doc = await usersCol().doc(id).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  },

  async findByEmail(email) {
    const snap = await usersCol().where("email", "==", email).limit(1).get();
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  },

  async findByUsername(username) {
    const snap = await usersCol()
      .where("username", "==", username)
      .limit(1)
      .get();
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  },

  async create(data) {
    const ref = usersCol().doc();
    await ref.set({ id: ref.id, ...data, createdAt: new Date() });
    return { id: ref.id };
  },

  async update(id, updates) {
    await usersCol().doc(id).update({ ...updates, updatedAt: new Date() });
  },

  async setVerified(id) {
    await usersCol().doc(id).update({ isVerified: true, otp: null });
  },

  async listAll() {
    const snap = await usersCol().get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  conversationsCol(userId) {
    return usersCol()
      .doc(userId)
      .collection(SUBCOLLECTIONS.USER_CONVERSATIONS);
  },

  favoritesCol(userId) {
    return usersCol().doc(userId).collection(SUBCOLLECTIONS.FAVORITES);
  },

  likedSongsCol(userId) {
    return usersCol().doc(userId).collection(SUBCOLLECTIONS.LIKED_SONGS);
  },

  likedSongRef(userId, songId) {
    return this.likedSongsCol(userId).doc(songId);
  },

  async listLikedSongs(userId, limit = 200) {
    const snap = await this.likedSongsCol(userId)
      .orderBy("likedAt", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  // --- Follow graph ---------------------------------------------------------

  followersCol(userId) {
    return usersCol().doc(userId).collection(SUBCOLLECTIONS.FOLLOWERS);
  },

  followingCol(userId) {
    return usersCol().doc(userId).collection(SUBCOLLECTIONS.FOLLOWING);
  },

  followerRef(targetUserId, followerId) {
    return this.followersCol(targetUserId).doc(followerId);
  },

  followingRef(userId, followedId) {
    return this.followingCol(userId).doc(followedId);
  },

  async getFollowingDoc(viewerId, targetUserId) {
    const doc = await this.followingRef(viewerId, targetUserId).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  },

  /**
   * Cursor-based pagination. The cursor is the doc ID of the last item
   * returned. Peeks `limit + 1` so we can tell whether `nextCursor` exists
   * without an extra round-trip. Stale cursors fail open (return page 1).
   */
  async listFollowers(userId, { cursor, limit = 20 } = {}) {
    return paginateRelationCol(this.followersCol(userId), cursor, limit);
  },

  async listFollowing(userId, { cursor, limit = 20 } = {}) {
    return paginateRelationCol(this.followingCol(userId), cursor, limit);
  },

  async listFollowingIds(userId, limit = 200) {
    const snap = await this.followingCol(userId)
      .orderBy("followedAt", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.id);
  },

  // --- Notifications --------------------------------------------------------

  notificationsCol(userId) {
    return usersCol().doc(userId).collection(SUBCOLLECTIONS.NOTIFICATIONS);
  },

  notificationRef(userId, notificationId) {
    return this.notificationsCol(userId).doc(notificationId);
  },
};

async function paginateRelationCol(col, cursor, limit) {
  let q = col.orderBy("followedAt", "desc").limit(limit + 1);
  if (cursor) {
    const cursorDoc = await col.doc(cursor).get();
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
}
