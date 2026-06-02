import { db } from "../config/firebase.js";
import { COLLECTIONS, SUBCOLLECTIONS } from "../utils/collections.js";

const bubblesCol = () => db().collection(COLLECTIONS.BUBBLES);

export const bubbleRepository = {
  // Doc id == artistId by invariant. One bubble per artist; lookups by
  // artistId are direct doc reads.
  ref(bubbleId) {
    return bubblesCol().doc(bubbleId);
  },

  async findById(bubbleId) {
    const doc = await bubblesCol().doc(bubbleId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  },

  membersCol(bubbleId) {
    return bubblesCol().doc(bubbleId).collection(SUBCOLLECTIONS.MEMBERS);
  },

  memberRef(bubbleId, userId) {
    return this.membersCol(bubbleId).doc(userId);
  },

  async getMemberDoc(bubbleId, userId) {
    const doc = await this.memberRef(bubbleId, userId).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  },

  /**
   * Cursor-paginated member list, newest joined first. Cursor is the
   * member's userId (which is also the doc id), mirroring the
   * followers/following pagination pattern in userRepository.
   */
  async listMembers(bubbleId, { cursor, limit = 30 } = {}) {
    const col = this.membersCol(bubbleId);
    let q = col.orderBy("joinedAt", "desc").limit(limit + 1);
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
  },

  /**
   * Caller-perspective set lookup. Used by feed hydration to decide
   * which bubble posts the viewer can see in O(N) round-trips for N
   * bubbles. Skips the chunked-`in` query because there's no
   * doc-id-based equivalent on subcollections.
   */
  async getMembershipStatuses(bubbleIds, userId) {
    if (!bubbleIds || bubbleIds.length === 0 || !userId) {
      return new Map();
    }
    const unique = Array.from(new Set(bubbleIds));
    const refs = unique.map((bid) => this.memberRef(bid, userId));
    const snaps = await db().getAll(...refs);
    const out = new Map();
    snaps.forEach((snap, i) => {
      out.set(unique[i], snap.exists);
    });
    return out;
  },
};
