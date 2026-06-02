export const COLLECTIONS = Object.freeze({
  USERS: "users",
  MUSIC: "music",
  MUSIC_POSTS: "musicPosts",
  CONVERSATIONS: "conversations",
  REELS: "reels",
  BUBBLES: "bubbles",
});

export const SUBCOLLECTIONS = Object.freeze({
  LIKES: "likes",
  COMMENTS: "comments",
  MESSAGES: "messages",
  FAVORITES: "favorites",
  LIKED_SONGS: "likedSongs",
  LIKED_REELS: "likedReels",
  USER_CONVERSATIONS: "conversations",
  FOLLOWERS: "followers",
  FOLLOWING: "following",
  NOTIFICATIONS: "notifications",
  VIEWS: "views",
  MEMBERS: "members",
});

export const USER_TYPES = Object.freeze({
  USER: "user",
  ARTIST: "artist",
});

/**
 * Canonical notification event types. Keep in sync with the union in
 * `validators/notificationValidators.js` and the emit helpers in
 * `services/notificationService.js`.
 */
export const NOTIFICATION_TYPES = Object.freeze({
  FOLLOW: "follow",
  POST_LIKE: "post_like",
  POST_COMMENT: "post_comment",
  SONG_LIKE: "song_like",
  REEL_LIKE: "reel_like",
  REEL_COMMENT: "reel_comment",
  // Comment-level interactions. Recipient is the COMMENT's author
  // (not the post/reel author). Reply recipients = author of the
  // comment being replied to.
  COMMENT_LIKE: "comment_like",
  COMMENT_REPLY: "comment_reply",
});

/**
 * Canonical reel lifecycle states. The reel doc starts in `PENDING_UPLOAD`
 * when the client requests an upload slot, transitions to `PROCESSING` on
 * `video.upload.asset_created`, then to `READY` on `video.asset.ready`
 * (assuming duration <= cap), or `ERRORED` if any step fails or the asset
 * exceeds the duration cap.
 */
export const REEL_STATUS = Object.freeze({
  PENDING_UPLOAD: "pending_upload",
  PROCESSING: "processing",
  READY: "ready",
  ERRORED: "errored",
});
