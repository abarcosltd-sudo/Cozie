import { db } from "../config/firebase.js";
import { COLLECTIONS, SUBCOLLECTIONS } from "../utils/collections.js";

const musicCol = () => db().collection(COLLECTIONS.MUSIC);

export const musicRepository = {
  ref(songId) {
    return musicCol().doc(songId);
  },

  async findById(songId) {
    const doc = await musicCol().doc(songId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  },

  async create(data) {
    const ref = await musicCol().add(data);
    return { id: ref.id };
  },

  async update(songId, updates) {
    await musicCol().doc(songId).update(updates);
  },

  /**
   * Case-insensitive prefix search: queries the denormalized `titleLower`
   * field that `musicService.addMusic` writes. Callers pass an already-
   * lower-cased `searchTerm`. Older docs without `titleLower` will be
   * invisible to this query and need a one-time backfill (see PROGRESS.md).
   */
  async findByTitlePrefix(searchTerm, endExclusive, limit = 20) {
    const snap = await musicCol()
      .where("titleLower", ">=", searchTerm)
      .where("titleLower", "<", endExclusive)
      .limit(limit)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  async findByArtistPrefix(searchTerm, endExclusive, limit = 20) {
    const snap = await musicCol()
      .where("artistLower", ">=", searchTerm)
      .where("artistLower", "<", endExclusive)
      .limit(limit)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  async listNewest(limit = 20) {
    const snap = await musicCol()
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  async listMostLiked(limit = 20) {
    const snap = await musicCol()
      .orderBy("likeCount", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  async listAll() {
    const snap = await musicCol().get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  likesCol(songId) {
    return musicCol().doc(songId).collection(SUBCOLLECTIONS.LIKES);
  },

  likeRef(songId, userId) {
    return this.likesCol(songId).doc(userId);
  },

  async getLikeDoc(songId, userId) {
    const doc = await this.likesCol(songId).doc(userId).get();
    return doc.exists ? { ...doc.data() } : null;
  },

  async listLikes(songId) {
    const snap = await this.likesCol(songId)
      .orderBy("createdAt", "desc")
      .get();
    return snap.docs.map((d) => ({ userId: d.id, ...d.data() }));
  },
};
