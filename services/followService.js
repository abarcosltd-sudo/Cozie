import { FieldValue } from "firebase-admin/firestore";
import { AppError } from "../utils/AppError.js";
import { db } from "../config/firebase.js";
import { userRepository } from "../repositories/userRepository.js";
import { notificationService } from "./notificationService.js";

function publicProfile(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username || "",
    fullname: user.fullname || "",
    displayName: user.displayName || null,
    photoURL: user.photoURL || null,
    visibility: user.visibility || "public",
  };
}

async function hydrateUserIds(ids) {
  if (ids.length === 0) return new Map();
  const refs = ids.map((id) => userRepository.ref(id));
  const snaps = await db().getAll(...refs);
  const out = new Map();
  for (const snap of snaps) {
    if (snap.exists) out.set(snap.id, { id: snap.id, ...snap.data() });
  }
  return out;
}

export const followService = {
  /**
   * Atomic follow. All reads happen before writes, and the writes touch
   * four docs (two relation docs + two counters) so a partial state is
   * impossible. Idempotent: re-following returns 200 with alreadyFollowing.
   */
  async follow(followerId, followedId) {
    if (followerId === followedId) {
      throw AppError.badRequest("You can't follow yourself");
    }

    const followingRef = userRepository.followingRef(followerId, followedId);
    const followerRef = userRepository.followerRef(followedId, followerId);
    const followerUserRef = userRepository.ref(followerId);
    const followedUserRef = userRepository.ref(followedId);

    const result = await db().runTransaction(async (tx) => {
      const [followedUserSnap, followerUserSnap, followingSnap] =
        await Promise.all([
          tx.get(followedUserRef),
          tx.get(followerUserRef),
          tx.get(followingRef),
        ]);

      if (!followedUserSnap.exists) {
        throw AppError.notFound("User not found");
      }

      if (followingSnap.exists) {
        const followedData = followedUserSnap.data();
        return {
          status: "ok",
          following: true,
          alreadyFollowing: true,
          followerCount: followedData.followerCount || 0,
          followerProfile: followerUserSnap.exists
            ? { id: followerUserSnap.id, ...followerUserSnap.data() }
            : null,
        };
      }

      const now = new Date();
      tx.set(followingRef, {
        followedId,
        status: "active",
        followedAt: now,
        updatedAt: now,
      });
      tx.set(followerRef, {
        followerId,
        status: "active",
        followedAt: now,
        updatedAt: now,
      });
      tx.update(followerUserRef, {
        followingCount: FieldValue.increment(1),
        updatedAt: now,
      });
      tx.update(followedUserRef, {
        followerCount: FieldValue.increment(1),
        updatedAt: now,
      });

      const prevFollowerCount = followedUserSnap.data().followerCount || 0;
      return {
        status: "created",
        following: true,
        followerCount: prevFollowerCount + 1,
        followerProfile: followerUserSnap.exists
          ? { id: followerUserSnap.id, ...followerUserSnap.data() }
          : null,
      };
    });

    // Side-effect: notify the followee. Best-effort — failures are logged
    // inside notificationService.emit and never roll back the follow.
    if (result.status === "created" && result.followerProfile) {
      await notificationService.emitFollow({
        followerUser: result.followerProfile,
        followedUserId: followedId,
      });
    }

    const { followerProfile: _drop, ...rest } = result;
    return rest;
  },

  /**
   * Atomic unfollow. Idempotent: returns alreadyAbsent: true if not
   * currently following. Counters use FieldValue.increment(-1); transaction
   * gating on the relation doc prevents double-decrement.
   */
  async unfollow(followerId, followedId) {
    if (followerId === followedId) {
      throw AppError.badRequest("You can't unfollow yourself");
    }

    const followingRef = userRepository.followingRef(followerId, followedId);
    const followerRef = userRepository.followerRef(followedId, followerId);
    const followerUserRef = userRepository.ref(followerId);
    const followedUserRef = userRepository.ref(followedId);

    const result = await db().runTransaction(async (tx) => {
      const [followedUserSnap, followingSnap] = await Promise.all([
        tx.get(followedUserRef),
        tx.get(followingRef),
      ]);

      if (!followedUserSnap.exists) {
        throw AppError.notFound("User not found");
      }

      if (!followingSnap.exists) {
        const followedData = followedUserSnap.data();
        return {
          following: false,
          alreadyAbsent: true,
          followerCount: followedData.followerCount || 0,
        };
      }

      const now = new Date();
      tx.delete(followingRef);
      tx.delete(followerRef);
      tx.update(followerUserRef, {
        followingCount: FieldValue.increment(-1),
        updatedAt: now,
      });
      tx.update(followedUserRef, {
        followerCount: FieldValue.increment(-1),
        updatedAt: now,
      });

      const prevFollowerCount = followedUserSnap.data().followerCount || 0;
      return {
        following: false,
        followerCount: Math.max(0, prevFollowerCount - 1),
      };
    });

    // Mirror the unfollow into notifications so a stale "X followed you"
    // doesn't sit in the recipient's inbox after X unfollows.
    if (!result.alreadyAbsent) {
      await notificationService.withdrawFollow({
        followerUserId: followerId,
        followedUserId: followedId,
      });
    }

    return result;
  },

  /**
   * One-RPC follow-status check using db().getAll across three refs:
   * (viewer-follows-target), (target-follows-viewer), and the target user
   * doc for the canonical counters.
   */
  async status(viewerId, targetUserId) {
    const targetRef = userRepository.ref(targetUserId);
    const viewerFollowsTargetRef = userRepository.followingRef(
      viewerId,
      targetUserId
    );
    const targetFollowsViewerRef = userRepository.followingRef(
      targetUserId,
      viewerId
    );

    const [targetSnap, vftSnap, tfvSnap] = await db().getAll(
      targetRef,
      viewerFollowsTargetRef,
      targetFollowsViewerRef
    );

    if (!targetSnap.exists) {
      throw AppError.notFound("User not found");
    }

    const targetData = targetSnap.data();
    return {
      userId: targetUserId,
      isFollowing: vftSnap.exists,
      isFollowedBy: tfvSnap.exists,
      isSelf: viewerId === targetUserId,
      followerCount: targetData.followerCount || 0,
      followingCount: targetData.followingCount || 0,
      visibility: targetData.visibility || "public",
    };
  },

  async listFollowers(targetUserId, { cursor, limit } = {}) {
    const targetUser = await userRepository.findById(targetUserId);
    if (!targetUser) throw AppError.notFound("User not found");

    const { items, nextCursor } = await userRepository.listFollowers(
      targetUserId,
      { cursor, limit }
    );
    const userMap = await hydrateUserIds(items.map((i) => i.id));

    return {
      followers: items.map((i) => ({
        ...publicProfile(userMap.get(i.id)),
        followedAt:
          i.followedAt && typeof i.followedAt.toDate === "function"
            ? i.followedAt.toDate().toISOString()
            : i.followedAt,
      })).filter((u) => u.id),
      nextCursor,
      count: items.length,
    };
  },

  async listFollowing(viewerUserId, { cursor, limit } = {}) {
    const targetUser = await userRepository.findById(viewerUserId);
    if (!targetUser) throw AppError.notFound("User not found");

    const { items, nextCursor } = await userRepository.listFollowing(
      viewerUserId,
      { cursor, limit }
    );
    const userMap = await hydrateUserIds(items.map((i) => i.id));

    return {
      following: items.map((i) => ({
        ...publicProfile(userMap.get(i.id)),
        followedAt:
          i.followedAt && typeof i.followedAt.toDate === "function"
            ? i.followedAt.toDate().toISOString()
            : i.followedAt,
      })).filter((u) => u.id),
      nextCursor,
      count: items.length,
    };
  },
};
