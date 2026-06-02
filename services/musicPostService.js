import { FieldValue } from "firebase-admin/firestore";
import { AppError } from "../utils/AppError.js";
import { db } from "../config/firebase.js";
import { musicPostRepository } from "../repositories/musicPostRepository.js";
import { musicRepository } from "../repositories/musicRepository.js";
import { userRepository } from "../repositories/userRepository.js";
import { bubbleRepository } from "../repositories/bubbleRepository.js";
import { notificationService } from "./notificationService.js";
import { USER_TYPES } from "../utils/collections.js";

/**
 * Read-side default for visibility / isReleased. Posts written before
 * Artist Bubble shipped have neither field; we treat them as public &
 * released so the feed never silently drops historical content.
 */
function normalizePostVisibility(post) {
  if (!post) return post;
  const visibility = post.visibility === "bubble" ? "bubble" : "public";
  const isReleased =
    visibility === "public" ? true : Boolean(post.isReleased);
  return { ...post, visibility, isReleased };
}

function buildBubbleInfo(post) {
  const isBubbleOnly = post.visibility === "bubble" && !post.isReleased;
  return {
    isBubbleOnly,
    canShareExternally: !isBubbleOnly,
    bubbleId: post.bubbleId || null,
    isReleased: Boolean(post.isReleased),
    visibility: post.visibility || "public",
  };
}

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
 * Hydrate a batch of comments with viewer-perspective `likedByUser` in a
 * single `db().getAll(...refs)` round-trip. Falls back to looking up the
 * author profile only when the comment doc lacks the denormalized
 * `userName` — old comments written before that field was denormalized
 * keep working without a manual backfill.
 *
 * `repo` is duck-typed: must expose `commentLikeRef(parentId, commentId,
 * userId)`. Pass `musicPostRepository` or `reelRepository`.
 */
async function hydrateComments(parentId, comments, viewerId, repo) {
  if (comments.length === 0) return [];

  const likeRefs = viewerId
    ? comments.map((c) => repo.commentLikeRef(parentId, c.id, viewerId))
    : [];
  const missingAuthorIds = [
    ...new Set(
      comments
        .filter((c) => !c.userName && c.userId)
        .map((c) => c.userId)
    ),
  ];
  const authorRefs = missingAuthorIds.map((id) => userRepository.ref(id));

  const allRefs = [...likeRefs, ...authorRefs];
  const snapshots = allRefs.length > 0 ? await db().getAll(...allRefs) : [];

  const likedByUser = new Map();
  for (let i = 0; i < likeRefs.length; i++) {
    likedByUser.set(comments[i].id, Boolean(snapshots[i]?.exists));
  }
  const authorMap = new Map();
  for (let i = 0; i < authorRefs.length; i++) {
    const snap = snapshots[likeRefs.length + i];
    if (snap?.exists) authorMap.set(snap.id, { id: snap.id, ...snap.data() });
  }

  return comments.map((c) => {
    const fallback = authorMap.get(c.userId);
    return {
      id: c.id,
      userId: c.userId,
      userName: c.userName || displayName(fallback),
      userAvatarUrl: c.userAvatarUrl || fallback?.photoURL || null,
      text: c.text,
      parentCommentId: c.parentCommentId || null,
      likeCount: c.likeCount || 0,
      likedByUser: likedByUser.get(c.id) || false,
      replyCount: c.replyCount || 0,
      createdAt: toIso(c.createdAt),
    };
  });
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

  return posts.map((rawPost) => {
    const post = normalizePostVisibility(rawPost);
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
      visibility: post.visibility,
      isReleased: post.isReleased,
      releasedAt: toIsoOrNull(post.releasedAt),
      bubbleInfo: buildBubbleInfo(post),
    };
  });
}

function toIsoOrNull(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value === "string") return value;
  return new Date(value).toISOString();
}

/**
 * Drop bubble-only posts the viewer can't see. Bubble-only =
 * (visibility === "bubble" && !isReleased). The owner artist always
 * passes (they see their own unreleased work). Membership is checked
 * via one `db().getAll` batched read across all distinct bubbles in
 * the candidate set, so this stays O(1) regardless of feed depth.
 *
 * We deliberately filter *after* the Firestore fetch rather than
 * pushing into the query because we'd otherwise need composite indexes
 * for every (userId-in, visibility==, isReleased==) combination. Once
 * the feed grows large enough to make over-fetching expensive, revisit.
 */
async function filterBubblePostsForViewer(posts, viewerId) {
  if (!posts || posts.length === 0) return [];

  const candidates = posts.map((p) => normalizePostVisibility(p));
  const bubbleIds = Array.from(
    new Set(
      candidates
        .filter(
          (p) => p.visibility === "bubble" && !p.isReleased && p.bubbleId
        )
        .map((p) => p.bubbleId)
    )
  );

  const memberships = bubbleIds.length
    ? await bubbleRepository.getMembershipStatuses(bubbleIds, viewerId)
    : new Map();

  return candidates.filter((post) => {
    if (post.visibility !== "bubble" || post.isReleased) return true;
    if (!post.bubbleId) return false;
    if (post.userId === viewerId) return true; // owner artist always sees their own
    return memberships.get(post.bubbleId) === true;
  });
}

export const musicPostService = {
  async shareMusic(userId, { songId, caption, platforms, visibility = "public" }) {
    const [song, author] = await Promise.all([
      musicRepository.findById(songId),
      userRepository.findById(userId),
    ]);
    if (!song) throw AppError.notFound("Song not found");
    if (!author) throw AppError.unauthorized("User not found");

    const wantsBubble = visibility === "bubble";
    if (wantsBubble && author.userType !== USER_TYPES.ARTIST) {
      throw new AppError(403, "Only artists can post to a bubble", {
        code: "NOT_ARTIST",
      });
    }

    const now = new Date();
    const baseDoc = {
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
      createdAt: now,
      updatedAt: now,
      type: "music_share",
      // Default to public + released so existing share-music callers
      // (which don't send visibility) keep behaving identically.
      visibility: wantsBubble ? "bubble" : "public",
      isReleased: !wantsBubble,
    };
    if (wantsBubble) {
      baseDoc.bubbleId = author.artistProfile?.bubbleId || author.id;
    }

    const { id } = await musicPostRepository.create(baseDoc);

    // Keep the bubble doc's denormalized postCount in sync. Failure here
    // is non-fatal — the post is already written and the count will
    // eventually be reconciled. We log via the existing logger.
    if (wantsBubble && baseDoc.bubbleId) {
      try {
        await bubbleRepository
          .ref(baseDoc.bubbleId)
          .update({ postCount: FieldValue.increment(1), updatedAt: now });
      } catch {
        // intentional: drift on this counter is acceptable for MVP.
      }
    }

    return { postId: id };
  },

  /**
   * Artist-initiated release. Flips visibility -> public, isReleased ->
   * true, and stamps releasedAt. The mutation is transactional so two
   * concurrent release clicks can't double-write.
   *
   * Throws:
   *   - 404 if post doesn't exist
   *   - 403 NOT_POST_OWNER if caller isn't the author
   *   - 400 ALREADY_RELEASED if the post is already public
   */
  async releasePost(postId, userId) {
    const postRef = musicPostRepository.ref(postId);
    const result = await db().runTransaction(async (tx) => {
      const snap = await tx.get(postRef);
      if (!snap.exists) throw AppError.notFound("Post not found");
      const post = snap.data();
      if (post.userId !== userId) {
        throw new AppError(403, "You don't own this post", {
          code: "NOT_POST_OWNER",
        });
      }
      const normalized = normalizePostVisibility(post);
      if (normalized.isReleased) {
        throw new AppError(400, "This post is already released", {
          code: "ALREADY_RELEASED",
        });
      }

      const releasedAt = new Date();
      tx.update(postRef, {
        visibility: "public",
        isReleased: true,
        releasedAt,
        updatedAt: releasedAt,
      });
      return { postId, releasedAt };
    });

    return {
      postId: result.postId,
      visibility: "public",
      isReleased: true,
      releasedAt: result.releasedAt.toISOString(),
    };
  },

  /**
   * Personalized feed: posts from the viewer + users the viewer follows,
   * chronological within that subset.
   *
   * Why include the viewer themselves: every social product (Instagram,
   * Twitter, TikTok) surfaces the user's own posts on their home feed —
   * a brand-new user who just shared their first song expects to see it
   * there, even before they've followed anyone. Excluding self made the
   * "first share" experience land on an empty state, which read as a bug.
   *
   * Reads viewer's `following` subcollection (capped at 200 IDs — the
   * "follow horizon"), unions with `currentUserId`, then fan-out queries
   * musicPosts via `where userId in` (chunked at 30 to satisfy the
   * Firestore limit). The dedupe via Set is defensive — Firestore would
   * accept duplicate IDs in the `in` clause but they'd waste quota.
   *
   * Worst case (user follows 0 people and has 0 posts) still returns an
   * empty array — `listRecentByUserIds` already early-exits on no results.
   */
  async listFeed(currentUserId) {
    const followingIds = await userRepository.listFollowingIds(
      currentUserId,
      200
    );
    const authorIds = Array.from(new Set([currentUserId, ...followingIds]));
    const posts = await musicPostRepository.listRecentByUserIds(
      authorIds,
      50
    );
    const visible = await filterBubblePostsForViewer(posts, currentUserId);
    return { posts: await hydrateFeedPosts(visible, currentUserId) };
  },

  /**
   * Explore feed: the previous chronological-all behaviour, preserved
   * verbatim for unauthenticated/empty-follow-graph discovery surfaces.
   */
  async listExploreFeed(currentUserId) {
    const posts = await musicPostRepository.listRecent(50);
    const visible = await filterBubblePostsForViewer(posts, currentUserId);
    return { posts: await hydrateFeedPosts(visible, currentUserId) };
  },

  /**
   * Posts authored by a specific user, paginated. Used by the profile
   * "Posts" tab. Bubble-only posts are filtered by membership the same
   * way as the home feed so a non-member visiting an artist's profile
   * never sees their unreleased tracks.
   */
  async listByUser(authorId, viewerId, { cursor, limit } = {}) {
    const { items, nextCursor } = await musicPostRepository.listByUserId(
      authorId,
      { cursor, limit }
    );
    const visible = await filterBubblePostsForViewer(items, viewerId);
    const hydrated = await hydrateFeedPosts(visible, viewerId);
    return { posts: hydrated, nextCursor, count: hydrated.length };
  },

  /**
   * Bubble-post list used by /api/bubbles/:artistId/posts. The bubble
   * service has already verified the viewer is allowed; here we only
   * hydrate. Includes both released + unreleased posts so a member
   * sees the artist's full bubble history.
   */
  async hydrateBubblePosts(posts, viewerId) {
    return hydrateFeedPosts(posts, viewerId);
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

  /**
   * Top-level comments only. Returns each comment with viewer-perspective
   * `likedByUser` plus denormalized `likeCount` and `replyCount`. The
   * three counters are part of the response contract — clients render
   * them without an extra round-trip.
   */
  async listComments(postId, viewerId, { cursor, limit } = {}) {
    const { items, nextCursor } = await musicPostRepository.listTopLevelComments(
      postId,
      { cursor, limit }
    );
    const comments = await hydrateComments(
      postId,
      items,
      viewerId,
      musicPostRepository
    );
    return { comments, nextCursor, count: comments.length };
  },

  /**
   * Replies under a top-level comment. Same hydration shape as
   * `listComments`; `replyCount` is always 0 on reply docs because the
   * tree is flat (replies don't themselves have replies).
   */
  async listReplies(postId, parentCommentId, viewerId, { cursor, limit } = {}) {
    const parent = await musicPostRepository.findCommentById(
      postId,
      parentCommentId
    );
    if (!parent) throw AppError.notFound("Comment not found");

    const { items, nextCursor } = await musicPostRepository.listReplies(
      postId,
      parentCommentId,
      { cursor, limit }
    );
    const comments = await hydrateComments(
      postId,
      items,
      viewerId,
      musicPostRepository
    );
    return { comments, nextCursor, count: comments.length };
  },

  async addComment(postId, userId, text, { parentCommentId = null } = {}) {
    const post = await musicPostRepository.findById(postId);
    if (!post) throw AppError.notFound("Post not found");

    // Resolve the actual parent we'll attach to. Replies are flat: if the
    // user is replying to a reply, re-parent the new comment up to that
    // reply's own parent so the conversation stays one level deep
    // (Instagram-style). Throws if `parentCommentId` doesn't resolve.
    let attachedParentId = null;
    let parentComment = null;
    if (parentCommentId) {
      const target = await musicPostRepository.findCommentById(
        postId,
        parentCommentId
      );
      if (!target) throw AppError.notFound("Parent comment not found");
      attachedParentId = target.parentCommentId || target.id;
      parentComment =
        attachedParentId === target.id
          ? target
          : await musicPostRepository.findCommentById(postId, attachedParentId);
    }

    const author = await userRepository.findById(userId);
    const now = new Date();
    const commentData = {
      userId,
      userName: displayName(author),
      userAvatarUrl: author?.photoURL || null,
      text,
      parentCommentId: attachedParentId,
      likeCount: 0,
      replyCount: 0,
      createdAt: now,
    };

    const { id } = await musicPostRepository.addComment(postId, commentData);

    // Bump aggregates. Parent post `commentCount` includes replies so the
    // top-of-card count is consistent with Instagram. Reply also bumps the
    // top-level comment's denormalized `replyCount`.
    const parentUpdates = [
      musicPostRepository
        .ref(postId)
        .update({ commentCount: FieldValue.increment(1) }),
    ];
    if (attachedParentId) {
      parentUpdates.push(
        musicPostRepository
          .commentRef(postId, attachedParentId)
          .update({ replyCount: FieldValue.increment(1) })
      );
    }
    await Promise.all(parentUpdates);

    // Notifications.
    //   - Top-level comment → notify post author (existing behaviour).
    //   - Reply             → notify the parent comment's author. We do
    //                         NOT also ping the post author for replies;
    //                         the spec'd UX is "you got a reply" only.
    if (attachedParentId && parentComment) {
      await notificationService.emitCommentReply({
        actorUser: author ? { id: userId, ...author } : { id: userId },
        parentCommentAuthorId: parentComment.userId,
        surface: "post",
        surfaceId: postId,
        parentCommentId: attachedParentId,
        replyId: id,
        replyText: text,
      });
    } else {
      await notificationService.emitPostComment({
        actorUser: author ? { id: userId, ...author } : { id: userId },
        post,
        commentId: id,
        commentText: text,
      });
    }

    return {
      commentId: id,
      comment: {
        id,
        userId,
        userName: commentData.userName,
        userAvatarUrl: commentData.userAvatarUrl,
        text,
        parentCommentId: attachedParentId,
        likeCount: 0,
        likedByUser: false,
        replyCount: 0,
        createdAt: now.toISOString(),
      },
    };
  },

  /**
   * Toggle a like on a comment. Atomic tx over (comment doc, likes/{viewerId}):
   *   - first call inserts the like doc + bumps comment.likeCount.
   *   - second call removes both + emits a `withdrawCommentLike`.
   * Mirrors `togglePostLike` exactly so the count never drifts.
   */
  async toggleCommentLike(postId, commentId, user) {
    const post = await musicPostRepository.findById(postId);
    if (!post) throw AppError.notFound("Post not found");
    const commentRef = musicPostRepository.commentRef(postId, commentId);
    const likeRef = musicPostRepository.commentLikeRef(
      postId,
      commentId,
      user.id
    );

    const result = await db().runTransaction(async (tx) => {
      const [commentSnap, likeSnap] = await Promise.all([
        tx.get(commentRef),
        tx.get(likeRef),
      ]);
      if (!commentSnap.exists) throw AppError.notFound("Comment not found");

      const data = commentSnap.data();
      const current = data.likeCount || 0;
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

      tx.update(commentRef, { likeCount: newCount });
      return {
        liked,
        likeCount: newCount,
        commentAuthorId: data.userId,
        commentText: data.text || "",
      };
    });

    // Notification fan-out — fire after the tx so a notif failure can't
    // roll back the like state. Use dedupId so rapid like/unlike spam
    // doesn't bloat the recipient's inbox.
    if (result.liked) {
      await notificationService.emitCommentLike({
        actorUser: user,
        commentAuthorId: result.commentAuthorId,
        surface: "post",
        surfaceId: postId,
        commentId,
        commentText: result.commentText,
      });
    } else {
      await notificationService.withdrawCommentLike({
        actorUserId: user.id,
        commentAuthorId: result.commentAuthorId,
        commentId,
      });
    }

    return {
      liked: result.liked,
      likeCount: result.likeCount,
      message: result.liked ? "Comment liked" : "Comment unliked",
    };
  },
};
