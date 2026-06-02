import { FieldValue } from "firebase-admin/firestore";
import { AppError } from "../utils/AppError.js";
import { db } from "../config/firebase.js";
import { bubbleRepository } from "../repositories/bubbleRepository.js";
import { userRepository } from "../repositories/userRepository.js";
import { musicPostRepository } from "../repositories/musicPostRepository.js";
import { musicPostService } from "./musicPostService.js";
import { USER_TYPES } from "../utils/collections.js";

function toIso(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value === "string") return value;
  return new Date(value).toISOString();
}

/**
 * Shape we return from `/api/bubbles/:artistId` and similar discovery
 * surfaces. Kept deliberately small — feed/post hydration uses its own
 * `bubbleInfo` projection on each post.
 */
function publicBubble(bubble) {
  if (!bubble) return null;
  return {
    id: bubble.id,
    artistId: bubble.artistId,
    artistName: bubble.artistName || "",
    isOpen: bubble.isOpen !== false,
    memberCount: bubble.memberCount || 0,
    postCount: bubble.postCount || 0,
    createdAt: toIso(bubble.createdAt),
  };
}

export const bubbleService = {
  /**
   * Build the write objects for a new artist's bubble. Returned from a
   * pure function so `authService.signup` can stage the bubble write
   * inside the same Firestore transaction that creates the user doc —
   * we never want a half-registered artist with no bubble.
   *
   * Doc id == userId; this is the 1:1 invariant. `bubbleId` on the
   * user's `artistProfile` is therefore always equal to `userId`.
   */
  buildArtistBubbleDoc({ userId, artistName, now = new Date() }) {
    return {
      id: userId,
      artistId: userId,
      artistName,
      isOpen: true, // MVP: every bubble is open. Closed/request-to-join is Phase 2.
      memberCount: 0,
      postCount: 0,
      createdAt: now,
      updatedAt: now,
    };
  },

  /**
   * Caller is an artist; return their own bubble. Throws if the caller
   * is not an artist or — defensively — if the bubble doc somehow went
   * missing. The latter would indicate a broken signup transaction.
   */
  async getMyBubble(user) {
    if (!user || user.userType !== USER_TYPES.ARTIST) {
      throw AppError.forbidden("Only artists have a bubble");
    }
    const bubble = await bubbleRepository.findById(user.id);
    if (!bubble) {
      throw AppError.notFound("Bubble not found");
    }
    return { bubble: publicBubble(bubble) };
  },

  /**
   * Public bubble fetch. Returns the bubble + caller's membership state.
   * Used by both non-members (renders locked preview) and members
   * (renders full profile) — the caller branches on `userMembership`.
   */
  async getBubble(artistId, viewerId) {
    const [bubble, memberDoc, viewerUser] = await Promise.all([
      bubbleRepository.findById(artistId),
      viewerId ? bubbleRepository.getMemberDoc(artistId, viewerId) : null,
      viewerId ? userRepository.findById(viewerId) : null,
    ]);

    if (!bubble) {
      throw AppError.notFound("Bubble not found");
    }

    const isOwner = viewerId && viewerId === artistId;
    const isMember = Boolean(memberDoc) || isOwner;

    return {
      bubble: publicBubble(bubble),
      userMembership: {
        isMember,
        isOwner,
        joinedAt: memberDoc ? toIso(memberDoc.joinedAt) : null,
      },
      viewerUserType: viewerUser?.userType || USER_TYPES.USER,
    };
  },

  /**
   * Open-bubble instant join. Transactionally:
   *   - 404 if the bubble doesn't exist
   *   - 400 if caller is already a member
   *   - 400 if caller IS the owning artist (artists are implicit members
   *     of their own bubble and never need to "join")
   *   - writes the member doc and increments memberCount
   *
   * Phase 2 will introduce closed bubbles + pending-request semantics;
   * for MVP every bubble is open so the success path always returns
   * `status: "approved"`.
   */
  async joinBubble(artistId, viewerId) {
    if (artistId === viewerId) {
      throw AppError.badRequest("Artists are already members of their own bubble");
    }

    const bubbleRef = bubbleRepository.ref(artistId);
    const memberRef = bubbleRepository.memberRef(artistId, viewerId);

    const result = await db().runTransaction(async (tx) => {
      const [bubbleSnap, memberSnap] = await Promise.all([
        tx.get(bubbleRef),
        tx.get(memberRef),
      ]);

      if (!bubbleSnap.exists) {
        throw AppError.notFound("Bubble not found");
      }
      const bubble = bubbleSnap.data();
      if (bubble.isOpen === false) {
        // Closed bubbles are deferred to Phase 2 (join requests).
        throw AppError.forbidden("This bubble requires an approved request");
      }
      if (memberSnap.exists) {
        return {
          status: "already_member",
          memberCount: bubble.memberCount || 0,
        };
      }

      const now = new Date();
      tx.set(memberRef, {
        userId: viewerId,
        bubbleId: artistId,
        joinedAt: now,
      });
      tx.update(bubbleRef, {
        memberCount: FieldValue.increment(1),
        updatedAt: now,
      });
      return {
        status: "approved",
        memberCount: (bubble.memberCount || 0) + 1,
      };
    });

    return result;
  },

  /**
   * Idempotent leave. Returns the latest memberCount either way so the
   * frontend can patch its cache without re-fetching the bubble.
   */
  async leaveBubble(artistId, viewerId) {
    if (artistId === viewerId) {
      throw AppError.badRequest("Artists cannot leave their own bubble");
    }

    const bubbleRef = bubbleRepository.ref(artistId);
    const memberRef = bubbleRepository.memberRef(artistId, viewerId);

    const result = await db().runTransaction(async (tx) => {
      const [bubbleSnap, memberSnap] = await Promise.all([
        tx.get(bubbleRef),
        tx.get(memberRef),
      ]);

      if (!bubbleSnap.exists) {
        throw AppError.notFound("Bubble not found");
      }
      const bubble = bubbleSnap.data();
      if (!memberSnap.exists) {
        return {
          status: "not_member",
          memberCount: bubble.memberCount || 0,
        };
      }

      const now = new Date();
      tx.delete(memberRef);
      tx.update(bubbleRef, {
        memberCount: FieldValue.increment(-1),
        updatedAt: now,
      });
      return {
        status: "left",
        memberCount: Math.max(0, (bubble.memberCount || 0) - 1),
      };
    });

    return result;
  },

  /**
   * Bubble post list. Non-members get 403; owner artist always passes.
   * Service-layer membership check matches the home-feed filter so the
   * gating rule lives in exactly one place.
   */
  async listBubblePosts(artistId, viewerId, { cursor, limit } = {}) {
    const [bubble, memberDoc] = await Promise.all([
      bubbleRepository.findById(artistId),
      viewerId ? bubbleRepository.getMemberDoc(artistId, viewerId) : null,
    ]);

    if (!bubble) {
      throw AppError.notFound("Bubble not found");
    }

    const isOwner = viewerId === artistId;
    if (!isOwner && !memberDoc) {
      throw new AppError(403, "Not a member of this bubble", {
        code: "NOT_BUBBLE_MEMBER",
      });
    }

    const { items, nextCursor } = await musicPostRepository.listBubblePosts(
      artistId,
      { cursor, limit }
    );

    const posts = await musicPostService.hydrateBubblePosts(items, viewerId);
    return { posts, nextCursor, count: posts.length };
  },
};
