import { FieldValue } from "firebase-admin/firestore";
import { AppError } from "../utils/AppError.js";
import { db } from "../config/firebase.js";
import { musicPostRepository } from "../repositories/musicPostRepository.js";
import { musicRepository } from "../repositories/musicRepository.js";
import { userRepository } from "../repositories/userRepository.js";
import { notificationService } from "./notificationService.js";

function toIso(value) {
  if (!value) return new Date().toISOString();
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value === "string") return value;
  return new Date(value).toISOString();
}

function displayName(user) {
  if (!user) return "User";
  return user.fullname || user.displayName || user.username || "User";
}

/**
 * Shared feed-rendering fan-out used by both `listFeed` and `listExploreFeed`.
 *
 * For a batch of posts, hydrates author profile data and the current viewer's
 * "did I like this" flag using a single `db().getAll(...refs)` round-trip,
 * keeping the feed at O(1) Firestore RPCs regardless of post count.
 */
async function hydrateFeedPosts(posts, currentUserId) {
  if (posts.length === 0) return [];

  const authorIds = [
    ...new Set(posts.map((p) => p.userId).filter(Boolean)),
  ];
  const authorRefs = authorIds.map((id) => userRepository.ref(id));
  const likeRefs = posts.map((p) =>
    musicPostRepository.likeRef(p.id, currentUserId)
  );

  const allRefs = [...authorRefs, ...likeRefs];
  const snapshots = allRefs.length > 0 ? await db().getAll(...allRefs) : [];

  const authorMap = new Map();
  for (let i = 0; i < authorRefs.length; i++) {
    const snap = snapshots[i];
    if (snap.exists) authorMap.set(snap.id, { id: snap.id, ...snap.data() });
  }

  const likedByUser = new Map();
  for (let i = 0; i < likeRefs.length; i++) {
    const snap = snapshots[authorRefs.length + i];
    likedByUser.set(posts[i].id, Boolean(snap?.exists));
  }

  return posts.map((post) => {
    const author = authorMap.get(post.userId);
    return {
      id: post.id,
      songId: post.songId,
      userId: post.userId,
      userName: displayName(author),
      userAvatarUrl: author?.photoURL || null,
      createdAt: toIso(post.createdAt),
      caption: post.caption || "",
      songSnapshot: post.songSnapshot || {
        title: "Untitled",
        artist: "Unknown Artist",
        albumArtUrl: null,
      },
      likes: post.likeCount || 0,
      comments: post.commentCount || 0,
      likedByUser: likedByUser.get(post.id) || false,
    };
  });
}

export const musicPostService = {
  async shareMusic(userId, { songId, caption, platforms }) {
    const song = await musicRepository.findById(songId);
    if (!song) throw AppError.notFound("Song not found");

    const { id } = await musicPostRepository.create({
      userId,
      songId,
      caption,
      platforms,
      songSnapshot: {
        title: song.title,
        artist: song.artist,
        albumArtUrl: song.albumArtUrl || null,
      },
      // Initialize denormalized counters up front so listFeed can rely on
      // them and skip the count() RPC per post.
      likeCount: 0,
      commentCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      type: "music_share",
    });

    return { postId: id };
  },

  /**
   * Personalized feed: posts from users the viewer follows, chronological
   * within that subset. Falls back to an empty array if the viewer follows
   * nobody — frontend should route them to /api/posts/explore.
   *
   * Reads viewer's `following` subcollection (capped at 200 IDs — the
   * "follow horizon"), then fan-out queries musicPosts via `where userId in`
   * (chunked at 30 to satisfy the Firestore limit).
   */
  async listFeed(currentUserId) {
    const followingIds = await userRepository.listFollowingIds(
      currentUserId,
      200
    );
    if (followingIds.length === 0) return { posts: [] };
    const posts = await musicPostRepository.listRecentByUserIds(
      followingIds,
      50
    );
    return { posts: await hydrateFeedPosts(posts, currentUserId) };
  },

  /**
   * Explore feed: the previous chronological-all behaviour, preserved
   * verbatim for unauthenticated/empty-follow-graph discovery surfaces.
   */
  async listExploreFeed(currentUserId) {
    const posts = await musicPostRepository.listRecent(50);
    return { posts: await hydrateFeedPosts(posts, currentUserId) };
  },

  /**
   * Posts authored by a specific user, paginated. Used by the profile
   * "Posts" tab. Posts are public on the read path — visibility gating is
   * the caller's concern (controller checks follow status / self).
   */
  async listByUser(authorId, viewerId, { cursor, limit } = {}) {
    const { items, nextCursor } = await musicPostRepository.listByUserId(
      authorId,
      { cursor, limit }
    );
    const hydrated = await hydrateFeedPosts(items, viewerId);
    return { posts: hydrated, nextCursor, count: hydrated.length };
  },

  /**
   * Atomic post-like toggle. Reads the post + viewer's like doc, then
   * writes the like and the denormalized `post.likeCount` in one tx —
   * race-safe under concurrent clicks.
   *
   * Post likes intentionally do NOT propagate to song.likeCount; those are
   * separate engagement signals tracked via toggleSongLike.
   */
  async togglePostLike(postId, user) {
    const postRef = musicPostRepository.ref(postId);
    const likeRef = musicPostRepository.likeRef(postId, user.id);

    const result = await db().runTransaction(async (tx) => {
      const [postSnap, likeSnap] = await Promise.all([
        tx.get(postRef),
        tx.get(likeRef),
      ]);
      if (!postSnap.exists) throw AppError.notFound("Post not found");

      const post = postSnap.data();
      const current = post.likeCount || 0;
      const now = new Date();

      let liked;
      let newCount;
      if (likeSnap.exists) {
        tx.delete(likeRef);
        newCount = Math.max(0, current - 1);
        liked = false;
      } else {
        tx.set(likeRef, { userId: user.id, createdAt: now });
        newCount = current + 1;
        liked = true;
      }

      tx.update(postRef, { likeCount: newCount, updatedAt: now });
      return {
        liked,
        likeCount: newCount,
        postSnapshot: { id: postId, ...post },
      };
    });

    // Notify the post author. Toggle-off withdraws the prior notification so
    // an "X liked your post" inbox row doesn't outlive the actual like.
    if (result.liked) {
      await notificationService.emitPostLike({
        actorUser: user,
        post: result.postSnapshot,
      });
    } else {
      await notificationService.withdrawPostLike({
        actorUserId: user.id,
        post: result.postSnapshot,
      });
    }

    return {
      liked: result.liked,
      likeCount: result.likeCount,
      message: result.liked ? "Post liked" : "Post unliked",
    };
  },

  async listComments(postId) {
    const comments = await musicPostRepository.listComments(postId);
    const enriched = await Promise.all(
      comments.map(async (c) => {
        let userName = c.userName;
        let userAvatarUrl = c.userAvatarUrl;
        if (!userName && c.userId) {
          const author = await userRepository.findById(c.userId);
          userName = displayName(author);
          userAvatarUrl = author?.photoURL || null;
        }
        return {
          id: c.id,
          userId: c.userId,
          userName: userName || "User",
          userAvatarUrl: userAvatarUrl || null,
          text: c.text,
          createdAt: toIso(c.createdAt),
        };
      })
    );

    return { comments: enriched, count: enriched.length };
  },

  async addComment(postId, userId, text) {
    const post = await musicPostRepository.findById(postId);
    if (!post) throw AppError.notFound("Post not found");

    const author = await userRepository.findById(userId);
    const commentData = {
      userId,
      userName: displayName(author),
      userAvatarUrl: author?.photoURL || null,
      text,
      createdAt: new Date(),
    };

    const { id } = await musicPostRepository.addComment(postId, commentData);

    await musicPostRepository
      .ref(postId)
      .update({ commentCount: FieldValue.increment(1) });

    // Notify the post author. Each comment is unique (no dedup), so the
    // post author gets a row per comment.
    await notificationService.emitPostComment({
      actorUser: author ? { id: userId, ...author } : { id: userId },
      post,
      commentId: id,
      commentText: text,
    });

    return {
      commentId: id,
      comment: { id, ...commentData, createdAt: commentData.createdAt.toISOString() },
    };
  },
};
