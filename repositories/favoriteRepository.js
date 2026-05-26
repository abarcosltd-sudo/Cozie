import { userRepository } from "./userRepository.js";

export const favoriteRepository = {
  ref(userId, songId) {
    return userRepository.favoritesCol(userId).doc(songId);
  },

  async get(userId, songId) {
    const doc = await this.ref(userId, songId).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  },

  async exists(userId, songId) {
    const doc = await this.ref(userId, songId).get();
    return doc.exists;
  },

  /**
   * Create-only insert. Returns false if the favorite already existed
   * (i.e. nothing changed) and true if a new doc was created.
   * Idempotent: safe to call repeatedly without inflating counters.
   */
  async createIfMissing(userId, songId, data) {
    const ref = this.ref(userId, songId);
    return ref.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return false;
      tx.set(ref, {
        songId,
        ...data,
        addedAt: new Date(),
        updatedAt: new Date(),
      });
      return true;
    });
  },

  /**
   * Delete-only remove. Returns false if the favorite did not exist
   * (nothing changed) and true if a doc was actually deleted.
   * Pair with a counter decrement only when this returns true.
   */
  async deleteIfPresent(userId, songId) {
    const ref = this.ref(userId, songId);
    return ref.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      tx.delete(ref);
      return true;
    });
  },

  async remove(userId, songId) {
    await this.ref(userId, songId).delete();
  },

  async list(userId) {
    const snap = await userRepository
      .favoritesCol(userId)
      .orderBy("addedAt", "desc")
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },
};
